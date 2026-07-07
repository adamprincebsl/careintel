import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, X, ChevronDown, ChevronRight } from 'lucide-react';
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
const MODE_TONE = { Both: 'bg-beacon/10 text-beacon', Residential: 'bg-surface text-ink', Day: 'bg-gold-tint text-gold-dark', 'Life Sharing': 'bg-surface text-ink' };
const STATUS_TONE = { Submitted: 'bg-success/15 text-success', Approved: 'bg-beacon/10 text-beacon', Saved: 'bg-surface text-ink', Feedback: 'bg-gold-tint text-gold-dark', Scheduled: 'bg-danger/10 text-danger' };

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
  const programs = data?.programs || [];
  const [openDay, setOpenDay] = useState(null);
  const notesByDay = useMemo(() => {
    const m = {};
    for (const n of data?.notes || []) (m[n.day] ||= []).push(n);
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    return m;
  }, [data]);

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

        {programs.length > 0 && (
          <section className="mb-4 rounded border border-border">
            <div className="border-b border-border px-3 py-2 text-sm font-semibold">Programs</div>
            <div className="flex flex-wrap gap-2 p-3">
              {programs.map((p, i) => (
                <span key={i} className={`rounded border px-2 py-1 text-xs ${p.active ? 'border-success bg-success/5' : 'border-border bg-surface text-ink-muted'}`}>
                  <b>{p.programType}</b> · {p.program}{p.active ? '' : p.discharge ? ` (disch ${fmtDate(p.discharge)})` : ''}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="mb-4 overflow-x-auto rounded border border-border">
          <div className="border-b border-border px-3 py-2 text-sm font-semibold">Per day — click a day to see its notes · out-days excluded from the gap ({byDay.length})</div>
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
              <tr><th className="w-6 px-2 py-2"></th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Home</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Coverage</th><th className="px-3 py-2">Covered</th><th className="px-3 py-2">Overlap</th><th className="px-3 py-2">Docs</th><th className="px-3 py-2">Inc</th><th className="px-3 py-2">Gap</th></tr>
            </thead>
            <tbody>
              {!byDay.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={10}>No notes in range.</td></tr>}
              {byDay.map((d) => {
                const dayNotes = notesByDay[d.day] || [];
                const open = openDay === d.day;
                return (
                  <Fragment key={d.day}>
                    <tr onClick={() => setOpenDay(open ? null : d.day)}
                      className={`cursor-pointer border-t border-border ${d.out ? 'bg-surface/60 text-ink-muted' : d.overlapMin ? 'bg-gold-tint/40' : ''} hover:bg-surface/50`}>
                      <td className="px-2 py-1.5 text-ink-muted">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="px-3 py-1.5">{fmtDate(d.day)}</td>
                      <td className="px-3 py-1.5 text-ink-muted">{d.location || '—'}</td>
                      <td className="px-3 py-1.5 text-xs">{d.out ? <span className="font-medium text-ink-muted">Out · {d.outReason}</span> : ''}</td>
                      <td className="px-3 py-1.5"><CoverageBar min={d.coveredMin} /></td>
                      <td className="px-3 py-1.5 font-medium">{hrs(d.coveredMin)}</td>
                      <td className={`px-3 py-1.5 ${d.overlapMin ? 'font-medium text-gold-dark' : 'text-ink-muted'}`}>{d.overlapMin ? hrs(d.overlapMin) : '—'}</td>
                      <td className="px-3 py-1.5">{d.doc || '—'}</td>
                      <td className={`px-3 py-1.5 ${d.inc ? 'text-danger' : 'text-ink-muted'}`}>{d.inc || '—'}</td>
                      <td className="px-3 py-1.5 text-danger">{d.out ? '—' : d.gapMin ? hrs(d.gapMin) : '—'}</td>
                    </tr>
                    {open && (
                      <tr className="border-t border-border bg-surface/30">
                        <td colSpan={10} className="px-3 py-2">
                          {!dayNotes.length && <p className="text-xs text-ink-muted">No note records for this day.</p>}
                          {dayNotes.length > 0 && (
                            <table className="w-full text-left text-xs">
                              <thead className="uppercase tracking-wide text-ink-muted"><tr><th className="py-1">Time</th><th className="py-1">Hours</th><th className="py-1">Status</th><th className="py-1">Author</th><th className="py-1">Last modified by</th><th className="py-1">Home</th></tr></thead>
                              <tbody>
                                {dayNotes.map((n) => (
                                  <tr key={n.id} className="border-t border-border/60">
                                    <td className="py-1 tabular-nums">{fmtTime(n.start, n.state)} – {fmtTime(n.end, n.state)}</td>
                                    <td className="py-1">{n.durMin ? (n.durMin / 60).toFixed(1) : '—'}</td>
                                    <td className="py-1"><span className={`rounded px-1.5 py-0.5 ${STATUS_TONE[n.status] || 'bg-surface'}`}>{n.status}</span></td>
                                    <td className="py-1">{n.author || '—'}</td>
                                    <td className="py-1 text-ink-muted">{n.modBy || '—'}</td>
                                    <td className="py-1 text-ink-muted">{n.facility || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
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
  const [f, setF] = useState({ state: '', facility: '', status: '', from: DEFAULT_FROM, to: DEFAULT_TO });
  const [applied, setApplied] = useState(null);
  const [selected, setSelected] = useState(null);

  const { data: opts } = useQuery({ queryKey: ['market-doc-options'], queryFn: api.marketDocOptions, ...QOPTS });
  const stateFacilities = (opts?.facilities || []).filter((fac) => fac.state === f.state);
  const qs = applied ? new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString() : '';
  const { data, isFetching, error } = useQuery({
    queryKey: ['market-doc-roster', qs], queryFn: () => api.marketDocRoster(qs), enabled: !!applied && canPhi, ...QOPTS
  });

  const rows = data?.rows || [];
  const totals = useMemo(() => rows.reduce((a, r) => ({
    covered: a.covered + r.coveredMin, overlap: a.overlap + r.overlapMin,
    gap: a.gap + r.gapMin, inc: a.inc + r.incomplete, out: a.out + (r.outDays || 0)
  }), { covered: 0, overlap: 0, gap: 0, inc: 0, out: 0 }), [rows]);

  return (
    <div className="space-y-4">
      <ComplianceTabs />
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-beacon" />
        <h1 className="text-xl font-semibold">Documentation by State</h1>
      </div>
      <p className="text-sm text-ink-muted">
        For residential clients a day is 24h to account for. A note counts as <b>documented</b> once it’s saved (has a
        last-modified date); notes with no last-modified date are scheduled <b>shells</b> (incomplete) and don’t count toward
        hours. <b>Covered</b> = unique clock time from documented notes (overnights split, caps at 24h); <b>Overlap</b> =
        double-documented time. Days the daily census shows the client was <b>out</b> (hospital, therapeutic leave, vacation,
        temporary discharge, etc.) are excluded from the gap. Click a client → then a day to see the individual notes: who wrote
        each, how long, and its status (Submitted / Approved / Saved / Scheduled).
      </p>

      {!canPhi && <p className="rounded border border-gold bg-gold-tint px-3 py-2 text-sm text-gold-dark">You don’t have permission to view client documentation (PHI).</p>}

      <section className="flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-3">
        <label className="text-xs text-ink-muted">State
          <select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value, facility: '' })} className="mt-1 block w-44 rounded border border-border px-2 py-1 text-sm">
            <option value="">Select a state…</option>
            {(opts?.states || []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">Facility (home)
          <select value={f.facility} onChange={(e) => setF({ ...f, facility: e.target.value })} disabled={!f.state}
            className="mt-1 block w-56 rounded border border-border px-2 py-1 text-sm disabled:opacity-50">
            <option value="">All homes{f.state ? ` (${stateFacilities.length})` : ''}</option>
            {stateFacilities.map((fac) => <option key={fac.id} value={fac.id}>{fac.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">Status
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="mt-1 block w-40 rounded border border-border px-2 py-1 text-sm">
            <option value="">All statuses</option>
            <option value="documented">Documented (any)</option>
            <option value="saved">Saved</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="feedback">Feedback</option>
            <option value="scheduled">Scheduled (incomplete)</option>
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
            Identified client documentation (PHI) — access is audited. {applied.state}
            {applied.facility ? ` · ${(opts?.facilities || []).find((x) => String(x.id) === String(applied.facility))?.name || 'home'}` : ''}
            {' · '}{fmtDate(applied.from)}–{fmtDate(applied.to)}
          </div>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Clients" value={rows.length} />
            <Kpi label="Covered hours" value={Math.round(totals.covered / 60)} sub={`${units(totals.covered)} units`} tone="success" />
            <Kpi label="Overlap (double-doc)" value={Math.round(totals.overlap / 60)} sub="hrs total − covered" tone={totals.overlap ? 'gold' : undefined} />
            <Kpi label="Gap (needed hrs)" value={Math.round(totals.gap / 60)} sub={`${totals.out} out-days excluded · ${totals.inc} incomplete`} tone={totals.gap ? 'danger' : undefined} />
          </section>

          <section className="overflow-x-auto rounded border border-border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Client</th><th className="px-3 py-2">Home</th><th className="px-3 py-2">Program</th>
                  <th className="px-3 py-2">Days</th><th className="px-3 py-2">Covered hrs</th><th className="px-3 py-2">Units</th>
                  <th className="px-3 py-2">Total hrs</th><th className="px-3 py-2">Overlap</th><th className="px-3 py-2">Docs</th>
                  <th className="px-3 py-2">Gap (needed)</th><th className="px-3 py-2">Days &lt;24h</th><th className="px-3 py-2">Out days</th><th className="px-3 py-2">Incomplete</th>
                </tr>
              </thead>
              <tbody>
                {!rows.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={13}>No documentation for this state and range.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.clientId} className="cursor-pointer border-t border-border hover:bg-surface/50" onClick={() => setSelected(r.clientId)}>
                    <td className="px-3 py-1.5 font-medium text-beacon">{r.LastName}, {r.FirstName}</td>
                    <td className="px-3 py-1.5 text-ink-muted">{r.location || '—'}{r.locationCount > 1 ? <span className="ml-1 rounded bg-surface px-1 text-xs">+{r.locationCount - 1}</span> : ''}</td>
                    <td className="px-3 py-1.5"><span className={`rounded px-1.5 py-0.5 text-xs ${MODE_TONE[r.mode] || 'bg-surface'}`}>{r.mode || '—'}</span></td>
                    <td className="px-3 py-1.5">{r.days}</td>
                    <td className="px-3 py-1.5 font-medium">{hrs(r.coveredMin)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{units(r.coveredMin)}</td>
                    <td className="px-3 py-1.5">{hrs(r.totalMin)}</td>
                    <td className={`px-3 py-1.5 ${r.overlapMin ? 'font-medium text-gold-dark' : 'text-ink-muted'}`}>{r.overlapMin ? hrs(r.overlapMin) : '—'}</td>
                    <td className="px-3 py-1.5">{r.documented || '—'}</td>
                    <td className="px-3 py-1.5 text-danger">{hrs(r.gapMin)}</td>
                    <td className="px-3 py-1.5">{r.daysUnder}</td>
                    <td className={`px-3 py-1.5 ${r.outDays ? 'font-medium text-ink' : 'text-ink-muted'}`}>{r.outDays || '—'}</td>
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
