"""Train the quality + lens coach: a small multi-label classifier that replaces the hand-written OpenCV rules.

Labels (sigmoid outputs, independent):
  0 not_fundus   image is not a retina at all (face, room, object)
  1 no_lens      retina visible but no clean lens field (partial field, bright surround, cut-off)
  2 blur         out of focus / motion blur
  3 glare        strong specular reflection
  4 dark         under-exposed
  5 bright       over-exposed
  6 off_centre   retina not centred
Plus a 'gradable' target derived from the others (none of not_fundus/no_lens-severe/blur/dark/bright).

Training data is generated on the fly from real fundus images (APTOS + IDRiD) with controlled degradations, so every
label is exact, plus real non-fundus photographs (natural-images: people, cars, animals, flowers ...) for not_fundus.
Model: timm mobilenetv3_small_100 at 256 px, ImageNet init. Exports ONNX + sidecar JSON with per-label validation AP.
"""
from pathlib import Path
import argparse, json, random, time
import numpy as np, torch, cv2
from torch import nn
from torch.utils.data import Dataset, DataLoader
from PIL import Image, ImageFilter
from sklearn.metrics import average_precision_score, roc_auc_score
from tqdm import tqdm
import timm

LABELS = ['not_fundus', 'no_lens', 'blur', 'glare', 'dark', 'bright', 'off_centre']
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)


def list_fundus(aptos, idrid):
    out = list(Path(aptos, 'train_images').glob('*.png'))
    out += list(Path(idrid).rglob('1. Original Images/*/*.jpg'))
    return sorted(out)


def list_nonfundus(root):
    return sorted([p for p in Path(root).rglob('*') if p.suffix.lower() in ('.jpg', '.jpeg', '.png')])


# ---------- degradations (each returns image, label dict) ----------
def deg_blur(a, rng):
    k = rng.uniform(2.5, 7.0); return cv2.GaussianBlur(a, (0, 0), k)

def deg_glare(a, rng):
    h, w = a.shape[:2]; cx, cy = rng.uniform(0.2, 0.8) * w, rng.uniform(0.2, 0.8) * h; r = rng.uniform(0.06, 0.16) * w
    yy, xx = np.mgrid[0:h, 0:w]; g = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r ** 2))
    return np.clip(a.astype(np.float32) + rng.uniform(170, 255) * g[..., None], 0, 255).astype(np.uint8)

def deg_dark(a, rng):
    return np.clip(a.astype(np.float32) * rng.uniform(0.12, 0.32), 0, 255).astype(np.uint8)

def deg_bright(a, rng):
    return np.clip(a.astype(np.float32) * rng.uniform(1.9, 3.0) + rng.uniform(30, 80), 0, 255).astype(np.uint8)

def deg_offcentre(a, rng):
    h, w = a.shape[:2]; dx, dy = int(rng.uniform(0.18, 0.35) * w) * rng.choice([-1, 1]), int(rng.uniform(-0.12, 0.12) * h)
    M = np.float32([[1, 0, dx], [0, 1, dy]]); return cv2.warpAffine(a, M, (w, h), borderValue=(0, 0, 0))

def deg_nolens(a, rng):
    """Retina visible but no clean lens field: crop into the retina so the dark surround disappears, or add a bright
    surround as if the phone saw the retina through a gap, or strong vignette + partial field."""
    h, w = a.shape[:2]; mode = rng.integers(0, 3)
    if mode == 0:  # zoomed crop, no border
        s = rng.uniform(0.45, 0.7); x0 = int(rng.uniform(0.1, 0.9 - s) * w); y0 = int(rng.uniform(0.1, 0.9 - s) * h)
        c = a[y0:y0 + int(s * h), x0:x0 + int(s * w)]; return cv2.resize(c, (w, h))
    if mode == 1:  # bright surround (room light) around a smaller retina
        bg = np.full_like(a, int(rng.uniform(120, 220))); s = rng.uniform(0.35, 0.6); rw, rh = int(w * s), int(h * s)
        small = cv2.resize(a, (rw, rh)); x0, y0 = int(rng.uniform(0, w - rw)), int(rng.uniform(0, h - rh))
        bg[y0:y0 + rh, x0:x0 + rw] = small; return bg
    yy, xx = np.mgrid[0:h, 0:w]; rr = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)  # heavy vignette + haze
    v = np.clip(1 - 1.2 * rr ** 2, 0, 1)[..., None]; haze = a.astype(np.float32) * 0.55 + 90
    return np.clip(haze * v + 40 * (1 - v), 0, 255).astype(np.uint8)

