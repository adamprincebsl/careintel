import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Database } from 'lucide-react';
import { api } from '../lib/api';

// c360 reporting (plan step C2). Renders the DE-IDENTIFIED nightly snapshots
// served by /api/c360/metrics — never live PHI. Snapshot rows are generic
// (one count per group), so the table + chart are derived from the row shape.

function SnapshotView({ snapshot }) {
  if (!snapshot) {
    return <p className="text-sm text-ink-muted">No snapshot yet — the nightly job hasn’t produced one (or c360 isn’t reachable from this environment).</p>;
  }
  const rows = snapshot.rows || [];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const countField = cols.find((c) => c === 'n') || cols.find((c) => typeof rows[0][c] === 'number');
  const dimField = cols.find((c) => c !== countField);

  const chartData = countField && dimField
    ? [...rows].sort((a, b) => b[countField] - a[countField]).slice(0, 15)
        .map((r) => ({ name: String(r[dimField]), value: r[countField] }))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
        <span>as of {new Date(snapshot.asOf).toLocaleString()}</span>
        <span>{snapshot.rowCount} rows</span>
        <span>min cell {snapshot.minCell}</span>
        <span className={snapshot.suppressedCells ? 'text-gold-dark' : ''}>{snapshot.suppressedCells} small cells suppressed</span>
      </div>

      {chartData.length > 0 && (
        <div style={{ height: 280 }} className="rounded border border-border bg-white p-3 shadow-sm">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#3A85B0" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase text-ink-muted">
            <tr>{cols.map((c) => <th key={c} className="px-3 py-2">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                {cols.map((c) => <td key={c} className="px-3 py-2">{r[c] == null ? '—' : String(r[c])}</td>)}
              </tr>
            ))}
            {!rows.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={cols.length || 1}>No rows.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function C360Reports() {
  const { data: list, isLoading } = useQuery({ queryKey: ['c360-rollups'], queryFn: () => api.c360Metrics() });
  const [key, setKey] = useState(null);
  const { data: snap, isFetching } = useQuery({
    queryKey: ['c360-snapshot', key],
    queryFn: () => api.c360Metrics(key),
    enabled: !!key
  });

  const rollups = list?.available || [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Database className="h-5 w-5 text-beacon" />
        <h1 className="text-xl font-semibold">c360 Reports</h1>
      </div>
      <p className="text-sm text-ink-muted">
        De-identified aggregates from the c360 warehouse, refreshed nightly. Small cells
        (&lt; min) are suppressed; no client-level data is shown here.
      </p>

      {isLoading && <p className="text-ink-muted">Loading rollups…</p>}

      <div className="flex flex-wrap gap-2">
        {rollups.map((r) => (
          <button
            key={r.key}
            onClick={() => setKey(r.key)}
            disabled={!r.hasSnapshot}
            title={r.hasSnapshot ? '' : 'no snapshot yet'}
            className={`rounded border px-3 py-1.5 text-sm ${
              key === r.key ? 'border-beacon bg-beacon text-white'
              : r.hasSnapshot ? 'border-border bg-white hover:border-beacon'
              : 'border-border bg-surface text-ink-muted opacity-60'
            }`}
          >
            {r.key}{!r.hasSnapshot && ' ·'}
          </button>
        ))}
      </div>

      {key && (isFetching ? <p className="text-ink-muted">Loading snapshot…</p> : <SnapshotView snapshot={snap?.snapshot} />)}
      {!key && rollups.length > 0 && <p className="text-sm text-ink-muted">Pick a rollup above.</p>}
    </div>
  );
}
