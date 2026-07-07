import { useState, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, X, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';
import ComplianceTabs from '../components/ComplianceTabs';

const HOUR_LABELS = ['12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p'];
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'numeric', day: 'numeric' }) : '—');
const iso = (d) => d.toISOString().slice(0, 10);
const DEFAULT_FROM = iso(new Date(Date.now() - 30 * 86400000));
const DEFAULT_TO = iso(new Date());
const QOPTS = { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false };

// depth -> cell color (0 uncovered=red, 1=light green, 2=green, 3+=dark green)
const depthColor = (d) => (d === 0 ? 'bg-danger/30' : d === 1 ? 'bg-success/40' : d === 2 ? 'bg-success/70' : 'bg-success');

// 24-cell coverage strip; each cell = one hour, shaded by how many staff covered it.
function CoverageStrip({ depth, small }) {
  return (
    <div className="flex gap-px" title="Coverage depth per hour (midnight→midnight)">
      {depth.map((d, i) => (
        <div key={i} className={`${small ? 'h-3 w-2' : 'h-5 w-3'} ${depthColor(d)} rounded-[1px]`}
          title={`${HOUR_LABELS[i]}: ${d} staff`} />
      ))}
    </div>
  );
}

function ClientDrawer({ clientId, qs, onClose }) {
  const { data, isFetching, error } = useQuery({
    queryKey: ['enh-client', clientId, qs], queryFn: () => api.enhancedClient(clientId, qs), ...QOPTS
  });
  const c = data?.client;
  const byDay = data?.byDay || [];
  const [openDay, setOpenDay] = useState(null);
  const notesByDay = useMemo(() => {
    const m = {};
    for (const n of data?.notes || []) (m[n.day] ||= []).push(n);
    return m;
  }, [data]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-4xl overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{c ? `${c.LastName}, ${c.FirstName}` : `Client ${clientId}`}</h2>
          <button onClick={onClose}><X className="h-5 w-5 text-ink-muted" /></button>
        </div>
        {c && <div className="mb-3 text-sm text-ink-muted">Client ID {c.ClientID}</div>}
        {error && <p className="text-sm text-danger">{String(error.message)}</p>}
        {isFetching && <p className="text-sm text-ink-muted">Loading…</p>}

        <div className="mb-2 flex items-center gap-3 text-xs text-ink-muted">
          <span>Coverage depth:</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-[1px] bg-danger/30" /> none</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-[1px] bg-success/40" /> 1</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-[1px] bg-success/70" /> 2</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-[1px] bg-success" /> 3+</span>
        </div>

        <section className="overflow-x-auto rounded border border-border">
          <div className="border-b border-border px-3 py-2 text-sm font-semibold">Per day — click to see who documented ({byDay.length})</div>
          <table className="w-full text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
              <tr><th className="w-6 px-2 py-2"></th><th className="px-3 py-2">Date</th><th className="px-3 py-2">24-hour coverage</th><th className="px-3 py-2">Covered</th><th className="px-3 py-2">Notes</th><th className="px-3 py-2">Staff</th><th className="px-3 py-2">Min depth</th></tr>
            </thead>
            <tbody>
              {!byDay.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={7}>No enhanced notes in range.</td></tr>}
              {byDay.map((d) => {
                const open = openDay === d.day;
                const dayNotes = notesByDay[d.day] || [];
                return (
                  <Fragment key={d.day}>
                    <tr onClick={() => setOpenDay(open ? null : d.day)} className="cursor-pointer border-t border-border hover:bg-surface/50">
                      <td className="px-2 py-1.5 text-ink-muted">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                      <td className="px-3 py-1.5">{fmtDate(d.day)}</td>
                      <td className="px-3 py-1.5"><CoverageStrip depth={d.depth} /></td>
                      <td className={`px-3 py-1.5 font-medium ${d.fullDay ? 'text-success' : 'text-danger'}`}>{d.coveredHours}/24</td>
                      <td className="px-3 py-1.5">{d.notes}</td>
                      <td className="px-3 py-1.5">{d.staff}</td>
                      <td className={`px-3 py-1.5 ${d.minDepth === 0 ? 'text-danger' : ''}`}>{d.minDepth}</td>
                    </tr>
                    {open && (
                      <tr className="border-t border-border bg-surface/30">
                        <td colSpan={7} className="px-3 py-2">
                          {!dayNotes.length && <p className="text-xs text-ink-muted">No note records.</p>}
                          {dayNotes.map((n) => (
                            <div key={n.id} className="mb-1.5 flex items-center gap-3 text-xs">
                              <span className="w-40 truncate font-medium">{n.author || '(no author)'}</span>
                              <CoverageStrip depth={n.hours.map((h) => (h ? 1 : 0))} small />
                              <span className="text-ink-muted">{n.coveredHours}h · {n.status}</span>
                            </div>
                          ))}
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
  const tones = { danger: 'text-danger', success: 'text-success' };
  return (
    <div className="rounded border border-border bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`text-2xl font-semibold ${tones[tone] || ''}`}>{value ?? '—'}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

export default function EnhancedStaffing() {
  const { user } = useAuth();
  const canPhi = can(user, 'note.viewPhi');
  const [f, setF] = useState({ state: '', facility: '', from: DEFAULT_FROM, to: DEFAULT_TO });
  const [applied, setApplied] = useState(null);
  const [selected, setSelected] = useState(null);

  const { data: opts } = useQuery({ queryKey: ['enh-options'], queryFn: api.enhancedOptions, ...QOPTS });
  const stateFacilities = (opts?.facilities || []).filter((x) => x.state === f.state);
  const qs = applied ? new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString() : '';
  const { data, isFetching, error } = useQuery({
    queryKey: ['enh-roster', qs], queryFn: () => api.enhancedRoster(qs), enabled: !!applied && canPhi, ...QOPTS
  });

  const rows = data?.rows || [];
  const totals = useMemo(() => rows.reduce((a, r) => ({
    days: a.days + r.days, full: a.full + r.fullDays, staff: a.staff + r.avgStaff * r.days
  }), { days: 0, full: 0, staff: 0 }), [rows]);

  return (
    <div className="space-y-4">
      <ComplianceTabs />
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-beacon" />
        <h1 className="text-xl font-semibold">Enhanced Staffing Coverage</h1>
      </div>
      <p className="text-sm text-ink-muted">
        Enhanced (1:1 / 2:1) staffing notes document a day hour-by-hour. This rolls a client’s notes into a 24-hour
        <b> coverage strip</b> — each cell is one hour, shaded by how many staff documented it — so you can see whether the
        whole day is covered and by how many people. A 2:1 client should show depth 2 across the day.
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
            {stateFacilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
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
            <Kpi label="Client-days" value={totals.days} />
            <Kpi label="Fully covered (24h)" value={totals.days ? `${Math.round((totals.full / totals.days) * 100)}%` : '—'} sub={`${totals.full} of ${totals.days} days`} tone={totals.full === totals.days ? 'success' : 'danger'} />
            <Kpi label="Avg staff / day" value={totals.days ? (totals.staff / totals.days).toFixed(1) : '—'} />
          </section>

          <section className="overflow-x-auto rounded border border-border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
                <tr><th className="px-3 py-2">Client</th><th className="px-3 py-2">Home</th><th className="px-3 py-2">Days</th><th className="px-3 py-2">Fully covered</th><th className="px-3 py-2">Gap days</th><th className="px-3 py-2">Avg hrs/day</th><th className="px-3 py-2">Avg staff/day</th><th className="px-3 py-2">Max ratio</th></tr>
              </thead>
              <tbody>
                {!rows.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={8}>No enhanced staffing notes for this state and range.</td></tr>}
                {rows.map((r) => (
                  <tr key={r.clientId} className="cursor-pointer border-t border-border hover:bg-surface/50" onClick={() => setSelected(r.clientId)}>
                    <td className="px-3 py-1.5 font-medium text-beacon">{r.name}</td>
                    <td className="px-3 py-1.5 text-ink-muted">{r.location || '—'}{r.locationCount > 1 ? <span className="ml-1 rounded bg-surface px-1 text-xs">+{r.locationCount - 1}</span> : ''}</td>
                    <td className="px-3 py-1.5">{r.days}</td>
                    <td className={`px-3 py-1.5 ${r.fullDays === r.days ? 'text-success' : ''}`}>{r.fullDays}</td>
                    <td className={`px-3 py-1.5 font-medium ${r.gapDays ? 'text-danger' : 'text-ink-muted'}`}>{r.gapDays || '—'}</td>
                    <td className="px-3 py-1.5">{r.avgCoveredHours}</td>
                    <td className="px-3 py-1.5">{r.avgStaff}</td>
                    <td className="px-3 py-1.5">{r.maxDepth}:1</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {selected && <ClientDrawer clientId={selected} qs={qs} onClose={() => setSelected(null)} />}
    </div>
  );
}
