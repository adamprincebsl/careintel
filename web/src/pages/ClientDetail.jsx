import { useState } from 'react';
import { ShieldAlert, Search, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';

// Client lookup — INITIALS ONLY. The app never shows full names/DOB; it shows
// initials + program context, read live (never cached/persisted). The full
// identified record opens via an approved, audited link-back to the data
// warehouse (which enforces its own access). The API enforces permission +
// location scope + audit; this is just the UI.
export default function ClientDetail() {
  const { user } = useAuth();
  const allowed = can(user, 'client.viewInitials');
  const canDwLink = can(user, 'client.viewDwLink');
  const [id, setId] = useState('');
  const [result, setResult] = useState(null); // { client, hasDwLink }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg rounded border border-border bg-white p-6 text-center shadow-sm">
        <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-ink-muted" />
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Viewing client information requires the
          <code className="mx-1 rounded bg-surface px-1">client.viewInitials</code> permission.
        </p>
      </div>
    );
  }

  async function lookup(e) {
    e.preventDefault();
    const q = id.trim();
    if (!q || busy) return;
    setBusy(true); setError(null); setResult(null);
    try {
      setResult(await api.client(q));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openDw() {
    try {
      const { url } = await api.clientDwLink(result.client.clientId);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(err.message);
    }
  }

  const c = result?.client;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Client lookup</h1>

      <div className="rounded border border-gold bg-gold-tint px-3 py-2 text-sm text-gold-dark">
        <ShieldAlert className="mr-1 inline h-4 w-4" />
        De-identified view — <strong>initials only</strong>, loaded live and not stored.
        Full records open in the data warehouse (access-controlled) and access is audited.
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

      {c && (
        <div className="space-y-4 rounded border border-border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-beacon/10 text-lg font-semibold text-beacon">
              {c.initials}
            </div>
            <div className="text-sm text-ink-muted">Client {c.clientId}</div>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="font-medium text-ink-muted">Program</dt><dd>{c.programId ?? '—'}</dd>
            <dt className="font-medium text-ink-muted">State</dt><dd>{c.state ?? '—'}</dd>
            <dt className="font-medium text-ink-muted">Admitted</dt><dd>{c.admissionDate ? new Date(c.admissionDate).toLocaleDateString() : '—'}</dd>
            <dt className="font-medium text-ink-muted">Discharged</dt><dd>{c.dischargeDate ? new Date(c.dischargeDate).toLocaleDateString() : 'active'}</dd>
          </dl>

          {result.hasDwLink && canDwLink && (
            <button onClick={openDw}
              className="flex items-center gap-2 rounded border border-beacon px-3 py-2 text-sm font-medium text-beacon hover:bg-beacon/5">
              <ExternalLink className="h-4 w-4" /> Open full record in the data warehouse
            </button>
          )}
          {result.hasDwLink && !canDwLink && (
            <p className="text-xs text-ink-muted">Full record requires the <code>client.viewDwLink</code> permission (approved access).</p>
          )}
        </div>
      )}
    </div>
  );
}
