import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';
import ComplianceTabs from '../components/ComplianceTabs';

// Times are stored UTC; show them in the facility's local zone (by state).
const CENTRAL = new Set(['MO', 'Missouri', 'IL', 'Illinois', 'WI', 'Wisconsin', 'MN', 'Minnesota', 'IA', 'Iowa', 'TX', 'Texas', 'KS', 'Kansas', 'NE', 'Nebraska', 'OK', 'Oklahoma', 'AR', 'Arkansas', 'LA', 'Louisiana', 'ND', 'North Dakota', 'SD', 'South Dakota']);
const tzFor = (s) => (s && CENTRAL.has(String(s).trim()) ? 'America/Chicago' : 'America/New_York');
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—');
const fmtTime = (v, state) => (v ? new Date(v).toLocaleTimeString('en-US', { timeZone: tzFor(state), hour: 'numeric', minute: '2-digit' }) : '—');
const hrs = (m) => (m ? (m / 60).toFixed(1) : '0');
const pct = (done, sched) => (sched ? Math.round((done / sched) * 100) : null);

// Default window: last 30 days.
const iso = (d) => d.toISOString().slice(0, 10);
const DEFAULT_FROM = iso(new Date(Date.now() - 30 * 86400000));
const DEFAULT_TO = iso(new Date());

function CompBar({ done, sched }) {
  const p = pct(done, sched);
  if (p == null) return <span className="text-ink-muted">—</span>;
  const tone = p >= 95 ? 'bg-success' : p >= 80 ? 'bg-gold' : 'bg-danger';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded bg-surface"><div className={`h-full ${tone}`} style={{ width: `${p}%` }} /></div>
      <span className="tabular-nums text-xs">{p}%</span>
    </div>
  );
}

