import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { DashboardSummary, TierCode } from '../api/types';
import { useHealth } from '../hooks/useHealth';
import { useT } from '../i18n';
import { GRADE_NAMES, TIER_ORDER } from '../utils/format';
import { StatTile } from '../components/StatTile';
import { BarChart, HBars, StackedBar, type StackSegment } from '../components/BarChart';
import { tierLabel, tierTone } from '../components/TierPill';
import { Empty, ErrorAlert, Loading } from '../components/ui';
import { reasonLabel } from './RecordDetail';

function dayTick(day: string): string {
  // "2026-09-08" -> "08/09"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[3]}/${m[2]}` : day;
}

export function Dashboard() {
  const { t } = useT();
  const { serverDown } = useHealth();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.dashboard());
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, serverDown]);

  if (error) {
    return (
      <div className="page">
        <h1>{t('dash.title')}</h1>
        <ErrorAlert error={error} onRetry={() => void load()} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page">
        <h1>{t('dash.title')}</h1>
        <Loading block />
      </div>
    );
  }

  const completion = data.referred > 0 ? data.referral_completed / data.referred : null;

  const tierSegments: StackSegment[] = TIER_ORDER.filter((c) => (data.by_tier[c] ?? 0) > 0).map((code: TierCode) => ({
    label: tierLabel(t, code),
    value: data.by_tier[code] ?? 0,
    tone: tierTone(code),
  }));
  const unknownTiers = Object.entries(data.by_tier).filter(([k]) => !(TIER_ORDER as string[]).includes(k));
  for (const [k, v] of unknownTiers) tierSegments.push({ label: k || t('app.notAvailable'), value: v, tone: 'muted' });

  const reasons = Object.entries(data.quality_reasons)
    .filter(([k]) => k !== 'ok')
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: reasonLabel(t, k), value: v }));

  const grades = [...GRADE_NAMES.filter((g) => g in data.by_grade), ...Object.keys(data.by_grade).filter((g) => !(GRADE_NAMES as readonly string[]).includes(g))].map((g) => ({
    label: g,
    value: data.by_grade[g] ?? 0,
  }));

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1>{t('dash.title')}</h1>
          <p>{t('dash.subtitle')}</p>
        </div>
      </div>

      {data.total === 0 ? (
        <Empty>{t('dash.empty')}</Empty>
      ) : (
        <>
          <div className="grid-4">
            <StatTile label={t('dash.screened')} value={String(data.total)} />
            <StatTile label={t('dash.ungradableRate')} value={`${(data.ungradable_rate * 100).toFixed(0)}%`} sub={t('dash.ofTotal', { n: data.total })} accent={data.ungradable_rate >= 0.2} />
            <StatTile label={t('dash.referred')} value={String(data.referred)} accent={data.referred > 0} />
            <StatTile
              label={t('dash.referralCompletion')}
              value={completion === null ? '--' : `${(completion * 100).toFixed(0)}%`}
              sub={data.referred > 0 ? t('dash.ofReferred', { n: data.referred }) : undefined}
            />
          </div>

          <div className="grid-2 grid-2--even">
            <section className="card">
              <h2 className="card__title">{t('dash.byDay')}</h2>
              <p className="xs muted" style={{ marginBottom: 8 }}>
                {t('dash.byDayHint')}
              </p>
              <BarChart title={t('dash.byDay')} data={data.by_day.map((d) => ({ label: d.day, tick: dayTick(d.day), value: d.n }))} />
            </section>

            <section className="card stack">
              <div>
                <h2 className="card__title">{t('dash.tiers')}</h2>
                <StackedBar title={t('dash.tiers')} segments={tierSegments} />
              </div>
              {grades.length > 0 ? (
                <div>
                  <h2 className="card__title">{t('dash.byGrade')}</h2>
                  <HBars data={grades} />
                </div>
              ) : null}
              <div className="kv">
                <span>{t('dash.secondLookPending')}</span>
                <b className="num">{data.second_look_pending}</b>
              </div>
            </section>
          </div>

          <section className="card">
            <h2 className="card__title">{t('dash.whyFail')}</h2>
            <p className="xs muted" style={{ marginBottom: 12 }}>
              {t('dash.whyFailHint')}
            </p>
            {reasons.length === 0 ? <p className="small muted">{t('dash.noFailures')}</p> : <HBars data={reasons} accent />}
          </section>

          <section className="card card--flush">
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">{t('dash.sites')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('dash.site')}</th>
                    <th scope="col" className="num">
                      {t('dash.n')}
                    </th>
                    <th scope="col" className="num">
                      {t('dash.ungradable')}
                    </th>
                    <th scope="col" className="num">
                      {t('dash.referred')}
                    </th>
                    <th scope="col" className="num">
                      {t('dash.completed')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_site.map((s) => (
                    <tr key={s.site}>
                      <td>{s.site}</td>
                      <td className="num">{s.n}</td>
                      <td className="num">
                        {s.ungradable}
                        {s.n > 0 ? <span className="xs muted"> ({((s.ungradable / s.n) * 100).toFixed(0)}%)</span> : null}
                      </td>
                      <td className="num">{s.referred}</td>
                      <td className="num">
                        {s.completed}
                        {s.referred > 0 ? <span className="xs muted"> ({((s.completed / s.referred) * 100).toFixed(0)}%)</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
