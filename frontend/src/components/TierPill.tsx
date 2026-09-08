import type { TierCode } from '../api/types';
import { useT, type TFunc } from '../i18n';

export type Tone = 'good' | 'warn' | 'critical' | 'primary' | 'muted';

export function tierTone(code: TierCode | null | undefined): Tone {
  switch (code) {
    case 'routine':
      return 'good';
    case 'recheck':
      return 'warn';
    case 'refer':
    case 'refer_urgent':
      return 'critical';
    case 'second_look':
      return 'primary';
    default:
      return 'muted';
  }
}

export function tierLabel(t: TFunc, code: TierCode | null | undefined): string {
  switch (code) {
    case 'routine':
    case 'recheck':
    case 'refer':
    case 'refer_urgent':
    case 'second_look':
    case 'retake':
    case 'unavailable':
      return t(`tier.${code}.label`);
    default:
      return t('app.notAvailable');
  }
}

export function TierPill({ code, large = false }: { code: TierCode | null | undefined; large?: boolean }) {
  const { t } = useT();
  const tone = tierTone(code);
  return (
    <span className={`pill pill--${tone}${large ? ' pill--lg' : ''}`}>
      {tierLabel(t, code)}
      {code === 'refer_urgent' ? <span className="pill__tag">{t('tier.urgent')}</span> : null}
    </span>
  );
}

export function QualityPill({ state }: { state: 'green' | 'yellow' | 'red' | null | undefined }) {
  const { t } = useT();
  if (!state) return <span className="pill pill--muted">{t('app.notAvailable')}</span>;
  const tone: Tone = state === 'green' ? 'good' : state === 'yellow' ? 'warn' : 'critical';
  return <span className={`pill pill--${tone}`}>{t(`quality.${state}`)}</span>;
}