function ClientDrawer({ clientId, market, qs, onClose }) {
  const { data, isFetching, error } = useQuery({
    queryKey: ['market-doc-client', clientId, market, qs], queryFn: () => api.marketDocClient(clientId, qs)
  });
  const c = data?.client;
  const days = useMemo(() => {
    const byDay = {};
    (data?.residentialByDay || []).forEach((r) => { (byDay[r.day] ||= {}).res = r; });
    (data?.dayByDay || []).forEach((r) => { (byDay[r.day] ||= {}).day = r; });
    return Object.entries(byDay)
      .map(([day, v]) => ({ day, res: v.res, day2: v.day, totalMin: (v.res?.minutes || 0) + (v.day?.minutes || 0) }))
      .sort((a, b) => (a.day < b.day ? 1 : -1));
  }, [data]);
  const incomplete = data?.incomplete || [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{c ? `${c.FirstName} ${c.LastName}` : `Client ${clientId}`}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-ink-muted" /></button>
        </div>
        {error && <p className="text-sm text-danger">{String(error.message)}</p>}
        {isFetching && <p className="text-sm text-ink-muted">Loading…</p>}
        {c && (
          <div className="mb-3 text-sm text-ink-muted">Client ID {c.ClientID} · DOB {fmtDate(c.BirthDate)}</div>
        )}

        {incomplete.length > 0 && (
          <section className="mb-4 rounded border border-danger/40 bg-danger/5">
            <div className="border-b border-danger/30 px-3 py-2 text-sm font-semibold text-danger">
              Scheduled notes not completed ({incomplete.length}) — no last-modified
            </div>
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-muted"><tr><th className="px-3 py-1">Date</th><th className="px-3 py-1">Scheduled time</th><th className="px-3 py-1">Home</th></tr></thead>
                <tbody>
                  {incomplete.map((n) => (
                    <tr key={n.id} className="border-t border-danger/20">
                      <td className="px-3 py-1">{fmtDate(n.day)}</td>
                      <td className="px-3 py-1 tabular-nums">{fmtTime(n.ServiceStartTime, n.state)} – {fmtTime(n.ServiceEndTime, n.state)}</td>
                      <td className="px-3 py-1 text-ink-muted">{n.facility || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="overflow-x-auto rounded border border-border">
          <div className="border-b border-border px-3 py-2 text-sm font-semibold">By day ({days.length})</div>
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
              <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Res done/sched</th><th className="px-3 py-2">Res hrs</th><th className="px-3 py-2">Day done/sched</th><th className="px-3 py-2">Day hrs</th><th className="px-3 py-2">Total hrs</th></tr>
            </thead>
            <tbody>
              {!days.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={6}>No notes in range.</td></tr>}
              {days.map((d) => {
                const rInc = d.res?.incomplete || 0, yInc = d.day2?.incomplete || 0;
                return (
                  <tr key={d.day} className={`border-t border-border ${rInc || yInc ? 'bg-danger/5' : ''}`}>
                    <td className="px-3 py-1.5">{fmtDate(d.day)}</td>
                    <td className="px-3 py-1.5">{d.res ? <span className={rInc ? 'text-danger' : ''}>{d.res.completed}/{d.res.scheduled}</span> : '—'}</td>
                    <td className="px-3 py-1.5">{d.res?.minutes ? hrs(d.res.minutes) : '—'}</td>
                    <td className="px-3 py-1.5">{d.day2 ? <span className={yInc ? 'text-danger' : ''}>{d.day2.completed}/{d.day2.scheduled}</span> : '—'}</td>
                    <td className="px-3 py-1.5">{d.day2?.minutes ? hrs(d.day2.minutes) : '—'}</td>
                    <td className="px-3 py-1.5 font-medium">{hrs(d.totalMin)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }) {
  const tones = { danger: 'text-danger', success: 'text-success' };
  return (
    <div className="rounded border border-border bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`text-2xl font-semibold ${tones[tone] || ''}`}>{value ?? '—'}</div>
    </div>
  );
}

export default function MarketDocumentation() {
  const { user } = useAuth();
  const canPhi = can(user, 'note.viewPhi');
  const [f, setF] = useState({ market: '', from: DEFAULT_FROM, to: DEFAULT_TO });
  const [applied, setApplied] = useState(null);
  const [selected, setSelected] = useState(null);

  const { data: opts } = useQuery({ queryKey: ['market-doc-options'], queryFn: api.marketDocOptions });
  const qs = applied ? new URLSearchParams(applied).toString() : '';
  const { data, isFetching, error } = useQuery({
    queryKey: ['market-doc-roster', qs], queryFn: () => api.marketDocRoster(qs), enabled: !!applied && canPhi
  });

  const rows = data?.rows || [];
  const totals = useMemo(() => rows.reduce((a, r) => ({
    sched: a.sched + r.resScheduled + r.dayScheduled,
    done: a.done + r.resCompleted + r.dayCompleted,
    inc: a.inc + r.resIncomplete + r.dayIncomplete
  }), { sched: 0, done: 0, inc: 0 }), [rows]);
  const marketName = (opts?.markets || []).find((m) => String(m.id) === String(applied?.market))?.name;

  return (
    <div className="space-y-4">
      <ComplianceTabs />
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-beacon" />
        <h1 className="text-xl font-semibold">Documentation by Market</h1>
      </div>
      <p className="text-sm text-ink-muted">
        Residential notes are pre-created shells from each home’s schedule. A shell with no last-modified date is a scheduled note that hasn’t been completed.
      </p>

      {!canPhi && <p className="rounded border border-gold bg-gold-tint px-3 py-2 text-sm text-gold-dark">You don’t have permission to view client documentation (PHI).</p>}

      <section className="flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-3">
        <label className="text-xs text-ink-muted">Market
          <select value={f.market} onChange={(e) => setF({ ...f, market: e.target.value })} className="mt-1 block w-56 rounded border border-border px-2 py-1 text-sm">
            <option value="">Select a market…</option>
            {(opts?.markets || []).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.facilities})</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">From
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="mt-1 block rounded border border-border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-ink-muted">To
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="mt-1 block rounded border border-border px-2 py-1 text-sm" />
        </label>
        <button disabled={!f.market || !canPhi} onClick={() => setApplied({ ...f })}
          className="rounded bg-beacon px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Run</button>
      </section>

      {error && <p className="text-sm text-danger">{String(error.message)}</p>}
      {isFetching && <p className="text-sm text-ink-muted">Loading…</p>}

      {applied && data && (
        <>
          <div className="rounded border border-gold bg-gold-tint px-3 py-1.5 text-xs text-gold-dark">
            Identified client documentation (PHI) — access is audited. {marketName} · {fmtDate(applied.from)}–{fmtDate(applied.to)}
          </div>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Clients" value={rows.length} />
            <Kpi label="Scheduled notes" value={totals.sched} />
            <Kpi label="Completed" value={totals.done} tone="success" />
            <Kpi label="Incomplete" value={totals.inc} tone={totals.inc ? 'danger' : undefined} />
          </section>

          <section className="overflow-x-auto rounded border border-border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Res completion</th><th className="px-3 py-2">Res done/sched</th><th className="px-3 py-2">Res hrs</th>
                  <th className="px-3 py-2">Day done/sched</th><th className="px-3 py-2">Day hrs</th>
                  <th className="px-3 py-2">Incomplete</th>
                </tr>
              </thead>
              <tbody>
                {!rows.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={7}>No documentation for this market and range.</td></tr>}
                {rows.map((r) => {
                  const inc = r.resIncomplete + r.dayIncomplete;
                  return (
                    <tr key={r.clientId} className="cursor-pointer border-t border-border hover:bg-surface/50" onClick={() => setSelected(r.clientId)}>
                      <td className="px-3 py-1.5 font-medium text-beacon">{r.LastName}, {r.FirstName}</td>
                      <td className="px-3 py-1.5"><CompBar done={r.resCompleted} sched={r.resScheduled} /></td>
                      <td className="px-3 py-1.5">{r.resScheduled ? `${r.resCompleted}/${r.resScheduled}` : '—'}</td>
                      <td className="px-3 py-1.5">{r.resMinutes ? hrs(r.resMinutes) : '—'}</td>
                      <td className="px-3 py-1.5">{r.dayScheduled ? `${r.dayCompleted}/${r.dayScheduled}` : '—'}</td>
                      <td className="px-3 py-1.5">{r.dayMinutes ? hrs(r.dayMinutes) : '—'}</td>
                      <td className={`px-3 py-1.5 font-medium ${inc ? 'text-danger' : 'text-ink-muted'}`}>{inc || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}

      {selected && <ClientDrawer clientId={selected} market={applied?.market} qs={qs} onClose={() => setSelected(null)} />}
    </div>
  );
}
