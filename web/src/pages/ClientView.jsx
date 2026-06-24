import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserSearch } from 'lucide-react';
import { api } from '../lib/api';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—');
const hrs = (m) => (m ? (m / 60).toFixed(1) : '0');

function CensusCard({ row }) {
  const active = row.isActive === true || row.isActive === 1;
  return (
    <div className={`rounded border p-3 ${active ? 'border-success bg-success/5' : 'border-border bg-surface'}`}>
      <div className="text-xs uppercase tracking-wide text-ink-muted">{row.programType}</div>
      <div className="text-sm font-semibold">{active ? 'Active' : 'Inactive'}</div>
      <div className="text-xs text-ink-muted">{row.program || ''}</div>
      <div className="text-xs text-ink-muted">Admit {fmtDate(row.admitDate)}{row.dischargeDate ? ` · Disch ${fmtDate(row.dischargeDate)}` : ''}</div>
    </div>
  );
}

export default function ClientView() {
  const [input, setInput] = useState('');
  const [clientId, setClientId] = useState(null);
  const { data, isFetching, error } = useQuery({
    queryKey: ['client-doc', clientId], queryFn: () => api.clientDoc(clientId), enabled: !!clientId
  });

  // Merge residential + day rollups by date.
  const byDay = {};
  (data?.residentialByDay || []).forEach((r) => { (byDay[r.day] ||= {}).res = r; });
  (data?.dayByDay || []).forEach((r) => { (byDay[r.day] ||= {}).day = r; });
  const days = Object.entries(byDay)
    .map(([day, v]) => ({
      day,
      resNotes: v.res?.notes || 0, resMin: v.res?.minutes || 0,
      dayNotes: v.day?.notes || 0, dayMin: v.day?.minutes || 0,
      totalMin: (v.res?.minutes || 0) + (v.day?.minutes || 0)
    }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
  const c = data?.client;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <UserSearch className="h-5 w-5 text-beacon" />
        <h1 className="text-xl font-semibold">Client View</h1>
        <form onSubmit={(e) => { e.preventDefault(); if (input.trim()) setClientId(input.trim()); }} className="ml-auto flex items-center gap-1">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Client ID (EHR)"
            className="w-40 rounded border border-border px-2 py-1 text-sm outline-none focus:border-beacon" />
          <button className="rounded border border-beacon px-3 py-1 text-sm font-medium text-beacon hover:bg-beacon/5">Open</button>
        </form>
      </div>

      {!clientId && <p className="text-sm text-ink-muted">Enter a Client ID (current EHR id) to view documentation and census.</p>}
      {error && <p className="text-sm text-danger">{String(error.message)}</p>}
      {isFetching && <p className="text-sm text-ink-muted">Loading…</p>}

      {data && c && (
        <>
          <div className="rounded border border-gold bg-gold-tint px-3 py-1.5 text-xs text-gold-dark">
            Identified client view (PHI) — access is audited.
          </div>
          <div className="rounded border border-border bg-white p-3">
            <div className="text-lg font-semibold">{c.FirstName} {c.LastName}</div>
            <div className="text-sm text-ink-muted">Client ID {c.ClientID} · DOB {fmtDate(c.BirthDate)}</div>
          </div>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Census</h2>
            {!data.census?.length && <p className="text-sm italic text-ink-muted/60">No program enrollments found.</p>}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {(data.census || []).map((row, i) => <CensusCard key={i} row={row} />)}
            </div>
          </section>

          <section className="overflow-x-auto rounded border border-border bg-white">
            <div className="border-b border-border px-3 py-2 text-sm font-semibold">Documentation by day ({days.length} days)</div>
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Res notes</th><th className="px-3 py-2">Res hrs</th>
                  <th className="px-3 py-2">Day notes</th><th className="px-3 py-2">Day hrs</th>
                  <th className="px-3 py-2">Total hrs</th>
                </tr>
              </thead>
              <tbody>
                {!days.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={6}>No documentation found.</td></tr>}
                {days.map((d) => (
                  <tr key={d.day} className="border-t border-border">
                    <td className="px-3 py-1.5">{fmtDate(d.day)}</td>
                    <td className="px-3 py-1.5">{d.resNotes || '—'}</td>
                    <td className="px-3 py-1.5">{d.resMin ? hrs(d.resMin) : '—'}</td>
                    <td className="px-3 py-1.5">{d.dayNotes || '—'}</td>
                    <td className="px-3 py-1.5">{d.dayMin ? hrs(d.dayMin) : '—'}</td>
                    <td className="px-3 py-1.5 font-medium">{hrs(d.totalMin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
