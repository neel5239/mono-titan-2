"""Fine-tune the DR severity grader on APTOS 2019.

Design (see MODEL_CARD.md):
  * timm EfficientNet-B0/B2, single regression output (ICDR 0-4 treated as ordinal). Regression + optimised
    thresholds beats plain 5-way softmax on quadratic weighted kappa (the APTOS competition metric).
  * Initialised from ClementP/FundusDRGrading (MIT, fundus-pretrained) by default, or ImageNet.
  * Stratified 80/20 hold-out, class-balanced sampling, fundus augmentation incl. handheld-style blur/glare.
  * Best epoch chosen by hold-out QWK. Thresholds optimised on the hold-out predictions.
  * Exports ONNX with two outputs (score, feature map) so CAM can be computed in the browser without gradients.

Expected layout:  data/aptos/train.csv  and  data/aptos/train_images/<id_code>.png
"""
from pathlib import Path
import argparse, json, random, time
import numpy as np, pandas as pd, torch
from torch import nn
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torchvision import transforms as T
from PIL import Image, ImageFilter
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, balanced_accuracy_score, cohen_kappa_score, confusion_matrix
from scipy.optimize import minimize
from tqdm import tqdm
from common import CLASSES, fundus_preprocess, build_grader, GraderExport, score_to_grade
from phone_lens_aug import PhoneLensAug, phone_lens


def seed_all(seed):
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed); torch.cuda.manual_seed_all(seed)


class HandheldAug:
    """Simulates phone-adapter capture: mild blur, vignetting, glare blob, brightness drift.
    Coordinate grids are cached per image size so the augmentation costs a few array ops, not a grid build."""
    _grids = {}

    @classmethod
    def grid(cls, h, w):
        k = (h, w)
        if k not in cls._grids:
            yy, xx = np.mgrid[0:h, 0:w]
            r2 = ((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
            cls._grids[k] = (xx.astype(np.float32), yy.astype(np.float32), r2.astype(np.float32))
        return cls._grids[k]

    def __call__(self, img):
        if random.random() < 0.3:
            img = img.filter(ImageFilter.GaussianBlur(radius=random.uniform(0.3, 1.2)))
        if random.random() >= 0.45:  # 55% of images: no pixel-level effect, skip the float conversion entirely
            return img
        a = np.asarray(img).astype(np.float32)
        h, w = a.shape[:2]; xx, yy, r2 = self.grid(h, w)
        if random.random() < 0.55:  # vignette
            a *= np.clip(1 - random.uniform(0.15, 0.45) * r2, 0, 1)[..., None]
        if random.random() < 0.4:  # glare blob
            cx, cy = random.uniform(0.2, 0.8) * w, random.uniform(0.2, 0.8) * h; rad = random.uniform(0.05, 0.12) * w
            g = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * rad ** 2))
            a += random.uniform(60, 140) * g[..., None]
        return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


class AptosDataset(Dataset):
    """If cache_dir is given, every image is decoded, border-cropped and resized ONCE into a uint8 memmap; epochs then
    only run the random augmentations. Same pixels as before, 3-5x less CPU per step, so the GPU stops waiting."""
    def __init__(self, df, img_dir, train=False, size=384, cache_dir=None, tag='ds', phone_p=0.0, phone_sim=False):
        self.df = df.reset_index(drop=True); self.img_dir = Path(img_dir); self.size = size; self.train = train
        self.cache = None; self.cache_path = None; self.phone_sim = phone_sim
        if cache_dir:
            cache_dir = Path(cache_dir); cache_dir.mkdir(parents=True, exist_ok=True)
            f = cache_dir / f'{tag}_{size}_{len(self.df)}.u8'
            shape = (len(self.df), size, size, 3)
            if not f.exists() or f.stat().st_size != int(np.prod(shape)):
                mm = np.memmap(f, dtype=np.uint8, mode='w+', shape=shape)
                for i in tqdm(range(len(self.df)), desc=f'caching {tag}', leave=False):
                    mm[i] = np.asarray(fundus_preprocess(Image.open(self._path(self.df.iloc[i]['id_code'])).convert('RGB'), size))
                mm.flush(); del mm
            self.cache_path, self.cache_shape = str(f), shape   # opened lazily per worker (a memmap must not be pickled to spawned workers)
        aug = [T.RandomHorizontalFlip(), T.RandomVerticalFlip(p=0.2), T.RandomRotation(20),
               T.ColorJitter(brightness=.2, contrast=.2, saturation=.15, hue=.02), HandheldAug()] if train else []
        if train and phone_p > 0: aug.append(PhoneLensAug(p=phone_p))
        self.tf = T.Compose(aug + [T.ToTensor(), T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])

    def __getstate__(self):
        d = self.__dict__.copy(); d['cache'] = None; return d   # never pickle the open memmap

    def __len__(self): return len(self.df)

    def _path(self, code):
        for ext in ['.png', '.jpg', '.jpeg', '.JPG', '.PNG']:
            p = self.img_dir / f'{code}{ext}'
            if p.exists(): return p
        raise FileNotFoundError(code)

    def __getitem__(self, i):
        r = self.df.iloc[i]
        if self.cache is None and self.cache_path: self.cache = np.memmap(self.cache_path, dtype=np.uint8, mode='r', shape=self.cache_shape)
        img = Image.fromarray(np.array(self.cache[i])) if self.cache is not None else fundus_preprocess(Image.open(self._path(r['id_code'])).convert('RGB'), self.size)
        if self.phone_sim: img = phone_lens(img, np.random.default_rng(1000003 * i + 7))  # fixed per-image simulation
        return self.tf(img), torch.tensor(float(r['diagnosis']), dtype=torch.float32)


