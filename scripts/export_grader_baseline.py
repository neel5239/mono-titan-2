"""Export the fundus-pretrained DR grader (ClementP/FundusDRGrading-efficientnet_b0, MIT) as an immediately usable
ONNX baseline, before our own APTOS fine-tune finishes. Same output contract as train_dr.py:
  outputs: score (1x1 regression), features (1xCxhxw) for CAM.  Sidecar JSON carries thresholds + CAM weights.
"""
import argparse, json, sys, time, warnings
from pathlib import Path
warnings.filterwarnings('ignore')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'train'))
import numpy as np, torch
from common import build_grader, GraderExport

p = argparse.ArgumentParser(); p.add_argument('--model', default='efficientnet_b0'); p.add_argument('--size', type=int, default=384)
p.add_argument('--out', default='models/dr_model.onnx'); a = p.parse_args()
m = build_grader(a.model, 'clementp').eval()
meta = GraderExport(m).export(a.out, a.size, None, {'model': a.model, 'init': 'clementp', 'trained_on': 'ClementP FundusDRGrading (APTOS+EyePACS+DDR+IDRiD), no local fine-tune yet', 'val_metrics': None})
import onnxruntime as ort
sess = ort.InferenceSession(a.out, providers=['CPUExecutionProvider'])
x = torch.randn(1, 3, a.size, a.size)
t = time.time(); s, f = sess.run(None, {'images': x.numpy()}); dt = time.time() - t
with torch.no_grad(): ref = m(x).numpy()
print(json.dumps({'score_shape': list(s.shape), 'features_shape': list(f.shape), 'max_abs_diff': float(np.abs(s - ref).max()), 'cpu_ms': int(dt * 1000), 'onnx_mb': round(Path(a.out).stat().st_size / 1e6, 1)}))
