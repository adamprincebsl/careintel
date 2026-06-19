import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Play, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';

// c360 Explorer — read-only query console for building out the data mappings.
// Gated on c360.query. The API enforces SELECT-only + row caps + audit; this is
// the UI. Runs from Azure where the Fabric link is stable.
export default function C360Explore() {
  const { user } = useAuth();
  const allowed = can(user, 'c360.query');
  const [sql, setSql] = useState('SELECT TOP (100) * FROM dbo.BSL_ServiceNoteDayHabilitation');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const { data: tablesData } = useQuery({ queryKey: ['explore-tables'], queryFn: api.exploreTables, enabled: allowed });

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg rounded border border-border bg-white p-6 text-center shadow-sm">
        <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-ink-muted" />
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="mt-1 text-sm text-ink-muted">The c360 Explorer requires <code>c360.query</code>.</p>
      </div>
    );
  }

  const tables = (tablesData?.tables || []).filter((t) =>
    `${t.s}.${t.n}`.toLowerCase().includes(filter.toLowerCase()));

  async function pickTable(t) {
    setSql(`SELECT TOP (100) * FROM ${t.s}.${t.n}`);
    try {
      const cols = await api.exploreColumns(t.n);
      setResult({ columns: ['column', 'type', 'nullable'], rows: cols.columns.map((c) => ({ column: c.name, type: c.type + (c.len ? `(${c.len})` : ''), nullable: c.nullable })), rowCount: cols.columns.length, info: `columns of ${t.s}.${t.n}` });
      setError(null);
    } catch (e) { setError(e.message); }
  }

  async function run() {
    if (busy) return;
    setBusy(true); setError(null);
    try { setResult(await api.exploreQuery(sql)); }
    catch (e) { setError(e.message); setResult(null); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database className="h-5 w-5 text-beacon" />
        <h1 className="text-xl font-semibold">c360 Explorer</h1>
      </div>
      <div className="rounded border border-gold bg-gold-tint px-3 py-2 text-sm text-gold-dark">
        <ShieldAlert className="mr-1 inline h-4 w-4" />
        Read-only (SELECT only). Results may include PHI — admin build-out tool;
        every query is audited and not cached.
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
        {/* table browser */}
        <aside className="rounded border border-border bg-white p-2 shadow-sm">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter tables…"
            className="mb-2 w-full rounded border border-border px-2 py-1 text-sm outline-none focus:border-beacon" />
          <div className="max-h-[420px] overflow-y-auto text-sm">
            {tables.map((t) => (
              <button key={`${t.s}.${t.n}`} onClick={() => pickTable(t)}
                className="block w-full truncate rounded px-2 py-1 text-left hover:bg-surface" title={`${t.s}.${t.n}`}>
                {t.t === 'VIEW' ? '▢ ' : ''}{t.n}
              </button>
            ))}
            {!tables.length && <p className="px-2 py-1 text-ink-muted">No tables (or link unavailable).</p>}
          </div>
        </aside>

        {/* query + results */}
        <div className="space-y-3">
          <textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={4}
            className="w-full rounded border border-border p-2 font-mono text-sm outline-none focus:border-beacon" />
          <button onClick={run} disabled={busy}
            className="flex items-center gap-2 rounded bg-beacon px-4 py-2 text-sm font-medium text-white hover:bg-beacon-dark disabled:opacity-50">
            <Play className="h-4 w-4" /> {busy ? 'Running…' : 'Run'}
          </button>
          {error && <p className="text-sm text-danger">{error}</p>}
          {result && (
            <div className="space-y-1">
              <div className="text-xs text-ink-muted">
                {result.info || `${result.rowCount} rows${result.truncated ? ` (showing ${result.cap})` : ''}`}
              </div>
              <div className="max-h-[460px] overflow-auto rounded border border-border bg-white shadow-sm">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface text-left uppercase text-ink-muted">
                    <tr>{result.columns.map((c) => <th key={c} className="px-2 py-1.5">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        {result.columns.map((c) => <td key={c} className="px-2 py-1 align-top">{r[c] == null ? '—' : String(r[c])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
