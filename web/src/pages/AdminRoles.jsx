import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Save, Trash2, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';
import AdminTabs from '../components/AdminTabs';

const EMPTY = { name: '', description: '', permissions: [] };

export default function AdminRoles() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const allowed = can(user, 'admin.manage');
  const { data, isLoading } = useQuery({ queryKey: ['admin-roles'], queryFn: api.listRoles, enabled: allowed });

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg rounded border border-border bg-white p-6 text-center shadow-sm">
        <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-ink-muted" />
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="mt-1 text-sm text-ink-muted">Role management requires <code>admin.manage</code>.</p>
      </div>
    );
  }

  const catalog = data?.permissionCatalog || {};
  const roles = data?.roles || [];

  function editRole(r) {
    if (r.system) return;
    setForm({ name: r.name, description: r.description || '', permissions: [...r.permissions] });
    setMsg(null);
  }
  function togglePerm(p) {
    setForm((f) => ({ ...f, permissions: f.permissions.includes(p) ? f.permissions.filter((x) => x !== p) : [...f.permissions, p] }));
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      await api.saveRole(form.name.trim(), { description: form.description, permissions: form.permissions });
      setMsg({ ok: true, text: `Saved role ${form.name}` });
      setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ['admin-roles'] });
    } catch (err) { setMsg({ ok: false, text: err.message }); }
    finally { setBusy(false); }
  }

  async function del(name) {
    if (!confirm(`Delete role "${name}"?`)) return;
    try { await api.deleteRole(name); qc.invalidateQueries({ queryKey: ['admin-roles'] }); }
    catch (err) { setMsg({ ok: false, text: err.message }); }
  }

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">Admin</h1>
      <AdminTabs />

      <section className="mb-6 overflow-hidden rounded border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase text-ink-muted">
            <tr><th className="px-3 py-2">Role</th><th className="px-3 py-2">Permissions</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-3 py-3 text-ink-muted" colSpan={3}>Loading…</td></tr>}
            {roles.map((r) => (
              <tr key={r.name} className="border-t border-border align-top">
                <td className="px-3 py-2 font-medium">
                  {r.name}
                  {r.system && <span className="ml-2 inline-flex items-center gap-1 rounded bg-surface px-1 text-[10px] text-ink-muted"><Lock className="h-3 w-3" />system</span>}
                </td>
                <td className="px-3 py-2 text-xs text-ink-muted">{r.permissions.length} — {r.permissions.join(', ')}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {r.system ? <span className="text-ink-muted">—</span> : (
                    <>
                      <button onClick={() => editRole(r)} className="text-beacon hover:underline">edit</button>
                      <button onClick={() => del(r.name)} className="ml-3 text-danger hover:underline"><Trash2 className="inline h-3.5 w-3.5" /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <form onSubmit={save} className="max-w-2xl space-y-4 rounded border border-border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">{form.name && roles.some((r) => r.name === form.name && !r.system) ? 'Edit' : 'New'} custom role</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. CareManager" className="mt-1 w-full rounded border border-border px-2 py-1.5 outline-none focus:border-beacon" />
          </label>
          <label className="text-sm">Description
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded border border-border px-2 py-1.5 outline-none focus:border-beacon" />
          </label>
        </div>
        <div>
          <div className="mb-1 text-sm font-medium">Permissions</div>
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {Object.entries(catalog).map(([p, label]) => (
              <label key={p} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={form.permissions.includes(p)} onChange={() => togglePerm(p)} />
                <span><code className="text-xs">{p}</code><span className="block text-xs text-ink-muted">{label}</span></span>
              </label>
            ))}
          </div>
        </div>
        {msg && <p className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>}
        <button type="submit" disabled={busy} className="flex items-center gap-2 rounded bg-beacon px-4 py-2 text-sm font-medium text-white hover:bg-beacon-dark disabled:opacity-50">
          <Save className="h-4 w-4" /> {busy ? 'Saving…' : 'Save role'}
        </button>
      </form>
    </div>
  );
}
