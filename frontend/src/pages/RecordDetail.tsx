import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { ScreeningDetail } from '../api/types';
import { useHealth } from '../hooks/useHealth';
import { useT, isLang, type TFunc } from '../i18n';
import { formatDateTime, GRADE_NAMES } from '../utils/format';
import { ImageViewer } from '../components/ImageViewer';
import { GradeCard } from '../components/GradeCard';
import { PatientSheet, type SheetData } from '../components/PatientSheet';
import { QualityPill, TierPill } from '../components/TierPill';
import { Dialog, Empty, ErrorAlert, Loading, Toast } from '../components/ui';
import { IconArrowLeft, IconCheck, IconPrint, IconTrash } from '../components/Icons';

export function sheetFromRecord(r: ScreeningDetail, qrImage: string | null, qrLoading: boolean): SheetData {
  const p = r.payload;
  return {
    id: r.id,
    date: r.created_at,
    site: r.site,
    worker: r.worker,
    patientId: r.patient_id,
    patientName: r.patient_name,
    age: r.age,
    sex: r.sex,
    diabetesYears: r.diabetes_years,
    eye: r.eye,
    lang: isLang(r.lang) ? r.lang : 'en',
    gradeIndex: r.reviewer_grade !== null && r.reviewer_grade >= 0 && r.reviewer_grade <= 4 ? (r.reviewer_grade as SheetData['gradeIndex']) : (r.grade_index ?? p.grade?.grade_index ?? null),
    gradeName: r.grade ?? p.grade?.grade ?? null,
    confidence: r.confidence ?? p.grade?.confidence ?? null,
    tier: r.tier && r.tier !== p.tier?.code ? { code: r.tier, follow_up_months: followUpFor(r.tier) } : (p.tier ?? { code: r.tier ?? 'unavailable', follow_up_months: null }),
    qualityState: r.quality_state,
    forced: !!p.quality?.forced,
    lesionCounts: r.lesion_counts ?? p.lesions?.counts ?? null,
    lesionColors: p.lesions?.colors ?? null,
    imageUrl: r.image_path,
    overlayUrl: r.overlay_path,
    cropBox: p.crop_box ?? null,
    qrImage,
    qrLoading,
  };
}

/** Follow-up interval used when a reviewer changed the tier after the payload was stored. */
function followUpFor(code: ScreeningDetail['tier']): number | null {
  switch (code) {
    case 'routine':
      return 12;
    case 'recheck':
      return 6;
    case 'refer':
      return 1;
    case 'refer_urgent':
      return 0;
    default:
      return null;
  }
}

