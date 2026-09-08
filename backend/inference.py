"""ONNX inference for the DR grader and the lesion segmenter, plus CAM and overlay rendering.

Contract (mirrors the browser implementation):
  grader:  images 1x3x384x384 -> score 1x1 (regression 0..4), features 1xCxhxw
  lesion:  images 1x3x512x512 -> logits 1x5x512x512
Both take ImageNet-normalised RGB after black-border crop (train/common.py).
"""
from __future__ import annotations
import base64, io, json, time
from pathlib import Path
import numpy as np, cv2
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'models'
CLASSES = ['No apparent DR', 'Mild NPDR', 'Moderate NPDR', 'Severe NPDR', 'Proliferative DR']
LESION_CLASSES = ['background', 'cotton_wool_spot', 'hard_exudate', 'haemorrhage', 'microaneurysm']
LESION_COLORS = {'microaneurysm': (255, 82, 82), 'haemorrhage': (196, 48, 160), 'hard_exudate': (255, 204, 0), 'cotton_wool_spot': (56, 214, 214)}
MEAN = np.array([0.485, 0.456, 0.406], np.float32); STD = np.array([0.229, 0.224, 0.225], np.float32)

_sessions: dict = {}


def crop_black_border(img: Image.Image, threshold=10, pad=6):
    a = np.asarray(img.convert('RGB')); gray = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY)
    ys, xs = np.where(gray > threshold)
    if len(xs) < 100: return img, (0, 0, a.shape[1], a.shape[0])
    x0 = max(0, int(xs.min()) - pad); x1 = min(a.shape[1], int(xs.max()) + pad + 1)
    y0 = max(0, int(ys.min()) - pad); y1 = min(a.shape[0], int(ys.max()) + pad + 1)
    return Image.fromarray(a[y0:y1, x0:x1]), (x0, y0, x1, y1)


def to_input(img: Image.Image, size: int) -> np.ndarray:
    a = np.asarray(img.resize((size, size), Image.Resampling.LANCZOS).convert('RGB')).astype(np.float32) / 255.0
    return np.transpose((a - MEAN) / STD, (2, 0, 1))[None].astype(np.float32)


def _session(name):
    if name in _sessions: return _sessions[name]
    p = MODELS / f'{name}.onnx'
    if not p.exists(): return None
    import onnxruntime as ort
    so = ort.SessionOptions(); so.intra_op_num_threads = 4
    sess = ort.InferenceSession(str(p), so, providers=['CPUExecutionProvider'])
    meta = json.load(open(p.with_suffix('.json'))) if p.with_suffix('.json').exists() else {}
    _sessions[name] = (sess, meta); return _sessions[name]


def model_status():
    out = {}
    for n in ['dr_model', 'lesion_model', 'quality_model']:
        p = MODELS / f'{n}.onnx'
        meta = json.load(open(p.with_suffix('.json'))) if p.with_suffix('.json').exists() else {}
        out[n] = {'installed': p.exists(), 'size_mb': round(p.stat().st_size / 1e6, 1) if p.exists() else 0,
                  'meta': {k: v for k, v in meta.items() if k not in ('cam_weights', 'history')}}
    return out


