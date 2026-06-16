import { useState } from 'react';
import { ShieldAlert, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';

// Identified client detail (PHI). Loaded LIVE per lookup and never cached — the
// component holds it only in React state for the current view. Access requires
// the `client.viewPii` permission (the API enforces permission + location scope
// + audit; this is just the UI). A banner makes the audited PHI access explicit.
export default function ClientDetail() {
  const { user } = useAuth();
  const allowed = can(user, 'client.viewPii');
  const [id, setId] = useState('');
  const [client, setClient] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg rounded border border-border bg-white p-6 text-center shadow-sm">
        <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-ink-muted" />
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Viewing client identifying information requires the
          <code className="mx-1 rounded bg-surface px-1">client.viewPii</code>
          permission. Ask an administrator.
        </p>
      </div>
    );
  }

  async function lookup(e) {
    e.preventDefault();
    const q = id.trim();
    if (!q || busy) return;
    setBusy(true); setError(null); setClient(null);
    try {
      const res = await api.client(q);
      setClient(res.client);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Client detail</h1>

      <div className="rounded border border-gold bg-gold-tint px-3 py-2 text-sm text-gold-dark">
        <ShieldAlert className="mr-1 inline h-4 w-4" />
        Identifying client information (PHI). Loaded live and <strong>not stored</strong>;
        every view is audit-logged.
      </div>

      <form onSubmit={lookup} className="flex gap-2">
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Client ID"
          className="flex-1 rounded border border-border px-3 py-2 text-sm outline-none focus:border-beacon"
        />
        <button type="submit" disabled={busy}
          className="flex items-center gap-2 rounded bg-beacon px-4 py-2 text-sm font-medium text-white hover:bg-beacon-dark disabled:opacity-50">
          <Search className="h-4 w-4" /> Look up
        </button>
      </form>

      {busy && <p className="text-sm text-ink-muted">Loading…</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      {client && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded border border-border bg-white p-4 text-sm shadow-sm">
          {Object.entries(client).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-medium text-ink-muted">{k}</dt>
              <dd>{v == null ? '—' : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
