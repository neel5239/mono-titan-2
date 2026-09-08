import type React from 'react';
import type { ModelStatus, TierCode } from '../api/types';
import { useHealth } from '../hooks/useHealth';
import { useT, type TKey } from '../i18n';
import { TierPill } from '../components/TierPill';
import { Loading } from '../components/ui';

const STAGES: { key: TKey; text: TKey; accent?: boolean }[] = [
  { key: 'about.pipe.photo', text: 'about.pipe.photo.text' },
  { key: 'about.pipe.quality', text: 'about.pipe.quality.text' },
  { key: 'about.pipe.grader', text: 'about.pipe.grader.text', accent: true },
  { key: 'about.pipe.lesions', text: 'about.pipe.lesions.text' },
  { key: 'about.pipe.decision', text: 'about.pipe.decision.text' },
  { key: 'about.pipe.sheet', text: 'about.pipe.sheet.text' },
];

const TIERS = ['routine', 'recheck', 'refer', 'refer_urgent'] as const satisfies readonly TierCode[];

function Pipeline() {
  const { t } = useT();
  const boxW = 120;
  const gap = 28;
  const h = 56;
  const width = STAGES.length * boxW + (STAGES.length - 1) * gap + 8;
  return (
    <div className="table-wrap">
      <svg className="pipeline" viewBox={`0 0 ${width} ${h + 8}`} width={width} height={h + 8} role="img" aria-label={t('about.pipeline')}>
        <defs>
          <marker id="pipe-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="pipeline__arrowhead" />
          </marker>
        </defs>
        {STAGES.map((s, i) => {
          const x = 4 + i * (boxW + gap);
          return (
            <g key={s.key}>
              <rect x={x} y={4} width={boxW} height={h} rx={10} className={`pipeline__box${s.accent ? ' pipeline__box--accent' : ''}`} />
              <text x={x + boxW / 2} y={4 + h / 2 + 4} textAnchor="middle" className="pipeline__text">
                {t(s.key)}
              </text>
              {i < STAGES.length - 1 ? <line x1={x + boxW + 3} y1={4 + h / 2} x2={x + boxW + gap - 3} y2={4 + h / 2} className="pipeline__arrow" markerEnd="url(#pipe-arrow)" /> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const METRIC_KEYS = ['qwk', 'accuracy', 'balanced_accuracy', 'referable_sensitivity', 'referable_specificity', 'mean_ap'] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

function ModelCard({ title, model }: { title: string; model: ModelStatus | undefined }) {
  const { t } = useT();
  const meta = model?.meta ?? {};
  const vm = meta.val_metrics && typeof meta.val_metrics === 'object' ? (meta.val_metrics as Record<string, unknown>) : null;
  const scalars = vm ? (METRIC_KEYS as readonly string[]).filter((k) => typeof vm[k] === 'number') : [];
  const cm = vm && Array.isArray(vm.confusion_matrix) ? (vm.confusion_matrix as number[][]) : null;
  const perLabel = vm
    ? Object.entries(vm).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, unknown>).ap === 'number')
    : [];
  return (
    <section className="card stack stack--sm">
      <div className="row row--between">
        <h3>{title}</h3>
        {model ? <span className={`pill ${model.installed ? 'pill--good' : 'pill--critical'}`}>{model.installed ? t('about.installed') : t('about.notInstalled')}</span> : null}
      </div>
      <dl className="dl">
        <dt>{t('about.model')}</dt>
        <dd className="mono">{meta.model ?? '--'}</dd>
        <dt>{t('about.trainedOn')}</dt>
        <dd>{meta.trained_on ?? '--'}</dd>
        <dt>{t('about.source')}</dt>
        <dd>{meta.source ?? '--'}</dd>
        {model?.installed ? (
          <>
            <dt>{t('about.size')}</dt>
            <dd className="num">{model.size_mb} MB</dd>
          </>
        ) : null}
      </dl>
      <div>
        <div className="xs muted" style={{ fontWeight: 600, marginBottom: 6 }}>
          {t('about.valMetrics')}
        </div>
        {!vm ? (
          <span className="muted small">{t('about.noValMetrics')}</span>
        ) : (
          <div className="stack stack--sm">
            {scalars.length > 0 ? (
              <table className="metrics-table">
                <tbody>
                  {scalars.map((k) => (
                    <tr key={k}>
                      <th scope="row">{t(`about.metric.${k as MetricKey}`)}</th>
                      <td className="num">{(vm[k] as number).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {perLabel.length > 0 ? (
              <div>
                <div className="xs muted" style={{ marginBottom: 4 }}>
                  {t('about.perLabel')}
                </div>
                <table className="metrics-table">
                  <tbody>
                    {perLabel.map(([k, v]) => {
                      const r = v as { ap: number; auc?: number };
                      return (
                        <tr key={k}>
                          <th scope="row" className="mono">
                            {k}
                          </th>
                          <td className="num">
                            {r.ap.toFixed(3)}
                            {typeof r.auc === 'number' ? ` / ${r.auc.toFixed(3)}` : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            {cm ? (
              <div>
                <div className="xs muted" style={{ marginBottom: 4 }}>
                  {t('about.confusion')}
                </div>
                <div className="cm" style={{ gridTemplateColumns: `auto repeat(${cm.length}, 1fr)` }} role="table">
                  <span />
                  {cm.map((_, j) => (
                    <span key={`h${j}`} className="cm__head num">
                      {j}
                    </span>
                  ))}
                  {cm.map((row, i) => {
                    const rowMax = Math.max(1, ...row);
                    return [
                      <span key={`r${i}`} className="cm__head num">
                        {i}
                      </span>,
                      ...row.map((v, j) => (
                        <span key={`c${i}${j}`} className={`cm__cell num${i === j ? ' cm__cell--diag' : ''}`} style={{ '--cm-a': String(v / rowMax) } as React.CSSProperties}>
                          {v}
                        </span>
                      )),
                    ];
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

export function About() {
  const { t } = useT();
  const { health, checking } = useHealth();

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1>{t('about.title')}</h1>
          <p style={{ maxWidth: 640 }}>{t('about.intro')}</p>
        </div>
      </div>

      <section className="card stack">
        <h2 className="card__title" style={{ marginBottom: 0 }}>
          {t('about.pipeline')}
        </h2>
        <Pipeline />
        <ol className="stack stack--sm small" style={{ margin: 0, paddingLeft: 20 }}>
          {STAGES.map((s) => (
            <li key={s.key}>
              <b>{t(s.key)}</b> <span className="muted">{t(s.text)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2 className="card__title">{t('about.tiers')}</h2>
        <div className="tier-list">
          {TIERS.map((code) => (
            <div key={code} className="tier-list__row">
              <TierPill code={code} large />
              <span>{t(`tier.${code}.explain`)}</span>
            </div>
          ))}
        </div>
        <p className="xs muted" style={{ marginTop: 12 }}>
          {t('about.tiersNote')}
        </p>
      </section>

      <section className="stack">
        <h2>{t('about.models')}</h2>
        {checking && !health ? (
          <Loading />
        ) : (
          <div className="grid-2 grid-2--even">
            <ModelCard title={t('home.drModel')} model={health?.models.dr_model} />
            <ModelCard title={t('home.lesionModel')} model={health?.models.lesion_model} />
            <ModelCard title={t('about.qualityModel')} model={health?.models.quality_model} />
          </div>
        )}
        <section className="card">
          <h3>{t('about.quality')}</h3>
          <p className="small muted" style={{ marginTop: 8 }}>
            {health?.models.quality_model?.installed ? t('about.qualityLearned') : t('about.qualityRules')}
          </p>
        </section>
      </section>

      <section className="card">
        <h2 className="card__title">{t('about.disclaimerTitle')}</h2>
        <p className="small">{t('about.disclaimer')}</p>
      </section>
    </div>
  );
}
