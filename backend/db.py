"""SQLite persistence for screenings, second-look queue and dashboard aggregates. Images stay on this machine."""
from __future__ import annotations
import json, sqlite3, uuid, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'; DB = DATA / 'retinaedge.db'; IMAGES = DATA / 'images'
DATA.mkdir(exist_ok=True); IMAGES.mkdir(exist_ok=True)

SCHEMA = """
CREATE TABLE IF NOT EXISTS screenings (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, site TEXT, worker TEXT,
  patient_id TEXT, patient_name TEXT, age INTEGER, sex TEXT, diabetes_years REAL, lang TEXT,
  eye TEXT, source TEXT,
  quality_state TEXT, quality_overall REAL, quality_reasons TEXT, gradable INTEGER,
  grade_index INTEGER, grade TEXT, score REAL, confidence REAL,
  tier TEXT, lesion_counts TEXT, why TEXT,
  image_path TEXT, overlay_path TEXT, cam_path TEXT,
  second_look_status TEXT DEFAULT 'none', reviewer_grade INTEGER, reviewer_note TEXT, reviewed_at TEXT,
  referral_completed_at TEXT, payload TEXT
);
CREATE INDEX IF NOT EXISTS idx_created ON screenings(created_at);
"""


def con():
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row; return c


def init():
    c = con(); c.executescript(SCHEMA); c.commit(); c.close()


def now(): return datetime.datetime.now().isoformat(timespec='seconds')


def save(rec: dict) -> str:
    sid = uuid.uuid4().hex[:12]; c = con()
    cols = ['id', 'created_at', 'site', 'worker', 'patient_id', 'patient_name', 'age', 'sex', 'diabetes_years', 'lang', 'eye', 'source',
            'quality_state', 'quality_overall', 'quality_reasons', 'gradable', 'grade_index', 'grade', 'score', 'confidence', 'tier',
            'lesion_counts', 'why', 'image_path', 'overlay_path', 'cam_path', 'second_look_status', 'payload']
    vals = [sid, now()] + [rec.get(k) for k in cols[2:]]
    c.execute(f"INSERT INTO screenings ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", vals); c.commit(); c.close()
    return sid


def get(sid: str):
    c = con(); r = c.execute('SELECT * FROM screenings WHERE id=?', (sid,)).fetchone(); c.close()
    return dict(r) if r else None


def list_recent(limit=50, tier=None, second_look=None):
    q = 'SELECT id,created_at,site,patient_id,patient_name,age,sex,eye,source,quality_state,quality_overall,gradable,grade_index,grade,confidence,tier,second_look_status,reviewer_grade,referral_completed_at FROM screenings'
    w, p = [], []
    if tier: w.append('tier=?'); p.append(tier)
    if second_look: w.append('second_look_status=?'); p.append(second_look)
    if w: q += ' WHERE ' + ' AND '.join(w)
    q += ' ORDER BY created_at DESC LIMIT ?'; p.append(limit)
    c = con(); rows = [dict(r) for r in c.execute(q, p)]; c.close(); return rows


def update(sid: str, **fields):
    if not fields: return
    c = con(); c.execute(f"UPDATE screenings SET {','.join(k + '=?' for k in fields)} WHERE id=?", list(fields.values()) + [sid]); c.commit(); c.close()


def summary():
    c = con()
    total = c.execute('SELECT COUNT(*) FROM screenings').fetchone()[0]
    by_tier = {r[0]: r[1] for r in c.execute('SELECT tier, COUNT(*) FROM screenings GROUP BY tier')}
    by_grade = {r[0]: r[1] for r in c.execute('SELECT grade, COUNT(*) FROM screenings WHERE grade IS NOT NULL GROUP BY grade')}
    ungradable = c.execute('SELECT COUNT(*) FROM screenings WHERE gradable=0').fetchone()[0]
    by_site = [dict(r) for r in c.execute('SELECT COALESCE(site,"Unassigned") site, COUNT(*) n, SUM(CASE WHEN gradable=0 THEN 1 ELSE 0 END) ungradable, SUM(CASE WHEN tier IN ("refer","refer_urgent") THEN 1 ELSE 0 END) referred, SUM(CASE WHEN referral_completed_at IS NOT NULL THEN 1 ELSE 0 END) completed FROM screenings GROUP BY site ORDER BY n DESC')]
    by_day = [dict(r) for r in c.execute('SELECT substr(created_at,1,10) day, COUNT(*) n FROM screenings GROUP BY day ORDER BY day DESC LIMIT 30')]
    by_reason = {}
    for (rs,) in c.execute('SELECT quality_reasons FROM screenings WHERE quality_reasons IS NOT NULL'):
        for r in json.loads(rs or '[]'): by_reason[r] = by_reason.get(r, 0) + 1
    pending = c.execute('SELECT COUNT(*) FROM screenings WHERE second_look_status="pending"').fetchone()[0]
    referred = c.execute('SELECT COUNT(*) FROM screenings WHERE tier IN ("refer","refer_urgent")').fetchone()[0]
    completed = c.execute('SELECT COUNT(*) FROM screenings WHERE referral_completed_at IS NOT NULL').fetchone()[0]
    c.close()
    return {'total': total, 'ungradable': ungradable, 'ungradable_rate': round(ungradable / total, 3) if total else 0, 'by_tier': by_tier, 'by_grade': by_grade,
            'by_site': by_site, 'by_day': by_day[::-1], 'quality_reasons': by_reason, 'second_look_pending': pending, 'referred': referred, 'referral_completed': completed}


init()
