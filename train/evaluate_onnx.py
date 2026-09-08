"""Evaluate the exported grader ONNX exactly as the app runs it (crop -> resize -> normalise -> score -> thresholds).

Usage:
  python train/evaluate_onnx.py --csv models/holdout_ids.csv --images data/aptos/train_images --name aptos_holdout
  python train/evaluate_onnx.py --csv data/mbrset/labels_mbrset.csv --images data/mbrset/images --id-col file --label-col final_icdr --name mbrset

Writes models/eval_<name>.json with QWK, accuracy, referable sensitivity/specificity, confusion matrix.
"""
from pathlib import Path
import argparse, json
import numpy as np, pandas as pd
from PIL import Image
from sklearn.metrics import accuracy_score, balanced_accuracy_score, cohen_kappa_score, confusion_matrix, roc_auc_score
from tqdm import tqdm
import onnxruntime as ort
from common import fundus_preprocess, to_tensor_np, score_to_grade


def find(img_dir: Path, code: str):
    for ext in ['', '.png', '.jpg', '.jpeg', '.JPG', '.PNG', '.tif']:
        p = img_dir / f'{code}{ext}'
        if p.exists(): return p
    hits = list(img_dir.rglob(f'{code}*'))
    return hits[0] if hits else None


def main(a):
    meta = json.load(open(Path(a.model).with_suffix('.json'))); size = meta['input_size']; thr = meta['thresholds']
    sess = ort.InferenceSession(a.model, providers=['CPUExecutionProvider'])
    df = pd.read_csv(a.csv).dropna(subset=[a.id_col, a.label_col])
    if a.limit: df = df.sample(min(a.limit, len(df)), random_state=0)
    ys, ss, missing = [], [], 0
    for _, r in tqdm(df.iterrows(), total=len(df)):
        p = find(Path(a.images), str(r[a.id_col]))
        if p is None: missing += 1; continue
        x = to_tensor_np(fundus_preprocess(Image.open(p).convert('RGB'), size))
        s1 = sess.run(None, {'images': x})[0][0, 0]; s2 = sess.run(None, {'images': x[:, :, :, ::-1].copy()})[0][0, 0]
        ss.append(float((s1 + s2) / 2)); ys.append(int(r[a.label_col]))
    ys = np.array(ys); ss = np.array(ss); ps = np.array([score_to_grade(s, thr) for s in ss])
    ref_y = (ys >= 2).astype(int)
    out = {'name': a.name, 'n': int(len(ys)), 'missing_images': missing, 'thresholds': thr,
           'accuracy': float(accuracy_score(ys, ps)), 'balanced_accuracy': float(balanced_accuracy_score(ys, ps)),
           'qwk': float(cohen_kappa_score(ys, ps, weights='quadratic')),
           'referable_auc': float(roc_auc_score(ref_y, ss)) if 0 < ref_y.sum() < len(ref_y) else None,
           'referable_sensitivity': float(((ps >= 2) & (ys >= 2)).sum() / max(1, (ys >= 2).sum())),
           'referable_specificity': float(((ps < 2) & (ys < 2)).sum() / max(1, (ys < 2).sum())),
           'label_counts': np.bincount(ys, minlength=5).tolist(), 'confusion_matrix': confusion_matrix(ys, ps, labels=[0, 1, 2, 3, 4]).tolist()}
    Path('models').mkdir(exist_ok=True); json.dump(out, open(f'models/eval_{a.name}.json', 'w'), indent=2)
    print(json.dumps({k: v for k, v in out.items() if k != 'confusion_matrix'}, indent=2)); print('confusion', out['confusion_matrix'])


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--model', default='models/dr_model.onnx'); p.add_argument('--csv', required=True); p.add_argument('--images', required=True)
    p.add_argument('--id-col', default='id_code'); p.add_argument('--label-col', default='diagnosis'); p.add_argument('--name', default='eval'); p.add_argument('--limit', type=int, default=0)
    main(p.parse_args())
