import { useTheme, type ThemeMode } from '../hooks/useTheme';
import { useT } from '../i18n';
import { IconMonitor, IconMoon, IconSun } from './Icons';

const OPTIONS: { mode: ThemeMode; Icon: typeof IconSun; key: 'theme.light' | 'theme.dark' | 'theme.system' }[] = [
  { mode: 'light', Icon: IconSun, key: 'theme.light' },
  { mode: 'dark', Icon: IconMoon, key: 'theme.dark' },
  { mode: 'system', Icon: IconMonitor, key: 'theme.system' },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const { t } = useT();
  return (
    <div className="segmented" role="radiogroup" aria-label={t('app.theme')}>
      {OPTIONS.map(({ mode: m, Icon, key }) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          className="segmented__btn"
          onClick={() => setMode(m)}
          title={t(key)}
        >
          <Icon />
          <span className="visually-hidden">{t(key)}</span>
        </button>
      ))}
    </div>
  );
}
