"""RetinaEdge API. Runs fully on this machine; no cloud calls."""
from __future__ import annotations
import base64, io, json
from pathlib import Path
import numpy as np, cv2
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from . import db
from .quality import analyze_quality, REASONS
from .inference import analyze as run_analyze, model_status, MODELS, LESION_COLORS
from .localize import crop_to_retina

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'frontend' / 'dist'
app = FastAPI(title='RetinaEdge API', version='0.2.0')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])
app.mount('/models', StaticFiles(directory=MODELS), name='models')
app.mount('/images', StaticFiles(directory=db.IMAGES), name='images')


def read_image(data: bytes) -> Image.Image:
    try: return Image.open(io.BytesIO(data)).convert('RGB')
    except Exception: raise HTTPException(400, 'Invalid image file')


def bgr(img: Image.Image): return cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)


def _circle_to_original(fc: dict, box, W0: int, H0: int) -> dict:
    """field_circle is given as fractions of the (cropped) image; re-express it as fractions of the original frame."""
    x0, y0, x1, y1 = box; cw, ch = x1 - x0, y1 - y0
    return {'x': (x0 + fc['x'] * cw) / W0, 'y': (y0 + fc['y'] * ch) / H0, 'r': fc['r'] * min(cw, ch) / min(W0, H0)}


@app.get('/api/health')
def health():
    return {'ok': True, 'offline': True, 'models': model_status(), 'lesion_colors': {k: '#%02x%02x%02x' % v for k, v in LESION_COLORS.items()}, 'quality_reasons': REASONS}


@app.get('/api/models/manifest')
def manifest():
    out = []
    for p in sorted(MODELS.glob('*.onnx')):
        meta = json.load(open(p.with_suffix('.json'))) if p.with_suffix('.json').exists() else {}
        out.append({'name': p.stem, 'url': f'/models/{p.name}', 'meta_url': f'/models/{p.stem}.json', 'size_mb': round(p.stat().st_size / 1e6, 1), 'input_size': meta.get('input_size')})
    return {'models': out}


@app.post('/api/quality')
async def quality(file: UploadFile = File(...), source: str = Form('upload')):
    img = read_image(await file.read())
    W0, H0 = img.size; img, box, located = crop_to_retina(img)
    q = analyze_quality(bgr(img), source); q['retina_crop'] = {'box': box, 'applied': located}
    if located: q['field_circle'] = _circle_to_original(q['field_circle'], box, W0, H0)
    return q


@app.post('/api/analyze')
async def analyze(file: UploadFile = File(...), eye: str = Form('right'), source: str = Form('upload'), force: bool = Form(False)):
    img = read_image(await file.read())
    W0, H0 = img.size; img, box, located = crop_to_retina(img)   # camera frame / screen photo: isolate the retinal disc first
    q = analyze_quality(bgr(img), source); q['retina_crop'] = {'box': box, 'applied': located}
    if located: q['field_circle'] = _circle_to_original(q['field_circle'], box, W0, H0)
    if force and not q['gradable'] and 'not_fundus' not in q['reasons']:
        q = {**q, 'gradable': True, 'forced': True}
    out = run_analyze(img, q); out['eye'] = eye; out['source'] = source
    if located:  # express crop_box and field circle in original-image coordinates so the frontend overlays line up
        bx0, by0, bx1, by1 = box; cx0, cy0, cx1, cy1 = out['crop_box']; out['crop_box'] = [bx0 + cx0, by0 + cy0, bx0 + cx1, by0 + cy1]
        out['retina_crop'] = {'box': box, 'applied': True}
    return out


class SaveBody(BaseModel):
    image_data: str                     # data URL of the (cropped or original) image
    result: dict                        # the /api/analyze response
    eye: str = 'right'; source: str = 'upload'
    site: str | None = None; worker: str | None = None
    patient_id: str | None = None; patient_name: str | None = None; age: int | None = None; sex: str | None = None
    diabetes_years: float | None = None; lang: str = 'en'


def _save_data_url(data_url: str, path: Path):
    raw = base64.b64decode(data_url.split(',', 1)[-1]); path.write_bytes(raw)