def optimise_thresholds(scores, ys):
    def loss(t): return -cohen_kappa_score(ys, [score_to_grade(s, sorted(t)) for s in scores], weights='quadratic')
    best = minimize(loss, [0.5, 1.5, 2.5, 3.5], method='Nelder-Mead', options={'maxiter': 800})
    return sorted(float(x) for x in best.x)


def evaluate(model, loader, device, thresholds=None):
    model.eval(); ys, ss = [], []
    with torch.no_grad():
        for x, y in loader:
            with torch.autocast(device.type, enabled=device.type == 'cuda'):
                s = model(x.to(device).to(memory_format=torch.channels_last)).float().squeeze(1)
            ys.extend(y.numpy().tolist()); ss.extend(s.cpu().numpy().tolist())
    ys = np.array(ys, int); ss = np.array(ss)
    thr = thresholds or [0.5, 1.5, 2.5, 3.5]
    ps = np.array([score_to_grade(s, thr) for s in ss])
    return {'accuracy': float(accuracy_score(ys, ps)), 'balanced_accuracy': float(balanced_accuracy_score(ys, ps)),
            'qwk': float(cohen_kappa_score(ys, ps, weights='quadratic')),
            'referable_sensitivity': float(((ps >= 2) & (ys >= 2)).sum() / max(1, (ys >= 2).sum())),
            'referable_specificity': float(((ps < 2) & (ys < 2)).sum() / max(1, (ys < 2).sum())),
            'confusion_matrix': confusion_matrix(ys, ps, labels=[0, 1, 2, 3, 4]).tolist()}, ss, ys


