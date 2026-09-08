import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ScreeningRow, TierCode } from '../api/types';
import { useHealth } from '../hooks/useHealth';
import { useT } from '../i18n';
import { formatDateTime, pct, TIER_ORDER } from '../utils/format';
import { QualityPill, TierPill, tierLabel } from '../components/TierPill';
import { Empty, ErrorAlert, Loading } from '../components/ui';

export function Records() {
  const { t, lang } = useT();
  const { serverDown } = useHealth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ScreeningRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tier, setTier] = useState<TierCode | ''>('');

  const load = useCallback(async () => {
    setError(null);
    setRows(null);
    try {
      setRows(await api.listScreenings(200, tier || undefined));
    } catch (e) {
      setError(e);
    }
  }, [tier]);

  useEffect(() => {
    void load();
  }, [load, serverDown]);

  const open = (id: string) => navigate(`/records/${id}`);

  return (
    <div className="page">
      <div className="page__header">
        <div>
          <h1>{t('records.title')}</h1>
          {rows ? <p>{t('records.count', { n: rows.length })}</p> : null}
        </div>
      </div>

      <div className="chips" role="group" aria-label={t('records.filter')}>
        <button type="button" className="chip" aria-pressed={tier === ''} onClick={() => setTier('')}>
          {t('records.filterAll')}
        </button>
        {TIER_ORDER.map((code) => (
          <button key={code} type="button" className="chip" aria-pressed={tier === code} onClick={() => setTier(code)}>
            {tierLabel(t, code)}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorAlert error={error} onRetry={() => void load()} />
      ) : rows === null ? (
        <Loading block />
      ) : rows.length === 0 ? (
        <Empty>{tier ? t('records.emptyFiltered') : t('records.empty')}</Empty>
      ) : (
        <div className="card card--flush table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('records.date')}</th>
                <th scope="col">{t('records.patient')}</th>
                <th scope="col">{t('records.eye')}</th>
                <th scope="col">{t('records.quality')}</th>
                <th scope="col">{t('records.grade')}</th>
                <th scope="col" className="num">
                  {t('records.confidence')}
                </th>
                <th scope="col">{t('records.tier')}</th>
                <th scope="col">{t('records.secondLook')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="is-clickable"
                  tabIndex={0}
                  onClick={() => open(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open(r.id);
                    }
                  }}
                  aria-label={`${t('records.open')}: ${r.patient_name || r.patient_id || r.id}`}
                >
                  <td className="tnum">{formatDateTime(r.created_at, lang)}</td>
                  <td>
                    <span className="table__link">{r.patient_name || t('records.anonymous')}</span>
                    {r.patient_id ? <span className="mono xs muted"> {r.patient_id}</span> : null}
                    {r.site ? <div className="xs muted">{r.site}</div> : null}
                  </td>
                  <td>{r.eye === 'right' || r.eye === 'left' ? t(`eye.${r.eye}`) : r.eye}</td>
                  <td>
                    <QualityPill state={r.quality_state} />
                  </td>
                  <td>{r.grade ?? (r.gradable ? '--' : t('records.ungradable'))}</td>
                  <td className="num">{pct(r.confidence)}</td>
                  <td>
                    <TierPill code={r.tier} />
                  </td>
                  <td>
                    <span className={`pill ${r.second_look_status === 'pending' ? 'pill--primary' : r.second_look_status === 'done' ? 'pill--good' : 'pill--muted'}`}>
                      {t(`sl.${r.second_look_status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
