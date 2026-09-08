"""Convert the 'APTOS-2019_original_final' mirror (train/<grade>/<id>.png, test/<grade>/<id>.png) into the layout
train_dr.py expects (train.csv + train_images/<id>.png), pre-resized so 512-px training does not decode 3000-px PNGs.

Full-resolution APTOS images are 2–3k px; we keep the retinal crop and resize the long side to --size (default 640),
which is above the 512 training resolution and 2.5x the 224-px mirror used for the first model.
"""
import argparse, csv
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
import numpy as np, cv2


def crop_resize(src: Path, dst: Path, size: int):
    im = Image.open(src).convert('RGB'); a = np.asarray(im)
    gray = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY); ys, xs = np.where(gray > 10)
    if len(xs) > 100:
        a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    im = Image.fromarray(a); w, h = im.size; s = size / max(w, h)
    if s < 1: im = im.resize((round(w * s), round(h * s)), Image.Resampling.LANCZOS)
    im.save(dst, format='PNG', compress_level=3)


def main(a):
    root = Path(a.src); files = []
    for split in ('train', 'val', 'test'):
        for g in range(5):
            for p in sorted((root / split / str(g)).glob('*.png')) if (root / split / str(g)).exists() else []:
                files.append((p, g))
    out = Path(a.out); (out / 'train_images').mkdir(parents=True, exist_ok=True)
    print('images', len(files))
    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(lambda t: crop_resize(t[0], out / 'train_images' / t[0].name, a.size), files))
    with open(out / 'train.csv', 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['id_code', 'diagnosis'])
        for p, g in files: w.writerow([p.stem, g])
    counts = [sum(1 for _, g in files if g == k) for k in range(5)]
    print('done', out, 'grade counts', counts)


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--src', default='data/aptos_full/APTOS-2019_original_final'); p.add_argument('--out', default='data/aptos_full')
    p.add_argument('--size', type=int, default=640); p.add_argument('--workers', type=int, default=6); main(p.parse_args())
