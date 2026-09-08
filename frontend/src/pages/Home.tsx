import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useHealth } from '../hooks/useHealth';
import { useT } from '../i18n';
import { isToday } from '../utils/format';
import { StatTile } from '../components/StatTile';
import { IconArrowRight, IconCamera, IconShield } from '../components/Icons';

export function Home() {
  const { t } = useT();
  const { health, serverDown } = useHealth();
  const [today, setToday] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    if (serverDown) return;
    let cancelled = false;
    Promise.all([api.listScreenings(200), api.secondLookQueue()])
      .then(([rows, queue]) => {
        if (cancelled) return;
        setToday(rows.filter((r) => isToday(r.created_at)).length);
        setPending(queue.length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [serverDown]);

  const dr = health?.models.dr_model;
  const lesion = health?.models.lesion_model;
  const qwk = dr?.meta.val_metrics?.qwk;

  return (
    <div className="page">
      <section className="hero">
        <div className="stack stack--sm">
          <span className="badge" style={{ alignSelf: 'flex-start' }}>
            <IconShield />
            {t('app.offlineBadge')}
          </span>
          <h1>{t('app.tagline')}</h1>
          <p className="muted" style={{ maxWidth: 520 }}>
            {t('home.help')}
          </p>
        </div>
        <Link to="/screen" className="btn btn--primary btn--lg">
          <IconCamera />
          {t('home.newScreening')}
        </Link>
      </section>

      <div className="grid-3">
        <StatTile label={t('home.todayCount')} value={today === null ? '--' : String(today)} sub={serverDown ? t('home.statsUnavailable') : undefined} />
        <StatTile label={t('home.pendingSecondLook')} value={pending === null ? '--' : String(pending)} accent={!!pending} sub={pending ? undefined : undefined} />
        <div className="card">
          <div className="stat-tile__label">{t('home.models')}</div>
          <div className="model-row">
            <span>{t('home.drModel')}</span>
            {dr ? <span className={`pill ${dr.installed ? 'pill--good' : 'pill--critical'}`}>{dr.installed ? t('home.installed') : t('home.missing')}</span> : <span className="pill pill--muted">--</span>}
          </div>
          <div className="model-row">
            <span>{t('home.lesionModel')}</span>
            {lesion ? (
              <span className={`pill ${lesion.installed ? 'pill--good' : 'pill--critical'}`}>{lesion.installed ? t('home.installed') : t('home.missing')}</span>
            ) : (
              <span className="pill pill--muted">--</span>
            )}
          </div>
          {dr?.meta.trained_on ? (
            <p className="xs muted" style={{ marginTop: 8 }}>
              {t('home.trainedOn')}: {dr.meta.trained_on}
            </p>
          ) : null}
          {typeof qwk === 'number' ? (
            <p className="xs muted">
              {t('home.qwk')}: <span className="num">{qwk.toFixed(3)}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="row">
        <Link to="/records" className="btn btn--secondary">
          {t('home.viewRecords')}
          <IconArrowRight />
        </Link>
        <Link to="/second-look" className="btn btn--ghost">
          {t('home.openQueue')}
        </Link>
      </div>
    </div>
  );
}
