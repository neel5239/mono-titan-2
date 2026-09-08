import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { GradeIndex, ScreeningDetail, ScreeningRow } from '../api/types';
import { useHealth } from '../hooks/useHealth';
import { useStoredString } from '../hooks/useLocalStorage';
import { useT } from '../i18n';
import { formatDateTime, GRADE_NAMES, pct } from '../utils/format';
import { ImageViewer } from '../components/ImageViewer';
import { GradeCard } from '../components/GradeCard';
import { QualityPill, TierPill, tierLabel } from '../components/TierPill';
import { Alert, Empty, ErrorAlert, Loading, Toast } from '../components/ui';
import { IconArrowLeft, IconCheck } from '../components/Icons';

export function SecondLook() {
  const { t, lang } = useT();
  const { serverDown } = useHealth();
  const [queue, setQueue] = useState<ScreeningRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ScreeningDetail | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);
  const [grade, setGrade] = useState<GradeIndex | null>(null);
  const [note, setNote] = useState('');
  const [reviewer, setReviewer] = useStoredString('retinaedge.reviewer');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setQueue(await api.secondLookQueue());
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, serverDown]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setGrade(null);
    setNote('');
    setSubmitError(null);
    api
      .getScreening(openId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setDetailError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  const submit = async () => {
    if (!detail || grade === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.decideSecondLook(detail.id, { grade_index: grade, note: note.trim() || null, reviewer: reviewer.trim() || null });
      setQueue((q) => (q ? q.filter((r) => r.id !== detail.id) : q));
      setToast(t('secondLook.done', { tier: tierLabel(t, res.tier) }));
      setOpenId(null);
    } catch (e) {
      setSubmitError(e);
    } finally {
      setSubmitting(false);
    }
  };

  if (openId) {
    const p = detail?.payload;
    return (
      <div className="page">
        <div className="page__header">
          <div>
            <button type="button" className="link-btn" onClick={() => setOpenId(null)}>
              {t('secondLook.backToQueue')}
            </button>
            <h1>
              {t('secondLook.title')} <span className="mono muted" style={{ fontSize: '0.7em', fontWeight: 400 }}>{openId}</span>
            </h1>
            {detail ? (
              <p>
                {detail.patient_name || t('records.anonymous')}
                {detail.patient_id ? ` · ${detail.patient_id}` : ''} · {detail.eye === 'right' || detail.eye === 'left' ? t(`eye.${detail.eye}`) : detail.eye} · {formatDateTime(detail.created_at, lang)}
              </p>
            ) : null}
          </div>
        </div>

        {detailError ? (
          <ErrorAlert error={detailError} onRetry={() => setOpenId(openId)} />
        ) : !detail || !p ? (
          <Loading block />
        ) : (
          <div className="grid-2">
            <div className="stack">
              <div className="card">
                <ImageViewer
                  src={detail.image_path}
                  lesionOverlay={detail.overlay_path}
                  camOverlay={detail.cam_path}
                  cropBox={p.crop_box ?? null}
                  fieldCircle={p.quality?.field_circle ?? null}
                  lesions={p.lesions ? { counts: detail.lesion_counts ?? p.lesions.counts, area_pct: p.lesions.area_pct, near_macula: p.lesions.near_macula, colors: p.lesions.colors } : null}
                />
              </div>
              <GradeCard grade={p.grade ?? null} tier={p.tier} why={detail.why ?? p.why ?? ''} timings={null} disclaimer={p.disclaimer ?? ''} quality={p.quality ?? null} />
            </div>

            <form
              className="card stack"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <h2 className="card__title" style={{ marginBottom: 0 }}>
                {t('secondLook.reviewerGrade')}
              </h2>
              <p className="small muted">
                {t('secondLook.aiGrade')}: <b>{p.grade?.grade ?? t('grade.notAvailable')}</b>
                {p.grade ? ` (${pct(p.grade.confidence)})` : ''}
              </p>
              <div className="grade-picker" role="radiogroup" aria-label={t('secondLook.reviewerGrade')}>
                {GRADE_NAMES.map((name, i) => (
                  <label key={name} className="grade-picker__opt">
                    <input type="radio" name="grade" value={i} checked={grade === i} onChange={() => setGrade(i as GradeIndex)} />
                    <span className="grade-picker__idx">{i}</span>
                    <span>{t(`grade.${i as GradeIndex}.name`)}</span>
                    <span className="xs muted" style={{ marginLeft: 'auto' }}>
                      {name}
                    </span>
                  </label>
                ))}
              </div>
              <div className="field">
                <label className="field__label" htmlFor="sl-note">
                  {t('secondLook.note')}
                </label>
                <textarea id="sl-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('secondLook.notePlaceholder')} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="sl-reviewer">
                  {t('secondLook.reviewer')}
                </label>
                <input id="sl-reviewer" className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)} autoComplete="name" />
                <span className="field__hint">{t('patient.remembered')}</span>
              </div>
              {grade === null ? <p className="xs muted">{t('secondLook.selectGrade')}</p> : null}
              {submitError ? <ErrorAlert error={submitError} /> : null}
              <div className="row row--end">
                <button type="button" className="btn btn--ghost" onClick={() => setOpenId(null)} disabled={submitting}>
                  <IconArrowLeft />
                  {t('secondLook.backToQueue')}
                </button>
                <button type="submit" className="btn btn--primary btn--lg" disabled={grade === null || submitting}>
                  <IconCheck />
                  {submitting ? t('secondLook.submitting') : t('secondLook.submit')}
                </button>
              </div>
            </form>
          </div>
        )}
        <Toast message={toast} onDone={() => setToast(null)} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1>{t('secondLook.title')}</h1>
          <p>{queue ? t('secondLook.count', { n: queue.length }) : null}</p>
        </div>
      </div>
      <Alert kind="info">{t('secondLook.hint')}</Alert>

      {error ? (
        <ErrorAlert error={error} onRetry={() => void load()} />
      ) : queue === null ? (
        <Loading block />
      ) : queue.length === 0 ? (
        <Empty>{t('secondLook.empty')}</Empty>
      ) : (
        <div className="card card--flush table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('records.date')}</th>
                <th scope="col">{t('records.patient')}</th>
                <th scope="col">{t('records.eye')}</th>
                <th scope="col">{t('records.quality')}</th>
                <th scope="col">{t('secondLook.aiGrade')}</th>
                <th scope="col" className="num">
                  {t('records.confidence')}
                </th>
                <th scope="col">{t('records.tier')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {queue.map((r) => (
                <tr key={r.id}>
                  <td className="tnum">{formatDateTime(r.created_at, lang)}</td>
                  <td>
                    <span className="table__link">{r.patient_name || t('records.anonymous')}</span>
                    {r.patient_id ? <span className="mono xs muted"> {r.patient_id}</span> : null}
                    {r.site ? <div className="xs muted">{r.site}</div> : null}
                  </td>
                  <td>{r.eye === 'right' || r.eye === 'left' ? t(`eye.${r.eye}`) : r.eye}</td>
                  <td>
                    <QualityPill state={r.quality_state} />
                  </td>
                  <td>{r.grade ?? '--'}</td>
                  <td className="num">{pct(r.confidence)}</td>
                  <td>
                    <TierPill code={r.tier} />
                  </td>
                  <td>
                    <button type="button" className="btn btn--primary btn--sm" onClick={() => setOpenId(r.id)}>
                      {t('secondLook.open')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
