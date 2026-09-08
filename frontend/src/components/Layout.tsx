import { NavLink, Outlet, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useT, type Lang } from '../i18n';
import { useHealth } from '../hooks/useHealth';
import { api } from '../api/client';
import { ThemeToggle } from './ThemeToggle';
import { IconCamera, IconChart, IconEye, IconHome, IconInfo, IconList, IconRetina, IconShield } from './Icons';

const NAV = [
  { to: '/', key: 'nav.home', Icon: IconHome, end: true, tab: true },
  { to: '/screen', key: 'nav.screen', Icon: IconCamera, end: false, tab: true },
  { to: '/records', key: 'nav.records', Icon: IconList, end: false, tab: true },
  { to: '/second-look', key: 'nav.secondLook', Icon: IconEye, end: false, tab: true },
  { to: '/dashboard', key: 'nav.dashboard', Icon: IconChart, end: false, tab: true },
  { to: '/about', key: 'nav.about', Icon: IconInfo, end: false, tab: false },
] as const;

function LangSwitch() {
  const { lang, setLang, t } = useT();
  const langs: Lang[] = ['en', 'hi'];
  return (
    <div className="segmented" role="radiogroup" aria-label={t('app.language')}>
      {langs.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={lang === l} className="segmented__btn" onClick={() => setLang(l)}>
          {l === 'en' ? 'EN' : 'हिं'}
          <span className="visually-hidden">{t(l === 'en' ? 'lang.en' : 'lang.hi')}</span>
        </button>
      ))}
    </div>
  );
}

function ServerBanner() {
  const { serverDown, refresh } = useHealth();
  const { t } = useT();
  if (!serverDown) return null;
  const msg = t('app.serverDown');
  const [before, cmd, after] = msg.split('`');
  return (
    <div className="server-banner" role="alert">
      <span>
        {before}
        {cmd ? <code>{cmd}</code> : null}
        {after}
      </span>
      <button type="button" className="btn" onClick={() => void refresh()}>
        {t('app.retry')}
      </button>
    </div>
  );
}

/** Second-look pending count for the sidebar badge. Polled lightly. */
function usePendingCount(): number | null {
  const { serverDown } = useHealth();
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (serverDown) return;
    let cancelled = false;
    const load = () =>
      api
        .secondLookQueue()
        .then((rows) => {
          if (!cancelled) setN(rows.length);
        })
        .catch(() => undefined);
    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [serverDown]);
  return n;
}

export function Layout() {
  const { t } = useT();
  const pending = usePendingCount();

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        {t('app.skipToContent')}
      </a>
      <header className="header">
        <Link to="/" className="header__brand" aria-label={t('app.name')}>
          <IconRetina />
          <span>{t('app.name')}</span>
        </Link>
        <span className="badge no-print" title={t('app.offlineBadge')}>
          <IconShield />
          <span className="badge__text">{t('app.offlineBadge')}</span>
        </span>
        <div className="header__spacer" />
        <div className="header__actions">
          <LangSwitch />
          <ThemeToggle />
        </div>
      </header>

      <nav className="sidebar" aria-label={t('app.menu')}>
        {NAV.map(({ to, key, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `navlink${isActive ? ' navlink--active' : ''}`}>
            <Icon />
            <span>{t(key)}</span>
            {key === 'nav.secondLook' && pending ? <span className="navlink__count">{pending}</span> : null}
          </NavLink>
        ))}
        <div className="sidebar__footer xs muted">
          <p>{t('app.tagline')}</p>
        </div>
      </nav>

      <main id="main" className="main">
        <ServerBanner />
        <Outlet />
      </main>

      <nav className="tabbar" aria-label={t('app.menu')}>
        {NAV.filter((n) => n.tab).map(({ to, key, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `tabbar__item${isActive ? ' tabbar__item--active' : ''}`}>
            <Icon />
            <span>{t(key)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
