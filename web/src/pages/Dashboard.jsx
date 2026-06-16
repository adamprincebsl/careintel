import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api } from '../lib/api';

function Kpi({ label, value, tone = 'beacon' }) {
  const toneClass = { beacon: 'text-beacon', danger: 'text-danger', gold: 'text-gold-dark', success: 'text-success' }[tone];
  return (
    <div className="rounded border border-border bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${toneClass}`}>{value ?? '—'}</div>
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: ['metrics-overview'], queryFn: api.metricsOverview });

  if (isLoading) return <p className="text-ink-muted">Loading metrics…</p>;
  if (error) return <p className="text-danger">Failed to load metrics: {String(error.message)}</p>;

  const caps = data?.caps || {};
  const risks = data?.risks || {};
  const capBars = [
    { name: 'Open', value: caps.open || 0, color: '#3A85B0' },
    { name: 'Pending Verify', value: caps.pendingVerification || 0, color: '#FCB525' },
    { name: 'Closed', value: caps.closed || 0, color: '#2F7D2F' },
    { name: 'Overdue', value: caps.overdue || 0, color: '#B0292B' }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Care Overview</h1>
        <span className="text-xs text-ink-muted">
          source: {data?.source || 'unknown'} · {data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : ''}
        </span>
      </div>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label="Total CAPs" value={caps.total} />
        <Kpi label="Overdue CAPs" value={caps.overdue} tone="danger" />
        <Kpi label="Severe Risks" value={risks.severe} tone="danger" />
        <Kpi label="Programs" value={data?.programs?.total} tone="success" />
      </section>

      <section className="rounded border border-border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-ink-muted">CAPs by status</h2>
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={capBars}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {capBars.map((b) => <Cell key={b.name} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <p className="text-xs text-ink-muted">
        Skeleton dashboard. The full report catalog (by-state, by-severity, aging buckets,
        risk heatmap, audit pass-rate, geographic drill) and AI narrative insights are
        specified in PLAN.md.
      </p>
    </div>
  );
}
