"""Deterministic image-quality gate with actionable reason codes.

Not a neural model. Measures the things field studies say make fundus images ungradable and turns each into a
specific instruction for the health worker. A failed gate is 'ungradable', never 'no DR'.
"""
from __future__ import annotations
import cv2, numpy as np
from . import quality_model

REASONS = {
    'not_fundus': 'This is not a retinal image. The camera needs the retinal lens attachment pointed at the pupil; a face or room photo cannot be graded.',
    'no_field': 'No retinal field detected. Use a fundus photo (or the phone with the retinal lens) and align the eye.',
    'blur': 'Image is blurred. Hold steady, refocus, and capture again.',
    'off_centre_left': 'Retina is off-centre. Move the camera slightly left.',
    'off_centre_right': 'Retina is off-centre. Move the camera slightly right.',
    'glare': 'Strong reflection or glare. Change the angle slightly; small glare is acceptable.',
    'glare_centre': 'Glare is covering the centre of the retina (macula). The image cannot be graded; tilt the lens slightly and retake.',
    'dark': 'Image too dark. Increase illumination or move closer.',
    'bright': 'Image over-exposed. Reduce illumination or move back.',
    'small_field': 'Retinal field too small. Move closer so the retina fills the frame.',
    'media_opacity': 'Low contrast across the whole image. Possible cataract or media opacity; grade with caution or refer for slit-lamp exam.',
    'no_lens': 'Retinal lens not detected or retina only partly visible. The result may have low accuracy; use the lens attachment for a reliable grade.',
    'ok': 'Image accepted. Ready for grading.',
}


def _field(gray):
    mask = (gray > 12).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    n, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return None
    idx = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])); area = stats[idx, cv2.CC_STAT_AREA]
    x, y, w, h = stats[idx, 0], stats[idx, 1], stats[idx, 2], stats[idx, 3]
    if area < 0.15 * gray.size:
        return None
    cx, cy = cent[idx]; r = min(w, h) / 2
    H, W = gray.shape; side_cut = (x <= 1) != (x + w >= W - 1)  # touches exactly one of left/right edge
    return cx, cy, r, area / gray.size, side_cut