def png_b64(arr_rgb_or_rgba: np.ndarray) -> str:
    im = Image.fromarray(arr_rgb_or_rgba); buf = io.BytesIO(); im.save(buf, format='PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def score_to_grade(score, thr):
    return int(min(4, sum(1 for t in thr if score >= t)))


def grade(img: Image.Image) -> dict | None:
    s = _session('dr_model')
    if s is None: return None
    sess, meta = s; size = meta.get('input_size', 384); thr = meta.get('thresholds', [0.5, 1.5, 2.5, 3.5])
    x = to_input(img, size); t0 = time.time()
    score, feat = sess.run(None, {'images': x})
    score_f, feat_f = sess.run(None, {'images': x[:, :, :, ::-1].copy()})  # TTA: horizontal flip
    ms = int((time.time() - t0) * 1000)
    scores = np.array([float(score[0, 0]), float(score_f[0, 0])]); sc = float(scores.mean()); sd = float(scores.std())
    g = score_to_grade(sc, thr)
    # Confidence heuristic: distance to nearest threshold (ordinal ambiguity) and TTA disagreement.
    dist = min(abs(sc - t) for t in thr)
    conf = float(np.clip(0.55 * min(1.0, dist / 0.40) + 0.45 * (1 - min(1.0, sd / 0.30)), 0, 1))
    # Soft class distribution from score for the UI (Gaussian around the score, sigma 0.45).
    centres = np.array([0, 1, 2, 3, 4], np.float32); probs = np.exp(-0.5 * ((centres - sc) / 0.45) ** 2); probs /= probs.sum()
    # CAM = sum_c w_c * F_c + b, from the exported linear head (no gradients needed).
    w = np.array(meta.get('cam_weights'), np.float32); f = (feat[0] + feat_f[0][:, :, ::-1]) / 2
    cam = np.tensordot(w, f, axes=(0, 0)); cam = np.maximum(cam, 0); cam = cam / (cam.max() + 1e-6)
    return {'score': round(sc, 3), 'tta_std': round(sd, 3), 'grade_index': g, 'grade': CLASSES[g], 'confidence': round(conf, 3),
            'probabilities': {CLASSES[i]: round(float(probs[i]), 3) for i in range(5)}, 'thresholds': [round(t, 3) for t in thr],
            'model': meta.get('model', 'efficientnet'), 'trained_on': meta.get('trained_on'), 'inference_ms': ms, '_cam': cam}


def render_cam(cam: np.ndarray, base: Image.Image) -> str:
    h, w = base.size[1], base.size[0]
    cm = cv2.resize(cam.astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    heat = cv2.applyColorMap((cm * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)[..., ::-1]
    alpha = (np.clip(cm, 0, 1) * 200).astype(np.uint8)
    rgba = np.dstack([heat, alpha]); return png_b64(rgba)


def lesions(img: Image.Image, field_mask: np.ndarray | None = None) -> dict | None:
    s = _session('lesion_model')
    if s is None: return None
    sess, meta = s; size = meta.get('input_size', 512)
    x = to_input(img, size); t0 = time.time(); logits = sess.run(None, {'images': x})[0][0]; ms = int((time.time() - t0) * 1000)
    prob = np.exp(logits - logits.max(0, keepdims=True)); prob /= prob.sum(0, keepdims=True)
    mask = prob.argmax(0).astype(np.uint8)
    # Suppress predictions outside the retinal field.
    yy, xx = np.mgrid[0:size, 0:size]; circ = ((xx - size / 2) ** 2 + (yy - size / 2) ** 2) <= (0.49 * size) ** 2
    mask[~circ] = 0
    W, H = img.size; overlay = np.zeros((H, W, 4), np.uint8)
    counts, areas, centre_flags = {}, {}, {}
    cx, cy, rr = W / 2, H / 2, min(W, H) * 0.18  # macular region approximation: central 18% radius
    for ci, name in enumerate(LESION_CLASSES):
        if ci == 0: continue
        m = (mask == ci).astype(np.uint8)
        m_full = cv2.resize(m, (W, H), interpolation=cv2.INTER_NEAREST)
        n, lab, stats, cent = cv2.connectedComponentsWithStats(m_full, 8)
        keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= (4 if name == 'microaneurysm' else 12)]
        counts[name] = len(keep); areas[name] = round(100.0 * sum(stats[i, cv2.CC_STAT_AREA] for i in keep) / (W * H), 3)
        centre_flags[name] = any(np.hypot(cent[i][0] - cx, cent[i][1] - cy) < rr for i in keep)
        if keep:
            m2 = np.isin(lab, keep).astype(np.uint8)
            contours, _ = cv2.findContours(m2, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            col = LESION_COLORS[name]
            fill = np.zeros((H, W), np.uint8); cv2.drawContours(fill, contours, -1, 1, -1)
            overlay[fill == 1, :3] = col; overlay[fill == 1, 3] = 70
            edge = np.zeros((H, W), np.uint8); cv2.drawContours(edge, contours, -1, 1, max(1, W // 400))
            overlay[edge == 1, :3] = col; overlay[edge == 1, 3] = 255
    return {'counts': counts, 'area_pct': areas, 'near_macula': centre_flags, 'overlay': png_b64(overlay),
            'colors': {k: '#%02x%02x%02x' % v for k, v in LESION_COLORS.items()}, 'inference_ms': ms, 'model': meta.get('source')}


def explain(grade_res: dict, les: dict | None, quality: dict) -> str:
    g = grade_res['grade_index']; name = grade_res['grade']
    if not les:
        return f'Graded {name} from the overall retinal appearance (lesion model not installed).'
    c = les['counts']; parts = []
    if c.get('microaneurysm'): parts.append(f"{c['microaneurysm']} microaneurysm{'s' if c['microaneurysm'] > 1 else ''}")
    if c.get('haemorrhage'): parts.append(f"{c['haemorrhage']} haemorrhage{'s' if c['haemorrhage'] > 1 else ''}")
    if c.get('hard_exudate'): parts.append(f"hard exudates{' near the macula' if les['near_macula'].get('hard_exudate') else ''}")
    if c.get('cotton_wool_spot'): parts.append(f"{c['cotton_wool_spot']} cotton wool spot{'s' if c['cotton_wool_spot'] > 1 else ''}")
    found = ', '.join(parts) if parts else 'no distinct lesions'
    if g == 0: base = f'No apparent DR: {found} detected by the lesion model.' if not parts else f'Graded No apparent DR by the grader, but the lesion model found {found}. Review recommended.'
    elif g == 1: base = f'Mild NPDR: {found}. Microaneurysms only is the ICDR definition of mild disease.'
    elif g == 2: base = f'Moderate NPDR: {found}. More than microaneurysms but less than severe NPDR.'
    elif g == 3: base = f'Severe NPDR: {found}. Extensive haemorrhages or cotton wool spots meet the ICDR severe criteria.'
    else: base = f'Proliferative DR: {found}, with an overall appearance the grader associates with neovascularisation.'
    if quality.get('reasons'): base += ' Image quality was borderline (' + ', '.join(quality['reasons']) + '), so treat this as a screening result only.'
    return base


def tier(grade_res: dict | None, quality: dict, les: dict | None) -> dict:
    if not quality['gradable']:
        return {'code': 'retake', 'label': 'Retake image', 'action': quality['message'], 'follow_up_months': None, 'urgency': 'none'}
    if grade_res is None:
        return {'code': 'unavailable', 'label': 'Model not installed', 'action': 'Install the grader model to screen.', 'follow_up_months': None, 'urgency': 'none'}
    g = grade_res['grade_index']; conf = grade_res['confidence']
    disagree = les is not None and g == 0 and (les['counts'].get('haemorrhage', 0) >= 3 or les['counts'].get('hard_exudate', 0) >= 3)
    if conf < 0.5 or disagree or (quality['state'] == 'yellow' and g >= 1):
        return {'code': 'second_look', 'label': 'Second look', 'action': 'Uncertain result. Sent to a remote grader; the patient will be contacted within 3 days.', 'follow_up_months': None, 'urgency': 'low'}
    if g == 0: return {'code': 'routine', 'label': 'Routine', 'action': 'No DR found. Screen again in 12 months. Keep sugar and blood pressure controlled.', 'follow_up_months': 12, 'urgency': 'none'}
    if g == 1: return {'code': 'recheck', 'label': 'Recheck', 'action': 'Early changes. Sugar-control counselling; recheck in 6 months.', 'follow_up_months': 6, 'urgency': 'low'}
    if g == 2: return {'code': 'refer', 'label': 'Refer', 'action': 'Refer to the district hospital eye department within 4 weeks.', 'follow_up_months': 1, 'urgency': 'medium'}
    return {'code': 'refer_urgent', 'label': 'Refer urgently', 'action': 'Sight-threatening. Refer to an ophthalmologist within 1 week.', 'follow_up_months': 0, 'urgency': 'high'}


def analyze(img: Image.Image, quality: dict, want_images=True) -> dict:
    cropped, box = crop_black_border(img)
    t0 = time.time()
    g = grade(cropped) if quality['gradable'] else None
    les = lesions(cropped) if (quality['gradable'] and g is not None) else None
    out = {'quality': quality, 'crop_box': box, 'image_size': [cropped.size[0], cropped.size[1]]}
    if g:
        cam = g.pop('_cam'); out['grade'] = g
        if want_images: out['cam'] = {'overlay': render_cam(cam, cropped), 'grid': [[round(float(v), 3) for v in row] for row in cam]}
    if les: out['lesions'] = les
    out['tier'] = tier(g, quality, les)
    out['why'] = explain(g, les, quality) if g else quality['message']
    out['timings_ms'] = {'total': int((time.time() - t0) * 1000), 'grader': g['inference_ms'] if g else None, 'lesions': les['inference_ms'] if les else None}
    out['disclaimer'] = 'Research prototype. Not a medical device. Not clinically validated.'
    return out
