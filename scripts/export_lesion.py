"""Export the pretrained lesion segmentation U-Net (ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d, MIT)
to ONNX at a fixed square resolution so it runs in ONNX Runtime (server) and ONNX Runtime Web (browser).

Class order (from the toolkit): 0 background, 1 cotton wool spot, 2 hard exudate, 3 haemorrhage, 4 microaneurysm.
Input: 1x3xSxS float32, ImageNet-normalised RGB in [0,1] before normalisation.
Output: 1x5xSxS logits.
"""
import argparse, json, time, warnings
from pathlib import Path
warnings.filterwarnings('ignore')
import numpy as np, torch
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file
import segmentation_models_pytorch as smp

REPO = 'ClementP/fundus-lesions-segmentation-unet_seresnext50_32x4d'
CLASSES = ['background', 'cotton_wool_spot', 'hard_exudate', 'haemorrhage', 'microaneurysm']

def load_model():
    p = hf_hub_download(REPO, 'model.safetensors', local_dir='models/_dl/lesion_hf')
    sd = load_file(p)
    sd = {k[6:]: v for k, v in sd.items() if k.startswith('model.')}
    m = smp.Unet('tu-seresnext50_32x4d', encoder_weights=None, classes=5)
    r = m.load_state_dict(sd, strict=True)
    return m.eval()

def main(a):
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    m = load_model()
    dummy = torch.randn(1, 3, a.size, a.size)
    torch.onnx.export(m, dummy, str(out), input_names=['images'], output_names=['logits'], opset_version=17, dynamo=False)
    import onnxruntime as ort
    sess = ort.InferenceSession(str(out), providers=['CPUExecutionProvider'])
    t = time.time(); y = sess.run(None, {'images': dummy.numpy()})[0]; dt = time.time() - t
    with torch.no_grad(): ref = m(dummy).numpy()
    info = {'classes': CLASSES, 'input_size': a.size, 'normalize': 'imagenet', 'source': REPO + ' (MIT)',
            'params': int(sum(p.numel() for p in m.parameters())), 'onnx_mb': round(out.stat().st_size / 1e6, 1),
            'cpu_ms_first_run': int(dt * 1000), 'max_abs_diff_vs_torch': float(np.abs(y - ref).max())}
    json.dump(info, open(out.with_suffix('.json'), 'w'), indent=2)
    print(json.dumps(info, indent=2))

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--size', type=int, default=512); p.add_argument('--out', default='models/lesion_model.onnx')
    main(p.parse_args())
