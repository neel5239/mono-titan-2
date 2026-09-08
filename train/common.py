"""Shared preprocessing and model definitions for training, export and server inference."""
from pathlib import Path
import json
import numpy as np, cv2
from PIL import Image

CLASSES = ['No apparent DR', 'Mild NPDR', 'Moderate NPDR', 'Severe NPDR', 'Proliferative DR']
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def crop_black_border(img: Image.Image, threshold=10, pad=6):
    """Crop the dark border around the circular fundus field so the retina fills the frame."""
    a = np.asarray(img.convert('RGB'))
    gray = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY)
    mask = (gray > threshold).astype(np.uint8)
    ys, xs = np.where(mask > 0)
    if len(xs) < 100:
        return img
    x0 = max(0, int(xs.min()) - pad); x1 = min(a.shape[1], int(xs.max()) + pad + 1)
    y0 = max(0, int(ys.min()) - pad); y1 = min(a.shape[0], int(ys.max()) + pad + 1)
    return Image.fromarray(a[y0:y1, x0:x1])


def fundus_preprocess(img: Image.Image, size=384) -> Image.Image:
    img = crop_black_border(img)
    return img.resize((size, size), Image.Resampling.LANCZOS)


def to_tensor_np(img: Image.Image) -> np.ndarray:
    """PIL RGB -> 1x3xHxW float32, ImageNet normalised. Same math the browser uses."""
    a = np.asarray(img.convert('RGB')).astype(np.float32) / 255.0
    a = (a - MEAN) / STD
    return np.transpose(a, (2, 0, 1))[None]


def score_to_grade(score: float, thresholds) -> int:
    """Regression score -> ICDR grade using optimised cut points."""
    g = 0
    for t in thresholds:
        if score >= t:
            g += 1
    return int(min(g, 4))


def build_grader(name='efficientnet_b0', init='clementp'):
    """timm EfficientNet with a single regression output. init='clementp' loads the MIT fundus-pretrained weights
    (trained on APTOS+EyePACS+DDR+IDRiD) as the starting point; init='imagenet' uses timm ImageNet weights."""
    import timm, torch
    m = timm.create_model(name, pretrained=(init == 'imagenet'), num_classes=1)
    if init == 'clementp':
        from huggingface_hub import hf_hub_download
        from safetensors.torch import load_file
        p = hf_hub_download(f'ClementP/FundusDRGrading-{name}', 'model.safetensors', local_dir=f'models/_dl/grade_{name}')
        m.load_state_dict(load_file(p), strict=True)
    return m


class GraderExport:
    """Wraps a timm EfficientNet so ONNX exposes (score, feature_map). CAM = sum_c w_c * F_c + b is computed
    downstream (browser or server) from the exported classifier weights, no gradients required."""
    def __init__(self, model):
        import torch.nn as nn
        self.nn = nn
        class W(nn.Module):
            def __init__(s, m):
                super().__init__(); s.m = m
            def forward(s, x):
                f = s.m.forward_features(x)          # B x C x h x w
                score = s.m.forward_head(f)          # B x 1
                return score, f
        self.wrapped = W(model).eval()

    def export(self, path, size=384, thresholds=None, extra=None):
        import torch, json
        dummy = torch.randn(1, 3, size, size)
        torch.onnx.export(self.wrapped, dummy, str(path), input_names=['images'], output_names=['score', 'features'],
                          opset_version=17, dynamo=False)
        m = self.wrapped.m
        w = m.classifier.weight.detach().cpu().numpy()[0].tolist(); b = float(m.classifier.bias.detach().cpu().numpy()[0])
        meta = {'classes': CLASSES, 'input_size': size, 'normalize': 'imagenet', 'output': 'regression_score',
                'thresholds': thresholds or [0.5, 1.5, 2.5, 3.5], 'cam_weights': w, 'cam_bias': b}
        if extra: meta.update(extra)
        json.dump(meta, open(str(path).replace('.onnx', '.json'), 'w'), indent=2)
        return meta
