import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';
import AdminTabs from '../components/AdminTabs';

// Admin/config action audit (Phase 6 item 4). Read-only view of who changed
// what config and when. PHI-free (roles/flags/emails, never client data).
export default function AdminAudit() {
  const { user } = useAuth();
  const allowed = can(user, 'admin.manage');
  const { data, isLoading } = useQuery({ queryKey: ['admin-audit'], queryFn: api.auditLog, enabled: allowed });

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg rounded border border-border bg-white p-6 text-center shadow-sm">
        <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-ink-muted" />
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="mt-1 text-sm text-ink-muted">The audit log requires <code>admin.manage</code>.</p>
      </div>
    );
  }

  const entries = data?.entries || [];

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">Admin</h1>
      <AdminTabs />
      <section className="overflow-x-auto rounded border border-border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase text-ink-muted">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Summary</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-3 py-3 text-ink-muted" colSpan={5}>Loading…</td></tr>}
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{new Date(e.at).toLocaleString()}</td>
                <td className="px-3 py-2">{e.actorName || e.actorOid || '—'}</td>
                <td className="px-3 py-2"><code className="rounded bg-surface px-1 text-xs">{e.action}</code></td>
                <td className="px-3 py-2 text-ink-muted">{e.targetId}</td>
                <td className="px-3 py-2 text-ink-muted">{e.summary}</td>
              </tr>
            ))}
            {data && !entries.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={5}>No audit entries yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
