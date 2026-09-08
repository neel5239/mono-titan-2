import { useT } from '../i18n';

const STEPS = ['step.patient', 'step.photo', 'step.result', 'step.sheet'] as const;

export function Stepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  const { t } = useT();
  return (
    <ol className="stepper" aria-label={t('step.of', { n: current, total: STEPS.length })}>
      {STEPS.map((key, i) => {
        const n = i + 1;
        const cls = n < current ? ' stepper__item--done' : n === current ? ' stepper__item--active' : '';
        return (
          <li key={key} className={`stepper__item${cls}`} aria-current={n === current ? 'step' : undefined}>
            <div className="stepper__bar" />
            <span>
              <span className="stepper__num">{n}</span>
              {t(key)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