DEGS = {'blur': deg_blur, 'glare': deg_glare, 'dark': deg_dark, 'bright': deg_bright, 'off_centre': deg_offcentre, 'no_lens': deg_nolens}


class CoachDataset(Dataset):
    def __init__(self, fundus, nonfundus, size=256, train=True, seed=0, n_per_epoch=None):
        self.f = fundus; self.nf = nonfundus; self.size = size; self.train = train; self.seed = seed
        self.n = n_per_epoch or (len(fundus) * 2 + len(nonfundus))

    def __len__(self): return self.n

    def load(self, p):
        im = Image.open(p).convert('RGB'); im = im.resize((self.size, self.size), Image.Resampling.BILINEAR)
        return np.asarray(im).copy()

    def __getitem__(self, i):
        rng = np.random.default_rng(None if self.train else self.seed * 100003 + i)
        y = np.zeros(len(LABELS), np.float32)
        if rng.random() < 0.22 and self.nf:
            a = self.load(self.nf[rng.integers(len(self.nf))]); y[0] = 1
            if rng.random() < 0.3: a = deg_blur(a, rng)
        else:
            a = self.load(self.f[rng.integers(len(self.f))])
            k = rng.integers(0, 3)  # 0, 1 or 2 degradations
            for name in rng.choice(list(DEGS), size=k, replace=False):
                a = DEGS[name](a, rng); y[LABELS.index(name)] = 1
                if name == 'off_centre' and rng.random() < 0.5: y[1] = 1  # far off-centre also breaks the lens field
        if self.train and rng.random() < 0.5: a = a[:, ::-1].copy()
        if self.train:  # mild photometric jitter that is NOT a label
            a = np.clip(a.astype(np.float32) * rng.uniform(0.85, 1.15) + rng.uniform(-12, 12), 0, 255).astype(np.uint8)
        x = (a.astype(np.float32) / 255.0 - MEAN) / STD
        return torch.from_numpy(np.transpose(x, (2, 0, 1))), torch.from_numpy(y)


def evaluate(model, dl, device):
    model.eval(); ys, ps = [], []
    with torch.no_grad():
        for x, y in dl:
            with torch.autocast(device.type, enabled=device.type == 'cuda'):
                p = torch.sigmoid(model(x.to(device)).float())
            ys.append(y.numpy()); ps.append(p.cpu().numpy())
    ys = np.concatenate(ys); ps = np.concatenate(ps)
    out = {}
    for j, n in enumerate(LABELS):
        if 0 < ys[:, j].sum() < len(ys):
            out[n] = {'ap': round(float(average_precision_score(ys[:, j], ps[:, j])), 4), 'auc': round(float(roc_auc_score(ys[:, j], ps[:, j])), 4),
                      'acc@0.5': round(float(((ps[:, j] > 0.5) == (ys[:, j] > 0.5)).mean()), 4), 'positives': int(ys[:, j].sum())}
    out['mean_ap'] = round(float(np.mean([v['ap'] for k, v in out.items() if k != 'mean_ap'])), 4)
    return out


