import type { ReactNode } from 'react';
import type { GradeResult, QualityResult, Tier, Timings } from '../api/types';
import { useT } from '../i18n';
import { GRADE_NAMES } from '../utils/format';
import { TierPill } from './TierPill';

export interface GradeCardProps {
  grade?: GradeResult | null;
  tier: Tier;
  why: string;
  timings?: Timings | null;
  disclaimer: string;
  quality?: QualityResult | null;
  /** Action buttons rendered at the bottom of the card. */
  actions?: ReactNode;
}

function ConfidenceRing({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg className="conf__ring" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${c * v} ${c}`}
        transform="rotate(-90 32 32)"
      />
    </svg>
  );
}

export function GradeCard({ grade, tier, why, timings, disclaimer, quality, actions }: GradeCardProps) {
  const { t } = useT();

  const probs = grade
    ? [...GRADE_NAMES.filter((n) => n in grade.probabilities), ...Object.keys(grade.probabilities).filter((k) => !(GRADE_NAMES as readonly string[]).includes(k))].map(
        (name) => ({ name, p: grade.probabilities[name] ?? 0 }),
      )
    : [];
  const top = probs.reduce((m, x) => (x.p > m ? x.p : m), 0);

  return (
    <section className="card grade-card" aria-labelledby="grade-title">
      <div className="row row--between">
        <h2 id="grade-title" className="card__title" style={{ marginBottom: 0 }}>
          {t('grade.title')}
        </h2>
        <TierPill code={tier.code} large />
      </div>

      {grade ? (
        <>
          <div className="grade-card__grade">{grade.grade}</div>
          <div>
            <div className="scale5" role="img" aria-label={`${t('grade.scale')}: ${grade.grade_index}`}>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className={`scale5__seg${i < grade.grade_index ? ' scale5__seg--filled' : ''}${i === grade.grade_index ? ' scale5__seg--current' : ''}`} />
              ))}
            </div>
            <div className="scale5__labels" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i}>{i}</span>
              ))}
            </div>
          </div>

          <div className="conf">
            <ConfidenceRing value={grade.confidence} />
            <div>
              <div className="xs muted" style={{ fontWeight: 600 }}>
                {t('grade.confidence')}
              </div>
              <div className="conf__value">{Math.round(grade.confidence * 100)}%</div>
              <div className="xs muted">
                {t('grade.score')} <span className="num">{grade.score.toFixed(2)}</span> · {t('grade.model')} <span className="mono">{grade.model}</span>
              </div>
            </div>
          </div>

          {probs.length > 0 ? (
            <div className="stack stack--sm">
              <div className="xs muted" style={{ fontWeight: 600 }}>
                {t('grade.probabilities')}
              </div>
              {probs.map(({ name, p }) => (
                <div className="prob" key={name}>
                  <span>{name}</span>
                  <div className="prob__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} aria-label={name}>
                    <div className={`prob__fill${p === top ? ' prob__fill--top' : ''}`} style={{ width: `${Math.max(0, Math.min(100, p * 100))}%` }} />
                  </div>
                  <span className="prob__val">{(p * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="grade-card__grade grade-card__grade--none">{t('grade.notAvailable')}</div>
      )}

      <div>
        <div className="xs muted" style={{ fontWeight: 600 }}>
          {t('tier.title')}
        </div>
        <p style={{ fontWeight: 600 }}>{tier.action}</p>
      </div>

      <blockquote className="why">
        <div className="why__title">{t('grade.why')}</div>
        <p>{why}</p>
      </blockquote>

      {quality?.forced ? (
        <div className="xs" style={{ color: 'var(--warn)', fontWeight: 600 }}>
          {t('quality.forced')}
        </div>
      ) : null}

      {timings ? (
        <div className="timings">
          <span>
            {t('result.total')} <b>{timings.total} ms</b>
          </span>
          {timings.grader !== null ? (
            <span>
              {t('result.grader')} <b>{timings.grader} ms</b>
            </span>
          ) : null}
          {timings.lesions !== null ? (
            <span>
              {t('result.lesions')} <b>{timings.lesions} ms</b>
            </span>
          ) : null}
        </div>
      ) : null}

      {actions ? <div className="result-actions">{actions}</div> : null}

      <p className="disclaimer">{disclaimer}</p>
    </section>
  );
}
