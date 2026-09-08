"""Locate the retinal disc inside a frame and crop to it.

Why: a live camera frame (phone + lens, or a fundus photo shown on a screen) contains the retina as a small
red/orange disc surrounded by bezel, room, or screen. The grader was trained on images where the retina fills the
frame with a black surround. Cropping to the disc and blacking out the surround puts the capture back into the
training distribution; without it confidence collapses even when the retina itself is sharp.
"""
from __future__ import annotations
import numpy as np, cv2
from PIL import Image


def locate_retina(img_rgb: np.ndarray):
    """Return (cx, cy, r) in pixels of the largest warm, saturated, roughly round region, or None."""
    h, w = img_rgb.shape[:2]; s = 800 / max(h, w)
    small = cv2.resize(img_rgb, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else img_rgb
    hsv = cv2.cvtColor(small, cv2.COLOR_RGB2HSV)
    R, G, B = small[..., 0].astype(np.float32), small[..., 1].astype(np.float32), small[..., 2].astype(np.float32)
    warm = ((hsv[..., 0] <= 25) | (hsv[..., 0] >= 170)) & (hsv[..., 1] > 55) & (hsv[..., 2] > 35)
    warm &= (R > 1.3 * G + 8) & (R > 1.6 * B)   # retina is strongly red-dominant; skin (G/R ~0.75, B/R ~0.6) is not
    mask = warm.astype(np.uint8) * 255
    k = max(5, int(0.02 * max(small.shape[:2])))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    n, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1: return None
    idx = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])); area = stats[idx, cv2.CC_STAT_AREA]
    if area < 0.03 * mask.size: return None
    x, y, bw, bh = stats[idx, :4]
    # Roundness check: filled area vs bounding-box ellipse area.
    fill = area / max(1.0, np.pi * (bw / 2) * (bh / 2))
    if fill < 0.55 or max(bw, bh) / max(1, min(bw, bh)) > 1.6: return None
    pts = np.column_stack(np.nonzero(lab == idx)[::-1]).astype(np.float32)
    (cx, cy), r = cv2.minEnclosingCircle(pts)
    sc = 1 / s if s < 1 else 1.0
    return float(cx * sc), float(cy * sc), float(r * sc)


def crop_to_retina(img: Image.Image, margin: float = 0.04):
    """If the retina occupies clearly less than the frame, crop a square around it and black out the surround.
    Returns (image, crop_box, applied). crop_box is in original-image pixel coordinates."""
    a = np.asarray(img.convert('RGB')); h, w = a.shape[:2]
    loc = locate_retina(a)
    if loc is None: return img, (0, 0, w, h), False
    cx, cy, r = loc
    if 2 * r > 0.9 * min(h, w): return img, (0, 0, w, h), False   # already fills the frame; normal path handles it
    R = r * (1 + margin)
    x0, y0 = int(max(0, cx - R)), int(max(0, cy - R)); x1, y1 = int(min(w, cx + R)), int(min(h, cy + R))
    crop = a[y0:y1, x0:x1].copy()
    yy, xx = np.mgrid[0:crop.shape[0], 0:crop.shape[1]]
    inside = ((xx - (cx - x0)) ** 2 + (yy - (cy - y0)) ** 2) <= (r * (1 + margin / 2)) ** 2
    crop[~inside] = 0
    return Image.fromarray(crop), (x0, y0, x1, y1), True
