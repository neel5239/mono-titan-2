import { useMemo, useState } from 'react';
import type { CropBox, GradeIndex, QualityState, Tier, TierCode } from '../api/types';
import { tFor, type Lang } from '../i18n';
import { addDays, addMonths, formatDate, formatDateObj, LESION_ORDER } from '../utils/format';
import { overlayStyle } from './ImageViewer';
import { tierTone } from './TierPill';

export interface SheetData {
  id: string;
  date: string;
  site: string | null;
  worker: string | null;
  patientId: string | null;
  patientName: string | null;
  age: number | null;
  sex: string | null;
  diabetesYears: number | null;
  eye: string;
  lang: Lang;
  gradeIndex: GradeIndex | null;
  gradeName: string | null;
  confidence: number | null;
  tier: Tier | { code: TierCode; follow_up_months: number | null };
  qualityState: QualityState | null;
  forced: boolean;
  lesionCounts: Record<string, number> | null;
  lesionColors: Record<string, string> | null;
  imageUrl: string;
  overlayUrl: string | null;
  cropBox: CropBox | null;
  qrImage: string | null;
  qrLoading?: boolean;
}

function sexLabel(t: ReturnType<typeof tFor>, sex: string | null): string {
  if (sex === 'female' || sex === 'male' || sex === 'other') return t(`sex.${sex}`);
  return sex ? sex : t('sex.unspecified');
}

function eyeLabel(t: ReturnType<typeof tFor>, eye: string): string {
  if (eye === 'right' || eye === 'left') return t(`eye.${eye}`);
  return eye;
}

export function followUpText(t: ReturnType<typeof tFor>, tier: SheetData['tier'], from: Date, lang: Lang): string {
  const m = tier.follow_up_months;
  if (m === null || m === undefined) return t('sheet.followUpNone');
  if (m === 0) return `${t('sheet.followUpWeek')} (${formatDateObj(addDays(from, 7), lang)})`;
  return formatDateObj(addMonths(from, m), lang);
}

export function PatientSheet({ data }: { data: SheetData }) {
  const t = useMemo(() => tFor(data.lang), [data.lang]);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const created = new Date(data.date);
  const from = Number.isNaN(created.getTime()) ? new Date() : created;
  const tone = tierTone(data.tier.code);
  const gradable = data.gradeIndex !== null && data.tier.code !== 'retake' && data.tier.code !== 'unavailable';
  const ovStyle = overlayStyle(data.cropBox, natural);

  const lesionRows = data.lesionCounts
    ? [...LESION_ORDER.filter((k) => k in (data.lesionCounts ?? {})), ...Object.keys(data.lesionCounts).filter((k) => !(LESION_ORDER as string[]).includes(k))]
    : [];
  const anyLesion = lesionRows.some((k) => (data.lesionCounts?.[k] ?? 0) > 0);

  return (
    <article className="sheet" lang={data.lang}>
      <header className="sheet__head">
        <div>
          <h1>{t('app.name')}</h1>
          <p>{t('sheet.subtitle')}</p>
        </div>
        <div className="sheet__meta">
          <div>
            {t('sheet.date')}: <b>{formatDate(data.date, data.lang)}</b>
          </div>
          <div>
            {t('sheet.recordId')}: <b>{data.id}</b>
          </div>
        </div>
      </header>

      <div className="sheet__grid">
        <section className="sheet__section">
          <h2>{t('sheet.patient')}</h2>
          <dl className="dl">
            <dt>{t('patient.name')}</dt>
            <dd>{data.patientName || '--'}</dd>
            <dt>{t('patient.id')}</dt>
            <dd className="mono">{data.patientId || '--'}</dd>
            <dt>{t('sheet.age')}</dt>
            <dd className="num">{data.age ?? '--'}</dd>
            <dt>{t('sheet.sex')}</dt>
            <dd>{sexLabel(t, data.sex)}</dd>
            <dt>{t('sheet.diabetesYears')}</dt>
            <dd className="num">{data.diabetesYears ?? '--'}</dd>
            <dt>{t('sheet.eye')}</dt>
            <dd>{eyeLabel(t, data.eye)}</dd>
          </dl>
        </section>
        <section className="sheet__section">
          <h2>{t('sheet.clinic')}</h2>
          <dl className="dl">
            <dt>{t('sheet.clinic')}</dt>
            <dd>{data.site || '--'}</dd>
            <dt>{t('sheet.worker')}</dt>
            <dd>{data.worker || '--'}</dd>
          </dl>
        </section>
      </div>

      <section className="sheet__result">
        <h2 className="sheet__section-title" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#54635f', fontFamily: 'var(--font-body)' }}>
          {t('sheet.grade')}
        </h2>
        {gradable && data.gradeIndex !== null ? (
          <>
            <div className="sheet__grade">{t(`grade.${data.gradeIndex}.name`)}</div>
            <p className="sheet__explain">{t(`grade.${data.gradeIndex}.explain`)}</p>
            {data.confidence !== null ? (
              <p style={{ fontSize: 12, color: '#54635f' }}>
                {t('sheet.confidence')}: <b className="num">{Math.round(data.confidence * 100)}%</b>
                {data.forced ? ` · ${t('sheet.forced')}` : ''}
              </p>
            ) : null}
          </>
        ) : (
          <p className="sheet__explain">{t('sheet.ungradable')}</p>
        )}
        <span className={`sheet__tier sheet__tier--${tone}`}>{t(`tier.${data.tier.code}.label`)}</span>
        <div>
          <h2 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#54635f', fontFamily: 'var(--font-body)', marginBottom: 4 }}>
            {t('sheet.recommendation')}
          </h2>
          <p className="sheet__action">{t(`tier.${data.tier.code}.action`)}</p>
        </div>
        <div className="sheet__follow">
          <span>{t('sheet.followUp')}:</span>
          <b>{followUpText(t, data.tier, from, data.lang)}</b>
        </div>
      </section>

      <div className="sheet__figure">
        <figure className="sheet__image" style={{ margin: 0 }}>
          <img src={data.imageUrl} alt={t('sheet.imageAlt')} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
          {data.overlayUrl ? <img className="viewer__overlay" src={data.overlayUrl} alt="" style={ovStyle} /> : null}
        </figure>
        <div className="stack">
          <section className="sheet__section">
            <h2>{t('sheet.lesionsFound')}</h2>
            {anyLesion ? (
              <ul className="sheet__lesions">
                {lesionRows.map((k) => (
                  <li key={k}>
                    <span className="legend__swatch" style={{ background: data.lesionColors?.[k] ?? '#d2521c' }} aria-hidden="true" />
                    <span>{t(`lesion.${k as (typeof LESION_ORDER)[number]}`)}</span>
                    <b>{data.lesionCounts?.[k] ?? 0}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: 13, color: '#54635f' }}>{t('sheet.noLesions')}</p>
            )}
          </section>
          <div className="sheet__qr">
            {data.qrImage ? (
              <img src={data.qrImage} alt={t('sheet.qrAlt', { id: data.id })} />
            ) : (
              <div className="sheet__qr-placeholder">{data.qrLoading ? t('sheet.qrLoading') : t('sheet.recordId') + ': ' + data.id}</div>
            )}
            <span>{t('sheet.scanQr')}</span>
          </div>
        </div>
      </div>

      <footer className="sheet__foot">{t('sheet.disclaimer')}</footer>
    </article>
  );
}