def main(a):
    random.seed(a.seed); np.random.seed(a.seed); torch.manual_seed(a.seed)
    device = torch.device('cuda' if torch.cuda.is_available() and not a.cpu else 'cpu')
    fundus = list_fundus(a.aptos, a.idrid); nonf = list_nonfundus(a.nonfundus) if Path(a.nonfundus).exists() else []
    rng = random.Random(a.seed); rng.shuffle(fundus); rng.shuffle(nonf)
    nf_tr, nf_va = fundus[: int(0.85 * len(fundus))], fundus[int(0.85 * len(fundus)):]
    nn_tr, nn_va = nonf[: int(0.85 * len(nonf))], nonf[int(0.85 * len(nonf)):]
    print(f'fundus {len(fundus)} (val {len(nf_va)}), non-fundus {len(nonf)} (val {len(nn_va)})')
    ds_tr = CoachDataset(nf_tr, nn_tr, a.size, True, a.seed, a.steps * a.batch_size)
    ds_va = CoachDataset(nf_va, nn_va, a.size, False, a.seed, 1200)
    dl_tr = DataLoader(ds_tr, a.batch_size, shuffle=True, num_workers=a.workers, pin_memory=device.type == 'cuda', persistent_workers=a.workers > 0)
    dl_va = DataLoader(ds_va, a.batch_size, shuffle=False, num_workers=a.workers, persistent_workers=a.workers > 0)
    model = timm.create_model(a.model, pretrained=True, num_classes=len(LABELS)).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=a.lr, total_steps=a.epochs * len(dl_tr), pct_start=0.15)
    scaler = torch.amp.GradScaler(enabled=device.type == 'cuda'); crit = nn.BCEWithLogitsLoss()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True); best = -1; hist = []
    for ep in range(1, a.epochs + 1):
        model.train(); run = 0; t0 = time.time()
        for x, y in tqdm(dl_tr, desc=f'epoch {ep}/{a.epochs}', leave=False):
            x, y = x.to(device), y.to(device); opt.zero_grad(set_to_none=True)
            with torch.autocast(device.type, enabled=device.type == 'cuda'):
                loss = crit(model(x).float(), y)
            scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step(); run += loss.item() * len(y)
        met = evaluate(model, dl_va, device); rec = {'epoch': ep, 'loss': run / len(ds_tr), 'seconds': int(time.time() - t0), **met}; hist.append(rec)
        print({k: v for k, v in rec.items() if k in ('epoch', 'loss', 'mean_ap', 'seconds')}, {k: v['auc'] for k, v in met.items() if k != 'mean_ap'})
        if met['mean_ap'] > best:
            best = met['mean_ap']; torch.save({'state_dict': model.state_dict(), 'labels': LABELS, 'val': met, 'model': a.model, 'size': a.size}, out / 'quality_coach.pt')
    ck = torch.load(out / 'quality_coach.pt', map_location='cpu'); model = timm.create_model(a.model, pretrained=False, num_classes=len(LABELS)); model.load_state_dict(ck['state_dict']); model.eval()
    torch.onnx.export(model, torch.randn(1, 3, a.size, a.size), str(out / 'quality_model.onnx'), input_names=['images'], output_names=['logits'], opset_version=17, dynamo=False)
    json.dump({'labels': LABELS, 'input_size': a.size, 'normalize': 'imagenet', 'model': a.model, 'output': 'sigmoid_logits_multilabel', 'val_metrics': ck['val'], 'source': 'Trained in this repo (train/train_quality.py)',
               'trained_on': f'{len(fundus)} fundus (APTOS+IDRiD) with synthetic degradations + {len(nonf)} non-fundus photos', 'history': hist},
              open(out / 'quality_model.json', 'w'), indent=2)
    print('Saved', out / 'quality_model.onnx', 'best mean AP', best)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--aptos', default='data/aptos'); p.add_argument('--idrid', default='data/idrid'); p.add_argument('--nonfundus', default='data/nonfundus'); p.add_argument('--out', default='models')
    p.add_argument('--model', default='mobilenetv3_small_100'); p.add_argument('--size', type=int, default=256); p.add_argument('--epochs', type=int, default=6); p.add_argument('--steps', type=int, default=250)
    p.add_argument('--batch-size', type=int, default=32); p.add_argument('--lr', type=float, default=1e-3); p.add_argument('--workers', type=int, default=4); p.add_argument('--seed', type=int, default=42); p.add_argument('--cpu', action='store_true')
    main(p.parse_args())
