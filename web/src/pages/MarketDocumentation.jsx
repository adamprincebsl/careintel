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
const units = (m) => (m ? Math.round(m / 15) : 0); // 15-minute billing units (covered time)

const iso = (d) => d.toISOString().slice(0, 10);
const DEFAULT_FROM = iso(new Date(Date.now() - 30 * 86400000));
const DEFAULT_TO = iso(new Date());
const QOPTS = { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false };

// Fraction of 24h covered (union of res+day), clamped.
function CoverageBar({ min }) {
  const p = Math.min(100, Math.round((min / 1440) * 100));
  const tone = p >= 95 ? 'bg-success' : p >= 50 ? 'bg-gold' : 'bg-danger';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded bg-surface"><div className={`h-full ${tone}`} style={{ width: `${p}%` }} /></div>
      <span className="tabular-nums text-xs">{p}%</span>
    </div>
  );
}

function ClientDrawer({ clientId, state, qs, onClose }) {
  const { data, isFetching, error } = useQuery({
    queryKey: ['market-doc-client', clientId, qs], queryFn: () => api.marketDocClient(clientId, qs), ...QOPTS
  });
  const c = data?.client;
  const byDay = data?.byDay || [];
  const incomplete = data?.incomplete || [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-4xl overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{c ? `${c.LastName}, ${c.FirstName}` : `Client ${clientId}`}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-ink-muted" /></button>
        </div>
        {c && <div className="mb-3 text-sm text-ink-muted">Client ID {c.ClientID} · DOB {fmtDate(c.BirthDate)}</div>}
        {error && <p className="text-sm text-danger">{String(error.message)}</p>}
        {isFetching && <p className="text-sm text-ink-muted">Loading…</p>}

        <section className="mb-4 overflow-x-auto rounded border border-border">
          <div className="border-b border-border px-3 py-2 text-sm font-semibold">Per day — overnights split across days, times combined across notes ({byDay.length})</div>
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
              <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Coverage</th><th className="px-3 py-2">Covered</th><th className="px-3 py-2">Total</th><th className="px-3 py-2">Res</th><th className="px-3 py-2">Day</th><th className="px-3 py-2">Overlap</th><th className="px-3 py-2">Res∩Day</th><th className="px-3 py-2">Gap 24h</th><th className="px-3 py-2">Notes</th></tr>
            </thead>
            <tbody>
              {!byDay.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={10}>No notes in range.</td></tr>}
              {byDay.map((d) => (
                <tr key={d.day} className={`border-t border-border ${d.overlapMin ? 'bg-gold-tint/40' : ''}`}>
                  <td className="px-3 py-1.5">{fmtDate(d.day)}</td>
                  <td className="px-3 py-1.5"><CoverageBar min={d.coveredMin} /></td>
                  <td className="px-3 py-1.5 font-medium">{hrs(d.coveredMin)}</td>
                  <td className="px-3 py-1.5">{hrs(d.rawMin)}</td>
                  <td className="px-3 py-1.5">{d.resMin ? hrs(d.resMin) : '—'}</td>
                  <td className="px-3 py-1.5">{d.dayMin ? hrs(d.dayMin) : '—'}</td>
                  <td className={`px-3 py-1.5 ${d.overlapMin ? 'font-medium text-gold-dark' : 'text-ink-muted'}`}>{d.overlapMin ? hrs(d.overlapMin) : '—'}</td>
                  <td className={`px-3 py-1.5 ${d.resDayOverlapMin ? 'font-medium text-danger' : 'text-ink-muted'}`}>{d.resDayOverlapMin ? hrs(d.resDayOverlapMin) : '—'}</td>
                  <td className="px-3 py-1.5 text-danger">{d.gapMin ? hrs(d.gapMin) : '—'}</td>
                  <td className="px-3 py-1.5">{d.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {incomplete.length > 0 && (
          <section className="rounded border border-danger/40 bg-danger/5">
            <div className="border-b border-danger/30 px-3 py-2 text-sm font-semibold text-danger">
              Scheduled notes not completed ({incomplete.length}) — no last-modified date
            </div>
            <div className="max-h-64 overflow-y-auto">
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
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }) {
  const tones = { danger: 'text-danger', success: 'text-success', gold: 'text-gold-dark' };
  return (
    <div className="rounded border border-border bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`text-2xl font-semibold ${tones[tone] || ''}`}>{value ?? '—'}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

export default function MarketDocumentation() {
  const { user } = useAuth();
  const canPhi = can(user, 'note.viewPhi');
  const [f, setF] = useState({ state: '', from: DEFAULT_FROM, to: DEFAULT_TO });
  const [applied, setApplied] = useState(null);
  const [selected, setSelected] = useState(null);

  const { data: opts } = useQuery({ queryKey: ['market-doc-options'], queryFn: api.marketDocOptions, ...QOPTS });
  const qs = applied ? new URLSearchParams(applied).toString() : '';
  const { data, isFetching, error } = useQuery({
    queryKey: ['market-doc-roster', qs], queryFn: () => api.marketDocRoster(qs), enabled: !!applied && canPhi, ...QOPTS
  });

  const rows = data?.rows || [];
  const totals = useMemo(() => rows.reduce((a, r) => ({
    covered: a.covered + r.coveredMin, overlap: a.overlap + r.overlapMin,
    gap: a.gap + (r.hasRes ? r.gapMin : 0), inc: a.inc + r.incomplete
  }), { covered: 0, overlap: 0, gap: 0, inc: 0 }), [rows]);

  return (
    <div className="space-y-4">
      <ComplianceTabs />
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-beacon" />
        <h1 className="text-xl font-semibold">Documentation by State</h1>
      </div>
      <p className="text-sm text-ink-muted">
        For residential clients, a day is 24h to account for across residential + day-hab notes. Overnight shifts are split across
        calendar days and times combined across a day’s notes. <b>Covered</b> = unique clock time documented (caps at 24h);
        <b> Total</b> = summed across all notes; <b>Overlap</b> = double-documented time (total − covered). Residential notes are
        pre-created shells; a shell with no last-modified date is a scheduled note not yet completed.
      </p>

      {!canPhi && <p className="rounded border border-gold bg-gold-tint px-3 py-2 text-sm text-gold-dark">You don’t have permission to view client documentation (PHI).</p>}

      <section className="flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-3">
        <label className="text-xs text-ink-muted">State
          <select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} className="mt-1 block w-48 rounded border border-border px-2 py-1 text-sm">
            <option value="">Select a state…</option>
            {(opts?.states || []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">From
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="mt-1 block rounded border border-border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-ink-muted">To
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="mt-1 block rounded border border-border px-2 py-1 text-sm" />
        </label>
        <button disabled={!f.state || !canPhi} onClick={() => setApplied({ ...f })}
          className="rounded bg-beacon px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Run</button>
      </section>

      {error && <p className="text-sm text-danger">{String(error.message)}</p>}
      {isFetching && <p className="text-sm text-ink-muted">Loading…</p>}

      {applied && data && (
        <>
          <div className="rounded border border-gold bg-gold-tint px-3 py-1.5 text-xs text-gold-dark">
            Identified client documentation (PHI) — access is audited. {applied.state} · {fmtDate(applied.from)}–{fmtDate(applied.to)}
          </div>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Clients" value={rows.length} />
            <Kpi label="Covered hours" value={Math.round(totals.covered / 60)} sub={`${units(totals.covered)} units`} tone="success" />
            <Kpi label="Overlap (double-doc)" value={Math.round(totals.overlap / 60)} sub="hrs total − covered" tone={totals.overlap ? 'gold' : undefined} />
            <Kpi label="Gap to 24h (res)" value={Math.round(totals.gap / 60)} sub={`${totals.inc} incomplete notes`} tone={totals.gap ? 'danger' : undefined} />
          </section>

          <section className="overflow-x-auto rounded border border-border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Days</th><th className="px-3 py-2">Covered hrs</th><th className="px-3 py-2">Units</th>
                  <th className="px-3 py-2">Total hrs</th><th className="px-3 py-2">Overlap</th>
                  <th className="px-3 py-2">Res hrs</th><th className="px-3 py-2">Day hrs</th>
                  <th className="px-3 py-2">Gap 24h</th><th className="px-3 py-2">Days &lt;24h</th><th className="px-3 py-2">Incomplete</th>
                </tr>
              </thead>
              <tbody>
                {!rows.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={11}>No documentation for this state and range.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.clientId} className="cursor-pointer border-t border-border hover:bg-surface/50" onClick={() => setSelected(r.clientId)}>
                    <td className="px-3 py-1.5 font-medium text-beacon">{r.LastName}, {r.FirstName}</td>
                    <td className="px-3 py-1.5">{r.days}</td>
                    <td className="px-3 py-1.5 font-medium">{hrs(r.coveredMin)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{units(r.coveredMin)}</td>
                    <td className="px-3 py-1.5">{hrs(r.totalMin)}</td>
                    <td className={`px-3 py-1.5 ${r.overlapMin ? 'font-medium text-gold-dark' : 'text-ink-muted'}`}>{r.overlapMin ? hrs(r.overlapMin) : '—'}</td>
                    <td className="px-3 py-1.5">{r.resMin ? hrs(r.resMin) : '—'}</td>
                    <td className="px-3 py-1.5">{r.dayMin ? hrs(r.dayMin) : '—'}</td>
                    <td className="px-3 py-1.5 text-danger">{r.hasRes ? hrs(r.gapMin) : '—'}</td>
                    <td className="px-3 py-1.5">{r.hasRes ? r.daysUnder : '—'}</td>
                    <td className={`px-3 py-1.5 font-medium ${r.incomplete ? 'text-danger' : 'text-ink-muted'}`}>{r.incomplete || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {selected && <ClientDrawer clientId={selected} state={applied?.state} qs={qs} onClose={() => setSelected(null)} />}
    </div>
  );
}
