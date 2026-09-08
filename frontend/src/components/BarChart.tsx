import { useId } from 'react';

export interface BarDatum {
  label: string;
  value: number;
  /** Short label drawn under the bar; defaults to label. */
  tick?: string;
}

/** Vertical bar chart drawn with inline SVG. Theme-aware through CSS classes. */
export function BarChart({ data, title, height = 220, accent = false }: { data: BarDatum[]; title: string; height?: number; accent?: boolean }) {
  const id = useId();
  const width = Math.max(320, data.length * 36);
  const padL = 32;
  const padR = 8;
  const padT = 16;
  const padB = 36;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = innerW / Math.max(1, data.length);
  const barW = Math.max(6, Math.min(28, step * 0.64));
  const ticks = [0, Math.ceil(max / 2), max];
  const tickEvery = data.length > 14 ? Math.ceil(data.length / 10) : 1;

  return (
    <div className="table-wrap">
      <svg className="chart" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{title}</title>
        {ticks.map((tv) => {
          const y = padT + innerH - (tv / max) * innerH;
          return (
            <g key={tv}>
              <line className="chart__axis" x1={padL} x2={width - padR} y1={y} y2={y} strokeDasharray={tv === 0 ? undefined : '2 4'} />
              <text className="chart__label" x={padL - 6} y={y + 4} textAnchor="end">
                {tv}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * innerH;
          const x = padL + i * step + (step - barW) / 2;
          const y = padT + innerH - h;
          return (
            <g key={d.label}>
              <rect className={`chart__bar${accent ? ' chart__bar--accent' : ''}`} x={x} y={y} width={barW} height={h} rx={3}>
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
              {d.value > 0 ? (
                <text className="chart__value" x={x + barW / 2} y={y - 4} textAnchor="middle">
                  {d.value}
                </text>
              ) : null}
              {i % tickEvery === 0 ? (
                <text className="chart__label" x={x + barW / 2} y={height - padB + 16} textAnchor="middle">
                  {d.tick ?? d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Horizontal bars: label, track, value. */
export function HBars({ data, accent = false, format }: { data: BarDatum[]; accent?: boolean; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="stack stack--sm" role="list">
      {data.map((d) => (
        <div className="hbar" key={d.label} role="listitem">
          <span>{d.label}</span>
          <div className="hbar__track" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={d.value} aria-label={d.label}>
            <div className={`hbar__fill${accent ? ' hbar__fill--accent' : ''}`} style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="num small" style={{ textAlign: 'right' }}>
            {format ? format(d.value) : d.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface StackSegment {
  label: string;
  value: number;
  tone: 'good' | 'warn' | 'critical' | 'primary' | 'muted' | 'accent';
}

export function StackedBar({ segments, title }: { segments: StackSegment[]; title: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div className="stacked" role="img" aria-label={title}>
        {shown.map((s) => (
          <div key={s.label} className={`stacked__seg seg--${s.tone}`} style={{ width: `${(s.value / Math.max(1, total)) * 100}%` }} title={`${s.label}: ${s.value}`} />
        ))}
      </div>
      <div className="stacked__legend">
        {shown.map((s) => (
          <span key={s.label} className={`seg-label`}>
            <i className={`seg seg--${s.tone}`} aria-hidden="true" />
            {s.label} <b className="num">{s.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
