import type { QualityMetrics, QualityResult } from '../api/types';
import { useT } from '../i18n';

const METRICS: (keyof QualityMetrics)[] = ['centering', 'sharpness', 'glare', 'exposure', 'field', 'contrast'];

function fillClass(v: number): string {
  if (v < 45) return ' metric__fill--low';
  if (v < 65) return ' metric__fill--mid';
  return '';
}

export function QualityCoach({ quality }: { quality: QualityResult }) {
  const { t } = useT();
  const { state } = quality;
  return (
    <section className="card stack" aria-labelledby="qc-title">
      <h2 id="qc-title" className="card__title" style={{ marginBottom: 0 }}>
        {t('quality.title')}
      </h2>

      <div className="traffic">
        <div className="traffic__lights" aria-hidden="true">
          <span className={`traffic__light traffic__light--red${state === 'red' ? ' traffic__light--on' : ''}`} />
          <span className={`traffic__light traffic__light--yellow${state === 'yellow' ? ' traffic__light--on' : ''}`} />
          <span className={`traffic__light traffic__light--green${state === 'green' ? ' traffic__light--on' : ''}`} />
        </div>
        <div>
          <div className={`traffic__state traffic__state--${state}`}>{t(`quality.${state}`)}</div>
          <div className="small">{quality.message}</div>
          <div className="xs muted tnum">
            {t('quality.score')}: <b className="num">{Math.round(quality.overall)}</b>/100
            {' · '}
            {quality.gradable ? t('quality.gradable') : t('quality.ungradable')}
          </div>
        </div>
      </div>

      {quality.lens_detected === false && !quality.reasons.includes('not_fundus') ? (
        <div className="lens-warning" role="status">
          <span className="lens-warning__dot" aria-hidden="true" />
          <span>{t('quality.noLens')}</span>
        </div>
      ) : quality.lens_detected ? (
        <div className="xs" style={{ color: 'var(--good)', fontWeight: 600 }}>{t('quality.lensOk')}</div>
      ) : null}

      {quality.reason_messages.length > 0 ? (
        <div>
          <div className="xs muted" style={{ fontWeight: 600, marginBottom: 4 }}>
            {t('quality.reasons')}
          </div>
          <ul className="reason-list">
            {quality.reason_messages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="stack stack--sm" role="list">
        {METRICS.map((k) => {
          const v = Math.max(0, Math.min(100, quality.metrics[k]));
          return (
            <div className="metric" key={k} role="listitem">
              <span>{t(`quality.metric.${k}`)}</span>
              <div className="metric__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={t(`quality.metric.${k}`)}>
                <div className={`metric__fill${fillClass(v)}`} style={{ width: `${v}%` }} />
              </div>
              <span className="metric__val num">{Math.round(v)}</span>
            </div>
          );
        })}
      </div>

      {quality.forced ? <div className="xs" style={{ color: 'var(--warn)', fontWeight: 600 }}>{t('quality.forced')}</div> : null}
    </section>
  );
}
