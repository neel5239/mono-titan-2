"""Sanity-check the exported lesion ONNX on IDRiD pixel masks (the toolkit's class order: 0 bg, 1 CWS, 2 EX, 3 HE, 4 MA).
Reports per-class pixel AUC-PR-ish proxy (Dice at argmax) and detection recall per image. Honest numbers for the model card.
Usage: python train/evaluate_lesions_idrid.py --data data/idrid --split test
"""
from pathlib import Path
import argparse, json
import numpy as np
from PIL import Image
import onnxruntime as ort
from tqdm import tqdm
import sys; sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import to_tensor_np
from backend.inference import crop_black_border

CLS = {1: ('Soft Exudates', 'cotton_wool_spot'), 2: ('Hard Exudates', 'hard_exudate'), 3: ('Haemorrhages', 'haemorrhage'), 4: ('Microaneurysms', 'microaneurysm')}


def main(a):
    root = Path(a.data); sub = 'b. Testing Set' if a.split == 'test' else 'a. Training Set'
    imgs = sorted((next(root.rglob('1. Original Images')) / sub).glob('*.jpg'))
    gt_root = next(root.rglob('2. All Segmentation Groundtruths')) / sub
    meta = json.load(open(Path(a.model).with_suffix('.json'))); size = meta['input_size']
    sess = ort.InferenceSession(a.model, providers=['CPUExecutionProvider'])
    stats = {v[1]: {'tp': 0, 'fp': 0, 'fn': 0, 'img_gt': 0, 'img_hit': 0} for v in CLS.values()}
    for p in tqdm(imgs[:a.limit] if a.limit else imgs):
        im = Image.open(p).convert('RGB'); W, H = im.size
        cropped, (x0, y0, x1, y1) = crop_black_border(im)
        x = to_tensor_np(cropped.resize((size, size), Image.Resampling.LANCZOS))
        pred = sess.run(None, {'images': x})[0][0].argmax(0).astype(np.uint8)
        pred = np.asarray(Image.fromarray(pred).resize((x1 - x0, y1 - y0), Image.Resampling.NEAREST))
        full = np.zeros((H, W), np.uint8); full[y0:y1, x0:x1] = pred
        for ci, (folder, name) in CLS.items():
            gdir = next((d for d in gt_root.iterdir() if d.is_dir() and d.name.endswith(folder)), gt_root / folder)
            gp = list(gdir.glob(p.stem + '*'))
            gt = (np.asarray(Image.open(gp[0]).convert('L')) > 0) if gp else np.zeros((H, W), bool)
            pr = full == ci
            s = stats[name]; s['tp'] += int((pr & gt).sum()); s['fp'] += int((pr & ~gt).sum()); s['fn'] += int((~pr & gt).sum())
            if gt.any(): s['img_gt'] += 1; s['img_hit'] += int((pr & gt).sum() > 0)
    out = {}
    for name, s in stats.items():
        dice = 2 * s['tp'] / max(1, 2 * s['tp'] + s['fp'] + s['fn'])
        out[name] = {'pixel_dice': round(dice, 4), 'pixel_precision': round(s['tp'] / max(1, s['tp'] + s['fp']), 4), 'pixel_recall': round(s['tp'] / max(1, s['tp'] + s['fn']), 4),
                     'images_with_lesion': s['img_gt'], 'images_detected': s['img_hit'], 'image_recall': round(s['img_hit'] / max(1, s['img_gt']), 3)}
    res = {'dataset': f'IDRiD segmentation {a.split}', 'n_images': len(imgs[:a.limit] if a.limit else imgs), 'per_class': out}
    json.dump(res, open('models/eval_lesions_idrid.json', 'w'), indent=2); print(json.dumps(res, indent=2))


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--data', default='data/idrid'); p.add_argument('--model', default='models/lesion_model.onnx'); p.add_argument('--split', default='test'); p.add_argument('--limit', type=int, default=0)
    main(p.parse_args())
