"""Phone-plus-retinal-lens capture simulation.

Reproduces what a smartphone photographing the retina through a 20D / adapter lens looks like, compared with a
desktop fundus camera image (which is what APTOS / IDRiD are):
  * retinal disc smaller than the frame, inside a dark lens ring with a soft bright rim           (ring)
  * one or more specular reflections: white / blue-white blobs and a short blue streak            (glare)
  * haze and lower contrast from the lens and the phone's tone curve                              (haze)
  * colour cast (phone white balance): warmer, or a cyan / blue tint                               (cast)
  * softer detail: phone optics + digital zoom, then JPEG compression                              (soft)
  * mild vignetting and uneven illumination                                                       (vignette)
Applied on the border-cropped retina (the same view the grader sees after the app's retina localiser), so the model
learns the artefacts, not the framing. Deterministic when an rng is passed, so a fixed "phone-simulated hold-out" can
be evaluated every epoch.
"""
from __future__ import annotations
import io
import numpy as np, cv2
from PIL import Image


def _rng(rng):
    return rng if rng is not None else np.random.default_rng()


def phone_lens(img: Image.Image, rng=None, strength: float = 1.0) -> Image.Image:
    r = _rng(rng)
    a = np.asarray(img.convert('RGB')).astype(np.float32); h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]; cx, cy = w / 2, h / 2
    rad = np.sqrt(((xx - cx) / (w / 2)) ** 2 + ((yy - cy) / (h / 2)) ** 2).astype(np.float32)

    # haze + contrast drop
    if r.random() < 0.9 * strength:
        k = r.uniform(0.55, 0.85); a = a * k + (1 - k) * r.uniform(70, 130)
    # colour cast
    if r.random() < 0.8 * strength:
        cast = r.choice(['warm', 'cyan', 'blue'])
        m = {'warm': (1.06, 1.0, 0.88), 'cyan': (0.9, 1.02, 1.08), 'blue': (0.92, 0.98, 1.12)}[cast]
        a *= np.array(m, np.float32)
    # uneven illumination / vignette
    if r.random() < 0.8 * strength:
        v = np.clip(1 - r.uniform(0.2, 0.55) * rad ** 2, 0, 1); ox, oy = r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3)
        tilt = 1 + 0.25 * ((xx - cx) / (w / 2) * ox + (yy - cy) / (h / 2) * oy); a *= (v * tilt)[..., None]
    # specular glare: 1-3 white / blue-white blobs, sometimes a streak
    if r.random() < 0.85 * strength:
        for _ in range(r.integers(1, 4)):
            gx, gy = r.uniform(0.25, 0.75) * w, r.uniform(0.25, 0.75) * h; gr = r.uniform(0.02, 0.06) * w
            g = np.exp(-((xx - gx) ** 2 + (yy - gy) ** 2) / (2 * gr ** 2))
            col = np.array(r.choice([(255, 255, 255), (200, 230, 255), (160, 200, 255)]), np.float32)
            a = a * (1 - g[..., None] * r.uniform(0.6, 1.0)) + g[..., None] * col * r.uniform(0.8, 1.0)
        if r.random() < 0.5:  # blue streak
            sx, sy = r.uniform(0.3, 0.7) * w, r.uniform(0.3, 0.7) * h; ang = r.uniform(0, np.pi); L = r.uniform(0.05, 0.15) * w
            d = np.abs(-(xx - sx) * np.sin(ang) + (yy - sy) * np.cos(ang)); along = np.abs((xx - sx) * np.cos(ang) + (yy - sy) * np.sin(ang))
            s = np.exp(-(d / (0.008 * w)) ** 2) * (along < L)
            a = a * (1 - s[..., None] * 0.8) + s[..., None] * np.array((120, 170, 255), np.float32)
    # lens ring: darken beyond the disc edge, soft bright rim just inside
    if r.random() < 0.9 * strength:
        edge = r.uniform(0.93, 1.0); ring = np.clip((rad - edge) / 0.04, 0, 1); rim = np.exp(-((rad - edge + 0.03) / 0.015) ** 2)
        a = a * (1 - ring[..., None]) + rim[..., None] * r.uniform(20, 60)
    # chromatic fringing at the lens edge: shift red and blue channels radially in opposite directions near the rim
    if r.random() < 0.6 * strength:
        px = r.uniform(2, 6) * (w / 512); band = np.clip((rad - 0.6) / 0.4, 0, 1)[..., None]  # only the outer 40% of the disc
        Mr = np.float32([[1 + px / w, 0, -px / 2], [0, 1 + px / h, -px / 2]]); Mb = np.float32([[1 - px / w, 0, px / 2], [0, 1 - px / h, px / 2]])
        red = cv2.warpAffine(a[..., 0], Mr, (w, h), borderMode=cv2.BORDER_REFLECT); blue = cv2.warpAffine(a[..., 2], Mb, (w, h), borderMode=cv2.BORDER_REFLECT)
        a[..., 0] = a[..., 0] * (1 - band[..., 0]) + red * band[..., 0]; a[..., 2] = a[..., 2] * (1 - band[..., 0]) + blue * band[..., 0]
        tint = np.exp(-((rad - 0.98) / 0.06) ** 2)[..., None]; a = a * (1 - 0.5 * tint) + 0.5 * tint * np.array(r.choice([(0, 200, 220), (230, 120, 200)]), np.float32)
    # half-frame haze: one side of the disc washed out (lens tilt / light leak)
    if r.random() < 0.5 * strength:
        ang = r.uniform(0, 2 * np.pi); proj = ((xx - cx) / (w / 2)) * np.cos(ang) + ((yy - cy) / (h / 2)) * np.sin(ang)
        hz = np.clip((proj - r.uniform(-0.2, 0.3)) / 0.6, 0, 1)[..., None] * r.uniform(0.35, 0.7); a = a * (1 - hz) + hz * r.uniform(150, 230)
    # non-black surround: skin / metal rim / room instead of the camera's black mask (hand-held lens in front of the eye)
    if r.random() < 0.5 * strength:
        edge = r.uniform(0.9, 1.0); outside = (rad > edge)[..., None]
        bg = np.array(r.choice([(196, 150, 120), (170, 120, 95), (120, 120, 125), (60, 60, 65), (210, 190, 170)]), np.float32)
        noise = r.normal(0, 8, a.shape).astype(np.float32); rim = np.exp(-((rad - edge - 0.02) / 0.02) ** 2)[..., None]
        a = np.where(outside, bg + noise, a); a = a * (1 - rim * 0.7) + rim * 0.7 * r.uniform(150, 240)
    # softness + resolution loss + JPEG
    a = np.clip(a, 0, 255).astype(np.uint8)
    if r.random() < 0.8 * strength:
        s = r.uniform(0.3, 0.85); small = cv2.resize(a, (max(64, int(w * s)), max(64, int(h * s))), interpolation=cv2.INTER_AREA)  # down to ~150 px equivalent
        a = cv2.resize(small, (w, h), interpolation=cv2.INTER_LINEAR)
    if r.random() < 0.6 * strength:
        a = cv2.GaussianBlur(a, (0, 0), r.uniform(0.6, 1.6))
    if r.random() < 0.8 * strength:
        q = int(r.integers(45, 85)); buf = io.BytesIO(); Image.fromarray(a).save(buf, format='JPEG', quality=q); a = np.asarray(Image.open(buf).convert('RGB'))
    return Image.fromarray(a)


class PhoneLensAug:
    """torchvision-style callable: applies phone_lens() with probability p."""
    def __init__(self, p=0.5, strength=1.0):
        self.p = p; self.strength = strength

    def __call__(self, img):
        return phone_lens(img, None, self.strength) if np.random.random() < self.p else img
