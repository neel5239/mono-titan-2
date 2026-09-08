"""Learned quality + lens coach (models/quality_model.onnx), trained by train/train_quality.py.

Multi-label sigmoid outputs: not_fundus, no_lens, blur, glare, dark, bright, off_centre.
Used by quality.py to decide state/reasons; the OpenCV measurements remain for the metric bars and the field circle.
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'models' / 'quality_model.onnx'
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)
_sess = None; _meta = None


def available() -> bool:
    return PATH.exists()


def meta() -> dict:
    global _meta
    if _meta is None and PATH.with_suffix('.json').exists():
        _meta = json.load(open(PATH.with_suffix('.json')))
    return _meta or {}


def predict(img_rgb: np.ndarray) -> dict | None:
    """img_rgb: HxWx3 uint8 RGB. Returns {label: probability} or None if the model is not installed."""
    global _sess
    if not available(): return None
    if _sess is None:
        import onnxruntime as ort
        so = ort.SessionOptions(); so.intra_op_num_threads = 2
        _sess = ort.InferenceSession(str(PATH), so, providers=['CPUExecutionProvider'])
    m = meta(); size = m.get('input_size', 256); labels = m.get('labels', [])
    a = np.asarray(Image.fromarray(img_rgb).resize((size, size), Image.Resampling.BILINEAR)).astype(np.float32) / 255.0
    x = np.transpose((a - MEAN) / STD, (2, 0, 1))[None].astype(np.float32)
    z = _sess.run(None, {'images': x})[0][0]
    p = 1 / (1 + np.exp(-z))
    return {labels[i]: round(float(p[i]), 4) for i in range(len(labels))}
