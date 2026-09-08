export function StatTile({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="card stat-tile">
      <div className="stat-tile__label">{label}</div>
      <div className={`stat-tile__value${accent ? ' stat-tile__value--accent' : ''}`}>{value}</div>
      {sub ? <div className="stat-tile__sub">{sub}</div> : null}
    </div>
  );
}