def analyze_quality(img_bgr: np.ndarray, source: str = 'upload') -> dict:
    # Work at a fixed size so thresholds are resolution independent.
    h0, w0 = img_bgr.shape[:2]; s = 1024 / max(h0, w0)
    img = cv2.resize(img_bgr, (int(w0 * s), int(h0 * s)), interpolation=cv2.INTER_AREA) if s < 1 else img_bgr
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY); hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    fld = _field(gray)
    if fld:
        cx, cy, r, area, side_cut = fld
        yy, xx = np.mgrid[0:h, 0:w]; inside = ((xx - cx) ** 2 + (yy - cy) ** 2) <= (0.95 * r) ** 2
    else:
        cx, cy, r, area, side_cut = w / 2, h / 2, 0, 0, False; inside = np.ones((h, w), bool)
    g = img[..., 1].astype(np.float32)  # green channel carries vessel/lesion contrast
    gi = g[inside] if inside.any() else g.ravel()
    sharp = float(cv2.Laplacian(cv2.GaussianBlur(g, (3, 3), 0), cv2.CV_32F)[inside].var()) if inside.any() else 0.0
    brightness = float(gray[inside].mean()) if inside.any() else float(gray.mean())
    contrast = float(gi.std())
    glare_px = (hsv[..., 1] < 60) & (hsv[..., 2] > 235)
    glare_fraction = float(glare_px[inside].mean()) if inside.any() else 0.0
    centre_zone = ((xx - cx) ** 2 + (yy - cy) ** 2) <= (0.30 * max(r, 1)) ** 2 if fld else np.zeros((h, w), bool)
    glare_centre_fraction = float(glare_px[centre_zone].mean()) if centre_zone.any() else 0.0
    centre_offset = float(np.hypot(cx - w / 2, cy - h / 2) / (min(h, w) / 2))
    centre = max(0.0, 1 - centre_offset)
    field = min(1.0, max(0.0, r / (min(h, w) * 0.46)))
    sharp_s = min(1.0, sharp / 8.0)
    exposure = max(0.0, 1 - abs(brightness - 95) / 95)
    glare = max(0.0, 1 - min(1.0, glare_fraction / 0.03))
    contrast_s = min(1.0, contrast / 28.0)
    overall = round(100 * (0.28 * centre + 0.27 * sharp_s + 0.15 * glare + 0.12 * exposure + 0.10 * field + 0.08 * contrast_s), 1)

    # Fundus-likeness: retina photos are strongly red/orange with a dark surround; faces and rooms are not.
    bm, gm, rm = [float(img[..., i][inside].mean()) + 1e-6 for i in range(3)]
    warm = float((((hsv[..., 0] <= 22) | (hsv[..., 0] >= 172)) & (hsv[..., 1] > 70))[inside].mean()) if inside.any() else 0.0
    border = float((gray[[0, -1], :].mean() + gray[:, [0, -1]].mean()) / 2)
    not_fundus = (warm < 0.5) or (border > 110) or (gm / rm > 0.72 and bm / rm > 0.55 and border > 60)
    # Lens attachment signature: a clean circular retinal field, dark surround, saturated red/orange interior.
    lens_detected = bool(fld) and (border < 60) and (warm >= 0.8) and (bm / rm < 0.5) and (field >= 0.55) and not not_fundus
    reasons = []
    if not_fundus: reasons.append('not_fundus')
    elif not fld or field < 0.30: reasons.append('no_field')
    elif not lens_detected: reasons.append('no_lens')
    elif field < 0.55: reasons.append('small_field')
    if sharp_s < 0.25: reasons.append('blur')
    if abs(cx / w - 0.5) > 0.11 or (fld and side_cut): reasons.append('off_centre_right' if cx < w / 2 else 'off_centre_left')
    if glare_centre_fraction > 0.06: reasons.append('glare_centre')
    elif glare_fraction > 0.01: reasons.append('glare')
    if brightness < 40: reasons.append('dark')
    elif brightness > 175: reasons.append('bright')
    if fld and contrast_s < 0.45 and sharp_s < 0.40 and 40 <= brightness <= 175: reasons.append('media_opacity')

    # Learned coach (if trained): its multi-label probabilities decide the reasons; the OpenCV numbers stay for the bars.
    probs = quality_model.predict(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    coach = 'rules'
    if probs:
        coach = 'learned'
        # Hybrid decision: the model decides, but exposure/blur findings must also be supported by the measured
        # image statistics (guards against a pale or laser-scarred retina being called over-exposed), and the
        # colour-signature rule can add not_fundus when the model misses a flat non-retinal image.
        learned = []
        if probs.get('not_fundus', 0) >= 0.5 or not_fundus: learned.append('not_fundus')
        if probs.get('no_lens', 0) >= 0.5: learned.append('no_lens')
        if probs.get('blur', 0) >= 0.5 and sharp_s < 0.6: learned.append('blur')
        if glare_centre_fraction > 0.06: learned.append('glare_centre')
        elif probs.get('glare', 0) >= 0.5: learned.append('glare')
        if probs.get('dark', 0) >= 0.5 and brightness < 70: learned.append('dark')
        if probs.get('bright', 0) >= 0.5 and brightness > 140: learned.append('bright')
        if probs.get('off_centre', 0) >= 0.5: learned.append('off_centre')
        if 'not_fundus' in learned: learned = ['not_fundus']
        if 'off_centre' in learned:
            learned[learned.index('off_centre')] = 'off_centre_right' if cx < w / 2 else 'off_centre_left'
        # Keep rule-only findings the model does not cover.
        for rule_reason in reasons:
            if rule_reason in ('no_field', 'small_field', 'media_opacity') and rule_reason not in learned and 'not_fundus' not in learned: learned.append(rule_reason)
        reasons = learned
        not_fundus = 'not_fundus' in reasons
        lens_detected = (not not_fundus) and ('no_lens' not in reasons) and bool(fld)
    # Lens detection only makes sense for live camera capture; an uploaded fundus-camera file has no lens to detect.
    if source != 'camera':
        reasons = [x for x in reasons if x != 'no_lens']; lens_detected = None
    hard = {'not_fundus', 'no_field', 'blur', 'dark', 'bright', 'glare_centre'}
    if any(x in hard for x in reasons) or overall < 45: state = 'red'
    elif reasons or overall < 65: state = 'yellow'
    else: state = 'green'
    primary = reasons[0] if reasons else 'ok'
    gradable = state != 'red'
    return {
        'state': state, 'gradable': gradable, 'overall': overall, 'lens_detected': lens_detected, 'coach': coach, 'model_probs': probs,
        'low_accuracy_warning': (REASONS['no_lens'] if lens_detected is False and not not_fundus else None),
        'primary_reason': primary, 'message': REASONS[primary], 'reasons': reasons, 'reason_messages': [REASONS[r] for r in reasons],
        'metrics': {'centering': round(centre * 100, 1), 'sharpness': round(sharp_s * 100, 1), 'glare': round(glare * 100, 1),
                    'exposure': round(exposure * 100, 1), 'field': round(field * 100, 1), 'contrast': round(contrast_s * 100, 1)},
        'raw': {'fundus_signature': {'g_over_r': round(gm / rm, 2), 'b_over_r': round(bm / rm, 2), 'warm_fraction': round(warm, 2), 'border_brightness': round(border, 1)}, 'laplacian_var': round(sharp, 1), 'brightness': round(brightness, 1), 'green_std': round(contrast, 1), 'glare_fraction': round(glare_fraction, 4), 'glare_centre_fraction': round(glare_centre_fraction, 4)},
        'field_circle': {'x': float(cx / w), 'y': float(cy / h), 'r': float(r / min(h, w))},
    }
