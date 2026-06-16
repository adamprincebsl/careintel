import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, Save } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';

const ROLES = ['CI_Admin', 'CI_Analyst', 'CI_Viewer'];
const EMPTY = { oid: '', name: '', email: '', roles: [], viewPii: false, scopeMode: 'none', programIds: '', states: '' };

// Provisioning UI for the user/role/scope model. Gated on admin.manage. Writes
// through PUT /api/admin/users/{oid}. Mirrors api/src/lib/userModel.js shape.
export default function AdminUsers() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const allowed = can(user, 'admin.manage');
  const { data, isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: api.listUsers, enabled: allowed });

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg rounded border border-border bg-white p-6 text-center shadow-sm">
        <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-ink-muted" />
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="mt-1 text-sm text-ink-muted">User management requires <code>admin.manage</code>.</p>
      </div>
    );
  }

  function edit(u) {
    const scope = u.clientScope;
    setForm({
      oid: u.oid,
      name: u.name || '',
      email: u.email || '',
      roles: u.roles || [],
      viewPii: (u.permissions || []).includes('client.viewPii'),
      scopeMode: scope === '*' ? 'all' : (scope?.programIds?.length || scope?.states?.length ? 'scoped' : 'none'),
      programIds: scope === '*' ? '' : (scope?.programIds || []).join(','),
      states: scope === '*' ? '' : (scope?.states || []).join(',')
    });
    setMsg(null);
  }

  function toggleRole(r) {
    setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }));
  }

  async function save(e) {
    e.preventDefault();
    if (!form.oid.trim() || busy) return;
    setBusy(true); setMsg(null);
    const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
    const clientScope = form.scopeMode === 'all' ? '*'
      : form.scopeMode === 'scoped' ? { programIds: list(form.programIds), states: list(form.states) }
      : { programIds: [], states: [] };
    try {
      await api.saveUser(form.oid.trim(), {
        name: form.name || undefined,
        email: form.email || undefined,
        roles: form.roles,
        permissions: form.viewPii ? ['client.viewPii'] : [],
        clientScope
      });
      setMsg({ ok: true, text: `Saved ${form.oid}` });
      setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel = (u) => u.clientScope === '*' ? 'all'
    : (u.clientScope?.programIds?.length || u.clientScope?.states?.length)
      ? `${u.clientScope.programIds?.length || 0}p/${u.clientScope.states?.length || 0}s` : 'none';

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Users</h1>

      <section className="overflow-hidden rounded border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase text-ink-muted">
            <tr><th className="px-3 py-2">User</th><th className="px-3 py-2">Roles</th><th className="px-3 py-2">PII scope</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-3 py-3 text-ink-muted" colSpan={4}>Loading…</td></tr>}
            {(data?.users || []).map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2">{u.email || u.oid}{!u.provisioned && <span className="ml-2 rounded bg-gold-tint px-1 text-[10px] text-gold-dark">unprovisioned</span>}</td>
                <td className="px-3 py-2 text-ink-muted">{(u.roles || []).join(', ') || '—'}{(u.permissions || []).includes('client.viewPii') && <span className="ml-1 rounded bg-beacon/10 px-1 text-[10px] text-beacon">PII</span>}</td>
                <td className="px-3 py-2 text-ink-muted">{scopeLabel(u)}</td>
                <td className="px-3 py-2 text-right"><button onClick={() => edit(u)} className="text-beacon hover:underline">edit</button></td>
              </tr>
            ))}
            {data && !data.users?.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={4}>No users yet — provision one below.</td></tr>}
          </tbody>
        </table>
      </section>

      <form onSubmit={save} className="space-y-4 rounded border border-border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">{form.oid && (data?.users || []).some((u) => u.oid === form.oid) ? 'Edit' : 'Provision'} user</h2>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="text-sm">Entra OID
            <input value={form.oid} onChange={(e) => setForm({ ...form, oid: e.target.value })} placeholder="object id" className="mt-1 w-full rounded border border-border px-2 py-1.5 outline-none focus:border-beacon" />
          </label>
          <label className="text-sm">Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded border border-border px-2 py-1.5 outline-none focus:border-beacon" />
          </label>
          <label className="text-sm">Email
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded border border-border px-2 py-1.5 outline-none focus:border-beacon" />
          </label>
        </div>

        <div>
          <div className="mb-1 text-sm font-medium">Roles</div>
          <div className="flex flex-wrap gap-3">
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={form.roles.includes(r)} onChange={() => toggleRole(r)} /> {r}
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.viewPii} onChange={(e) => setForm({ ...form, viewPii: e.target.checked })} />
          Grant <code className="rounded bg-surface px-1">client.viewPii</code> (view client names — PHI)
        </label>

        <div>
          <div className="mb-1 text-sm font-medium">Client PII scope</div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {['none', 'all', 'scoped'].map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="radio" name="scopeMode" checked={form.scopeMode === m} onChange={() => setForm({ ...form, scopeMode: m })} /> {m}
              </label>
            ))}
          </div>
          {form.scopeMode === 'scoped' && (
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              <input value={form.programIds} onChange={(e) => setForm({ ...form, programIds: e.target.value })} placeholder="program ids (comma-separated)" className="rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-beacon" />
              <input value={form.states} onChange={(e) => setForm({ ...form, states: e.target.value })} placeholder="states e.g. MI,OH" className="rounded border border-border px-2 py-1.5 text-sm outline-none focus:border-beacon" />
            </div>
          )}
        </div>

        {msg && <p className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>}
        <button type="submit" disabled={busy} className="flex items-center gap-2 rounded bg-beacon px-4 py-2 text-sm font-medium text-white hover:bg-beacon-dark disabled:opacity-50">
          <Save className="h-4 w-4" /> {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </div>
  );
}