def main(a):
    seed_all(a.seed)
    device = torch.device('cuda' if torch.cuda.is_available() and not a.cpu else 'cpu')
    root = Path(a.data); df = pd.read_csv(root / 'train.csv'); df['diagnosis'] = df['diagnosis'].astype(int)
    img_dir = root / 'train_images'
    if a.holdout_csv:  # reuse a fixed hold-out (same 733 APTOS ids as earlier runs) so results stay comparable
        ho = set(pd.read_csv(a.holdout_csv).id_code); va = df[df.id_code.isin(ho)]; tr = df[~df.id_code.isin(ho)]
        print(f'fixed hold-out from {a.holdout_csv}: {len(va)} val / {len(tr)} train')
    else:
        tr, va = train_test_split(df, test_size=0.2, stratify=df.diagnosis, random_state=a.seed)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    va[['id_code', 'diagnosis']].to_csv(out / 'holdout_ids.csv', index=False)
    cache = (out / 'cache') if a.cache else None
    ds_tr = AptosDataset(tr, img_dir, True, a.size, cache, 'train', phone_p=a.phone_lens_aug); ds_va = AptosDataset(va, img_dir, False, a.size, cache, 'val')
    ds_ph = AptosDataset(va, img_dir, False, a.size, cache, 'val', phone_sim=True) if a.phone_lens_aug > 0 else None
    counts = np.bincount(tr.diagnosis, minlength=5); cw = 1.0 / np.maximum(counts, 1)
    sw = torch.tensor([cw[y] for y in tr.diagnosis], dtype=torch.double)
    sampler = WeightedRandomSampler(sw, len(sw), replacement=True)
    dl_tr = DataLoader(ds_tr, batch_size=a.batch_size, sampler=sampler, num_workers=a.workers, pin_memory=device.type == 'cuda', persistent_workers=a.workers > 0, prefetch_factor=4 if a.workers > 0 else None)
    dl_va = DataLoader(ds_va, batch_size=a.batch_size, shuffle=False, num_workers=a.workers, persistent_workers=a.workers > 0)
    dl_ph = DataLoader(ds_ph, batch_size=a.batch_size, shuffle=False, num_workers=a.workers, persistent_workers=a.workers > 0) if ds_ph else None

    torch.backends.cudnn.benchmark = True
    model = build_grader(a.model, 'none' if a.init_checkpoint else a.init)
    if a.init_checkpoint:
        ck0 = torch.load(a.init_checkpoint, map_location='cpu'); model.load_state_dict(ck0['state_dict']); print('init from', a.init_checkpoint, 'val qwk', round(ck0['val_metrics']['qwk'], 4))
    model = model.to(device).to(memory_format=torch.channels_last)
    crit = nn.SmoothL1Loss()
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=a.epochs * len(dl_tr), pct_start=0.15)
    scaler = torch.amp.GradScaler(enabled=device.type == 'cuda')

    base, _, _ = evaluate(model, dl_va, device)
    print('epoch 0 (init weights, default thresholds):', {k: round(v, 4) for k, v in base.items() if k != 'confusion_matrix'})
    best = base['qwk'] if (a.init == 'clementp' or a.init_checkpoint) else -1; best_thr = [0.5, 1.5, 2.5, 3.5]; history = [{'epoch': 0, **base}]
    if dl_ph:
        ph0, _, _ = evaluate(model, dl_ph, device); print('epoch 0 phone-sim hold-out qwk', round(ph0['qwk'], 4), 'sens', round(ph0['referable_sensitivity'], 3), 'spec', round(ph0['referable_specificity'], 3)); history[0]['phone_sim'] = ph0
    if a.init == 'clementp' or a.init_checkpoint:
        torch.save({'state_dict': model.state_dict(), 'classes': CLASSES, 'val_metrics': base, 'thresholds': best_thr}, out / 'dr_grader.pt')
    for ep in range(1, a.epochs + 1):
        model.train(); running = 0; t0 = time.time()
        for x, y in tqdm(dl_tr, desc=f'epoch {ep}/{a.epochs}', leave=False):
            x, y = x.to(device, non_blocking=True).to(memory_format=torch.channels_last), y.to(device, non_blocking=True); opt.zero_grad(set_to_none=True)
            with torch.autocast(device.type, enabled=device.type == 'cuda'):
                loss = crit(model(x).squeeze(1).float(), y)
            scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step(); running += loss.item() * len(y)
        met, ss, ys = evaluate(model, dl_va, device)
        thr = optimise_thresholds(ss, ys); met_t, _, _ = evaluate(model, dl_va, device, thr)
        rec = {'epoch': ep, 'loss': running / len(ds_tr), 'qwk_default_thr': met['qwk'], 'thresholds': thr, 'seconds': int(time.time() - t0), **met_t}
        if dl_ph:
            ph, _, _ = evaluate(model, dl_ph, device, thr); rec['phone_sim'] = ph; rec['select_score'] = 0.5 * (met_t['qwk'] + ph['qwk'])
            print('   phone-sim hold-out: qwk', round(ph['qwk'], 4), 'sens', round(ph['referable_sensitivity'], 3), 'spec', round(ph['referable_specificity'], 3))
        else: rec['select_score'] = met_t['qwk']
        history.append(rec); print({k: (round(v, 4) if isinstance(v, float) else v) for k, v in rec.items() if k != 'confusion_matrix'})
        if rec['select_score'] > best:
            best = rec['select_score']; best_thr = thr
            torch.save({'state_dict': model.state_dict(), 'classes': CLASSES, 'val_metrics': met_t, 'phone_sim_metrics': rec.get('phone_sim'), 'thresholds': thr, 'model': a.model}, out / 'dr_grader.pt')
    json.dump({'model': a.model, 'init': a.init, 'size': a.size, 'classes': CLASSES, 'best_qwk': best, 'best_thresholds': best_thr,
               'train_counts': counts.tolist(), 'history': history}, open(out / 'training_summary.json', 'w'), indent=2)

    ck = torch.load(out / 'dr_grader.pt', map_location='cpu'); model = build_grader(a.model, 'none'); model.load_state_dict(ck['state_dict']); model.eval()
    meta = GraderExport(model).export(out / 'dr_model.onnx', a.size, ck['thresholds'],
                                      {'model': a.model, 'init': a.init, 'val_metrics': ck['val_metrics'], 'phone_sim_metrics': ck.get('phone_sim_metrics'), 'phone_lens_aug': a.phone_lens_aug, 'trained_on': 'APTOS 2019 (80% stratified)', 'holdout': 'APTOS 2019 (20% stratified)', 'source': f'Trained in this repo (train/train_dr.py); init {a.init}'})
    print('Saved', out / 'dr_model.onnx', 'best QWK', round(best, 4), 'thresholds', [round(t, 3) for t in ck['thresholds']])


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--data', default='data/aptos'); p.add_argument('--out', default='models')
    p.add_argument('--model', default='efficientnet_b0', choices=['efficientnet_b0', 'efficientnet_b2'])
    p.add_argument('--init', default='clementp', choices=['clementp', 'imagenet'])
    p.add_argument('--epochs', type=int, default=10); p.add_argument('--batch-size', type=int, default=16); p.add_argument('--size', type=int, default=384)
    p.add_argument('--lr', type=float, default=1.5e-4); p.add_argument('--workers', type=int, default=8); p.add_argument('--seed', type=int, default=42); p.add_argument('--cpu', action='store_true'); p.add_argument('--holdout-csv', default=''); p.add_argument('--phone-lens-aug', type=float, default=0.0, help='probability of phone+lens simulation per training image; also enables the phone-sim hold-out'); p.add_argument('--init-checkpoint', default='', help='start from a dr_grader.pt'); p.add_argument('--cache', action='store_true', help='decode+resize every image once into a memmap (big speed-up, identical pixels)')
    main(p.parse_args())