export function RecordDetail() {
  const { id = '' } = useParams();
  const { t, lang } = useT();
  const { serverDown } = useHealth();
  const navigate = useNavigate();
  const [rec, setRec] = useState<ScreeningDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    setNotFound(false);
    try {
      setRec(await api.getScreening(id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(e);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, serverDown]);

  useEffect(() => {
    if (!showSheet || qrImage || !rec) return;
    api
      .qr(rec.id)
      .then((q) => setQrImage(q.image))
      .catch(() => undefined);
  }, [showSheet, qrImage, rec]);

  const markReferral = async () => {
    if (!rec) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.referralComplete(rec.id);
      setToast(t('record.referralDone'));
      await load();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!rec) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.deleteScreening(rec.id);
      navigate('/records', { replace: true });
    } catch (e) {
      setActionError(e);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <div className="page">
        <Empty>{t('record.notFound')}</Empty>
        <div>
          <Link to="/records" className="btn btn--secondary">
            <IconArrowLeft />
            {t('records.title')}
          </Link>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">
        <ErrorAlert error={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (!rec) {
    return (
      <div className="page">
        <Loading block />
      </div>
    );
  }

  const p = rec.payload;
  const isReferral = rec.tier === 'refer' || rec.tier === 'refer_urgent';
  const tierCode = rec.tier ?? 'unavailable';
  const tier = p.tier && p.tier.code === rec.tier ? p.tier : { code: tierCode, label: t(`tier.${tierCode}.label`), action: t(`tier.${tierCode}.action`), follow_up_months: followUpFor(rec.tier), urgency: 'none' as const };
  const reviewedGradeName = rec.reviewer_grade !== null ? GRADE_NAMES[rec.reviewer_grade] : null;

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <Link to="/records" className="small">
            {t('records.title')}
          </Link>
          <h1>
            {t('record.title')} <span className="mono muted" style={{ fontSize: '0.7em', fontWeight: 400 }}>{rec.id}</span>
          </h1>
          <p>
            {rec.patient_name || t('records.anonymous')}
            {rec.patient_id ? ` · ${rec.patient_id}` : ''} · {rec.eye === 'right' || rec.eye === 'left' ? t(`eye.${rec.eye}`) : rec.eye} · {formatDateTime(rec.created_at, lang)}
          </p>
        </div>
        <div className="row">
          {isReferral && !rec.referral_completed_at ? (
            <button type="button" className="btn btn--primary" onClick={() => void markReferral()} disabled={busy}>
              <IconCheck />
              {t('record.markReferral')}
            </button>
          ) : null}
          {rec.referral_completed_at ? (
            <span className="pill pill--good pill--lg">
              {t('record.referralDone')} · {formatDateTime(rec.referral_completed_at, lang)}
            </span>
          ) : null}
          <button type="button" className="btn btn--secondary" onClick={() => setShowSheet(true)}>
            <IconPrint />
            {t('record.printSheet')}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
            <IconTrash />
            {t('record.delete')}
          </button>
        </div>
      </div>

      {actionError ? <ErrorAlert error={actionError} /> : null}

      <div className="grid-2">
        <div className="card">
          <ImageViewer
            src={rec.image_path}
            lesionOverlay={rec.overlay_path}
            camOverlay={rec.cam_path}
            cropBox={p.crop_box ?? null}
            fieldCircle={p.quality?.field_circle ?? null}
            lesions={p.lesions ? { counts: rec.lesion_counts ?? p.lesions.counts, area_pct: p.lesions.area_pct, near_macula: p.lesions.near_macula, colors: p.lesions.colors } : null}
          />
        </div>
        <div className="stack">
          <GradeCard grade={p.grade ?? null} tier={tier} why={rec.why ?? p.why ?? ''} timings={p.timings_ms ?? null} disclaimer={p.disclaimer ?? ''} quality={p.quality ?? null} />

          <section className="card">
            <h2 className="card__title">{t('record.details')}</h2>
            <dl className="dl">
              <dt>{t('records.quality')}</dt>
              <dd>
                <QualityPill state={rec.quality_state} />
                {rec.quality_reasons.length > 0 ? (
                  <span className="xs muted"> {rec.quality_reasons.map((r) => reasonLabel(t, r)).join(', ')}</span>
                ) : null}
                {rec.quality_reasons.includes('no_lens') ? (
                  <div className="lens-warning" style={{ marginTop: 8 }}>
                    <span className="lens-warning__dot" aria-hidden="true" />
                    <span>{t('quality.noLens')}</span>
                  </div>
                ) : null}
              </dd>
              <dt>{t('records.tier')}</dt>
              <dd>
                <TierPill code={rec.tier} />
              </dd>
              <dt>{t('record.site')}</dt>
              <dd>{rec.site || '--'}</dd>
              <dt>{t('record.worker')}</dt>
              <dd>{rec.worker || '--'}</dd>
              <dt>{t('record.source')}</dt>
              <dd>{rec.source === 'camera' ? t('record.source.camera') : t('record.source.upload')}</dd>
              <dt>{t('patient.age')}</dt>
              <dd className="num">{rec.age ?? '--'}</dd>
              <dt>{t('patient.sex')}</dt>
              <dd>{rec.sex === 'female' || rec.sex === 'male' || rec.sex === 'other' ? t(`sex.${rec.sex}`) : rec.sex || t('sex.unspecified')}</dd>
              <dt>{t('patient.diabetesYears')}</dt>
              <dd className="num">{rec.diabetes_years ?? '--'}</dd>
              <dt>{t('records.secondLook')}</dt>
              <dd>{t(`sl.${rec.second_look_status}`)}</dd>
              {rec.second_look_status === 'done' ? (
                <>
                  <dt>{t('record.reviewerGrade')}</dt>
                  <dd>
                    {reviewedGradeName ?? '--'} <span className="mono muted">({rec.reviewer_grade})</span>
                  </dd>
                  <dt>{t('record.reviewerNote')}</dt>
                  <dd>{rec.reviewer_note || '--'}</dd>
                </>
              ) : null}
            </dl>
          </section>
        </div>
      </div>

      {showSheet ? (
        <Dialog title={t('sheet.title')} onClose={() => setShowSheet(false)} printable>
          <div className="sheet-actions no-print" style={{ marginBottom: 16 }}>
            <button type="button" className="btn btn--primary" onClick={() => window.print()}>
              <IconPrint />
              {t('sheet.print')}
            </button>
          </div>
          <PatientSheet data={sheetFromRecord(rec, qrImage, !qrImage)} />
        </Dialog>
      ) : null}

      {confirmDelete ? (
        <Dialog title={t('record.delete')} onClose={() => setConfirmDelete(false)} small>
          <p className="small">{t('record.confirmDelete')}</p>
          <div className="row row--end" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn--secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>
              {t('app.cancel')}
            </button>
            <button type="button" className="btn btn--danger" onClick={() => void doDelete()} disabled={busy}>
              <IconTrash />
              {t('record.delete')}
            </button>
          </div>
        </Dialog>
      ) : null}

      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}

const REASON_KEYS = ['not_fundus', 'no_lens', 'no_field', 'blur', 'off_centre_left', 'off_centre_right', 'glare', 'dark', 'bright', 'small_field', 'media_opacity', 'ok'] as const;
type ReasonCode = (typeof REASON_KEYS)[number];

/** Human label for a quality reason code; unknown codes are shown verbatim. */
export function reasonLabel(t: TFunc, code: string): string {
  return (REASON_KEYS as readonly string[]).includes(code) ? t(`reason.${code as ReasonCode}`) : code;
}