@app.post('/api/screenings')
def create_screening(b: SaveBody):
    r = b.result; q = r.get('quality', {}); g = r.get('grade'); les = r.get('lesions'); tier = r.get('tier', {})
    sid_tmp = db.uuid.uuid4().hex[:12]
    img_path = db.IMAGES / f'{sid_tmp}.jpg'; _save_data_url(b.image_data, img_path)
    ov = cam = None
    if les and les.get('overlay'): ov = db.IMAGES / f'{sid_tmp}_lesions.png'; _save_data_url(les['overlay'], ov)
    if r.get('cam', {}).get('overlay'): cam = db.IMAGES / f'{sid_tmp}_cam.png'; _save_data_url(r['cam']['overlay'], cam)
    slim = {k: v for k, v in r.items() if k not in ('cam',)}
    if slim.get('lesions'): slim['lesions'] = {k: v for k, v in slim['lesions'].items() if k != 'overlay'}
    rec = dict(site=b.site, worker=b.worker, patient_id=b.patient_id, patient_name=b.patient_name, age=b.age, sex=b.sex, diabetes_years=b.diabetes_years, lang=b.lang,
               eye=b.eye, source=b.source, quality_state=q.get('state'), quality_overall=q.get('overall'), quality_reasons=json.dumps(q.get('reasons', [])), gradable=int(bool(q.get('gradable'))),
               grade_index=g.get('grade_index') if g else None, grade=g.get('grade') if g else None, score=g.get('score') if g else None, confidence=g.get('confidence') if g else None,
               tier=tier.get('code'), lesion_counts=json.dumps(les.get('counts', {})) if les else None, why=r.get('why'),
               image_path=f'/images/{img_path.name}', overlay_path=f'/images/{ov.name}' if ov else None, cam_path=f'/images/{cam.name}' if cam else None,
               second_look_status='pending' if tier.get('code') == 'second_look' else 'none', payload=json.dumps(slim))
    sid = db.save(rec)
    return {'id': sid, 'qr': qr_payload(sid)}


def qr_payload(sid: str):
    rec = db.get(sid)
    return {'text': f'retinaedge://screening/{sid}', 'summary': {'id': sid, 'grade': rec.get('grade'), 'tier': rec.get('tier'), 'date': rec.get('created_at'), 'eye': rec.get('eye')}}


@app.get('/api/screenings')
def list_screenings(limit: int = Query(50, le=500), tier: str | None = None, second_look: str | None = None):
    return db.list_recent(limit, tier, second_look)


@app.get('/api/screenings/{sid}')
def get_screening(sid: str):
    r = db.get(sid)
    if not r: raise HTTPException(404, 'Not found')
    r['payload'] = json.loads(r['payload'] or '{}'); r['quality_reasons'] = json.loads(r['quality_reasons'] or '[]'); r['lesion_counts'] = json.loads(r['lesion_counts'] or '{}')
    r['qr'] = qr_payload(sid); return r


@app.get('/api/qr/{sid}')
def qr_png(sid: str):
    import qrcode
    q = qrcode.QRCode(box_size=6, border=2); q.add_data(f'retinaedge://screening/{sid}'); q.make(fit=True)
    im = q.make_image(fill_color='black', back_color='white'); buf = io.BytesIO(); im.save(buf, format='PNG')
    return {'id': sid, 'image': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}


class Decision(BaseModel):
    grade_index: int; note: str | None = None; reviewer: str | None = None


@app.get('/api/second-look')
def second_look_queue(): return db.list_recent(200, second_look='pending')


@app.post('/api/second-look/{sid}')
def second_look_decide(sid: str, d: Decision):
    if not db.get(sid): raise HTTPException(404, 'Not found')
    tier = 'routine' if d.grade_index == 0 else 'recheck' if d.grade_index == 1 else 'refer' if d.grade_index == 2 else 'refer_urgent'
    db.update(sid, second_look_status='done', reviewer_grade=d.grade_index, reviewer_note=d.note, reviewed_at=db.now(), tier=tier)
    return {'id': sid, 'tier': tier}


@app.post('/api/screenings/{sid}/referral-complete')
def referral_complete(sid: str):
    if not db.get(sid): raise HTTPException(404, 'Not found')
    db.update(sid, referral_completed_at=db.now()); return {'ok': True}


@app.delete('/api/screenings/{sid}')
def delete_screening(sid: str):
    r = db.get(sid)
    if not r: raise HTTPException(404, 'Not found')
    for k in ('image_path', 'overlay_path', 'cam_path'):
        if r.get(k):
            p = db.IMAGES / Path(r[k]).name
            if p.exists(): p.unlink()
    c = db.con(); c.execute('DELETE FROM screenings WHERE id=?', (sid,)); c.commit(); c.close(); return {'ok': True}


@app.get('/api/dashboard/summary')
def dashboard(): return db.summary()


# Serve the built frontend (Vite dist) when present; the dev server proxies /api during development.
if DIST.exists():
    app.mount('/assets', StaticFiles(directory=DIST / 'assets'), name='assets')

    @app.get('/{path:path}')
    def spa(path: str):
        f = DIST / path
        if path and f.exists() and f.is_file(): return FileResponse(f)
        return FileResponse(DIST / 'index.html')
