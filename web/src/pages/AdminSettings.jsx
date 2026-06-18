import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Save } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';
import AdminTabs from '../components/AdminTabs';

const FLAGS = [
  { key: 'assistant', label: 'NL Assistant', note: 'Natural-language Q&A assistant' },
  { key: 'c360', label: 'c360 Reporting', note: 'De-identified c360 rollups + reports' },
  { key: 'signals', label: 'Predictive Signals', note: 'Risk-scoring signals (C5 — not built yet)' },
  { key: 'draftedReports', label: 'AI-drafted Reports', note: 'Narrative report generation (Phase 4 — not built yet)' }
];

export default function AdminSettings() {
  const { user, settings } = useAuth();
  const qc = useQueryClient();
  const [features, setFeatures] = useState({});
  const [idle, setIdle] = useState(15);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) { setFeatures({ ...settings.features }); setIdle(settings.idleTimeoutMinutes); }
  }, [settings]);

  if (!can(user, 'admin.manage')) {
    return (
      <div className="mx-auto max-w-lg rounded border border-border bg-white p-6 text-center shadow-sm">
        <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-ink-muted" />
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="mt-1 text-sm text-ink-muted">Settings require <code>admin.manage</code>.</p>
      </div>
    );
  }

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await api.saveSettings({ features, idleTimeoutMinutes: Number(idle) });
      setMsg({ ok: true, text: 'Saved. Reload to apply nav changes.' });
      qc.invalidateQueries();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">Admin</h1>
      <AdminTabs />
      <form onSubmit={save} className="max-w-xl space-y-5 rounded border border-border bg-white p-4 shadow-sm">
        <div>
          <h2 className="mb-2 text-sm font-semibold">Feature flags</h2>
          <div className="space-y-2">
            {FLAGS.map((f) => (
              <label key={f.key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!features[f.key]}
                  onChange={(e) => setFeatures({ ...features, [f.key]: e.target.checked })}
                />
                <span>
                  <span className="font-medium">{f.label}</span>
                  <span className="block text-xs text-ink-muted">{f.note}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="block text-sm">
          Idle timeout (minutes, 0 = disabled)
          <input
            type="number" min="0"
            value={idle}
            onChange={(e) => setIdle(e.target.value)}
            className="mt-1 block w-32 rounded border border-border px-2 py-1.5 outline-none focus:border-beacon"
          />
        </label>

        {msg && <p className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>}
        <button type="submit" disabled={busy}
          className="flex items-center gap-2 rounded bg-beacon px-4 py-2 text-sm font-medium text-white hover:bg-beacon-dark disabled:opacity-50">
          <Save className="h-4 w-4" /> {busy ? 'Saving…' : 'Save settings'}
        </button>
      </form>
    </div>
  );
}
