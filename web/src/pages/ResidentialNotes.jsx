import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ClipboardList, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';
import NoteForm from '../components/NoteForm';

// Residential Notes reporting page. Filters → KPIs (documented vs pending, time
// charted) → activity metrics (community engagement, day-living/ADLs, home
// entertainment) → note list → full structured note detail. De-identified
// (initials, no free-text narrative). State/Market filter pending location-dim mapping.

function Kpi({ label, value, tone = 'beacon', sub }) {
  const c = { beacon: 'text-beacon', danger: 'text-danger', gold: 'text-gold-dark', success: 'text-success' }[tone];
  return (
    <div className="rounded border border-border bg-white p-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${c}`}>{value ?? '—'}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

function MetricRow({ label, value, total }) {
  const pct = total ? Math.round((value / total) * 100) : null;
  return (
    <div className="flex items-center justify-between border-b border-border py-1 text-sm last:border-0">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium">{value ?? 0}{pct != null && <span className="ml-1 text-xs text-ink-muted">({pct}%)</span>}</span>
    </div>
  );
}

const qsFrom = (f) => Object.entries(f).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export default function ResidentialNotes() {
  const [f, setF] = useState({ program: '', location: '', from: '', to: '', status: '' });
  const [applied, setApplied] = useState({ program: '', location: '', from: '', to: '', status: '' });
  const [selected, setSelected] = useState(null);
  const [openId, setOpenId] = useState('');

  const { user } = useAuth();
  const canPhi = can(user, 'note.viewPhi');
  const { data: opts } = useQuery({ queryKey: ['res-options'], queryFn: api.resOptions });
  const qs = qsFrom(applied);
  const { data: metrics, isFetching: mFetch, error: mErr } = useQuery({ queryKey: ['res-metrics', qs], queryFn: () => api.resMetrics(qs) });
  const { data: list, isFetching: lFetch } = useQuery({ queryKey: ['res-notes', qs], queryFn: () => api.resNotes(`${qs}${qs ? '&' : ''}top=200`) });
  const { data: detail, isFetching: dFetch, error: dErr } = useQuery({
    queryKey: ['res-note', selected, canPhi],
    queryFn: () => (canPhi ? api.resNoteFull(selected) : api.resNote(selected)),
    enabled: !!selected
  });

  const apply = (e) => { e.preventDefault(); setApplied({ ...f }); };
  const s = metrics?.status?.[0] || {};
  const ce = metrics?.communityEngagement?.[0] || {};
  const adl = metrics?.dayLivingActivities?.[0] || {};
  const he = metrics?.homeEntertainment?.[0] || {};
  const timeData = (metrics?.timePerDay || []).slice().reverse().map((d) => ({ day: String(d.day).slice(0, 10), hours: Math.round((d.minutes || 0) / 6) / 10 }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-beacon" />
        <h1 className="text-xl font-semibold">Residential Notes</h1>
        <form onSubmit={(e) => { e.preventDefault(); if (openId.trim()) setSelected(openId.trim()); }} className="ml-auto flex items-center gap-1">
          <input value={openId} onChange={(e) => setOpenId(e.target.value)} placeholder="Open note #"
            className="w-32 rounded border border-border px-2 py-1 text-sm outline-none focus:border-beacon" />
          <button className="rounded border border-beacon px-3 py-1 text-sm font-medium text-beacon hover:bg-beacon/5">Open</button>
        </form>
      </div>

      {/* Filters */}
      <form onSubmit={apply} className="flex flex-wrap items-end gap-3 rounded border border-border bg-white p-3 shadow-sm">
        <label className="text-xs text-ink-muted">Program
          <input list="programs" value={f.program} onChange={(e) => setF({ ...f, program: e.target.value })} className="mt-1 block w-28 rounded border border-border px-2 py-1 text-sm outline-none focus:border-beacon" />
          <datalist id="programs">{(opts?.programs || []).map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="text-xs text-ink-muted">Location
          <input list="locations" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} className="mt-1 block w-28 rounded border border-border px-2 py-1 text-sm outline-none focus:border-beacon" />
          <datalist id="locations">{(opts?.locations || []).map((l) => <option key={l} value={l} />)}</datalist>
        </label>
        <label className="text-xs text-ink-muted">From
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="mt-1 block rounded border border-border px-2 py-1 text-sm outline-none focus:border-beacon" />
        </label>
        <label className="text-xs text-ink-muted">To
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="mt-1 block rounded border border-border px-2 py-1 text-sm outline-none focus:border-beacon" />
        </label>
        <label className="text-xs text-ink-muted">Status
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="mt-1 block rounded border border-border px-2 py-1 text-sm outline-none focus:border-beacon">
            <option value="">All</option>
            <option value="submitted">Submitted (documented)</option>
            <option value="saved">Saved (pending)</option>
          </select>
        </label>
        <button type="submit" className="rounded bg-beacon px-4 py-1.5 text-sm font-medium text-white hover:bg-beacon-dark">Apply</button>
        <span className="text-[11px] text-ink-muted">State/Market filter pending location-dimension mapping.</span>
      </form>

      {mErr && <p className="text-sm text-danger">Couldn’t load metrics: {String(mErr.message)}</p>}
      {(mFetch || lFetch) && <p className="text-sm text-ink-muted">Loading…</p>}

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Total notes" value={s.total} />
        <Kpi label="Documented" value={s.documented} tone="success" sub="Submitted" />
        <Kpi label="Pending" value={s.pending} tone="gold" sub="Saved, not submitted" />
        <Kpi label="Absent" value={s.absent} tone="danger" />
        <Kpi label="Hours charted" value={s.totalMinutes != null ? Math.round(s.totalMinutes / 60) : '—'} />
      </section>

      {/* Time charted per day */}
      {timeData.length > 0 && (
        <section className="rounded border border-border bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-ink-muted">Hours charted per day</h2>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeData}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="hours" fill="#3A85B0" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Activity metrics */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded border border-border bg-white p-3 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Community Engagement</h3>
          <MetricRow label="Offered" value={ce.offered} total={ce.notes} />
          <MetricRow label="Not offered" value={ce.notOffered} total={ce.notes} />
          <MetricRow label="Participated (any)" value={ce.participatedAny} total={ce.notes} />
          <MetricRow label="Library" value={ce.library} /><MetricRow label="Park" value={ce.park} />
          <MetricRow label="Shopping" value={ce.shopping} /><MetricRow label="Special event" value={ce.specialEvent} />
          <MetricRow label="Sports/Exercise" value={ce.sportsExercise} /><MetricRow label="Walk" value={ce.walk} />
          <MetricRow label="Worship" value={ce.worship} /><MetricRow label="Other" value={ce.other} />
        </div>
        <div className="rounded border border-border bg-white p-3 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Day Living Activities</h3>
          <MetricRow label="ADLs addressed" value={adl.adlAddressed} total={adl.notes} />
          <MetricRow label="Appointment" value={adl.appointment} total={adl.notes} />
        </div>
        <div className="rounded border border-border bg-white p-3 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Home Entertainment</h3>
          <MetricRow label="In-home (any)" value={he.inHomeAny} total={he.notes} />
          <MetricRow label="Games" value={he.games} /><MetricRow label="Movie" value={he.movie} />
          <MetricRow label="Cooking/Baking" value={he.cookingBaking} /><MetricRow label="Outdoor" value={he.outdoor} />
        </div>
      </section>

      {/* Note list */}
      <section className="overflow-x-auto rounded border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase text-ink-muted">
            <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Program</th><th className="px-3 py-2">State</th><th className="px-3 py-2">Charted by</th><th className="px-3 py-2">Min</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {(list?.rows || []).map((r) => (
              <tr key={r.NoteId} className="border-t border-border hover:bg-surface">
                <td className="px-3 py-1.5">{r.ServiceDate ? String(r.ServiceDate).slice(0, 10) : '—'}</td>
                <td className="px-3 py-1.5">{r.ClientInitials}</td>
                <td className="px-3 py-1.5">{r.Program ?? '—'}</td>
                <td className="px-3 py-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${r.NoteState === 'Submitted' ? 'bg-success/10 text-success' : 'bg-gold-tint text-gold-dark'}`}>{r.NoteState}</span>
                </td>
                <td className="px-3 py-1.5 text-ink-muted">{r.ChartedByName || '—'}</td>
                <td className="px-3 py-1.5">{r.Duration ?? '—'}</td>
                <td className="px-3 py-1.5 text-right"><button onClick={() => setSelected(r.NoteId)} className="text-beacon hover:underline">view</button></td>
              </tr>
            ))}
            {list && !list.rows?.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={7}>No notes for these filters.</td></tr>}
          </tbody>
        </table>
      </section>

      {/* Full note detail */}
      {selected && (
        <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={() => setSelected(null)}>
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Residential Note {selected}</h2>
              <button onClick={() => setSelected(null)}><X className="h-5 w-5 text-ink-muted" /></button>
            </div>
            {dErr && <p className="text-sm text-danger">{String(dErr.message)}</p>}
            {dFetch && <p className="text-sm text-ink-muted">Loading…</p>}
            {detail?.note && <NoteForm note={detail.note} phi={canPhi} />}
          </div>
        </div>
      )}
    </div>
  );
}
