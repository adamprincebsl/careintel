import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import ComplianceTabs from '../components/ComplianceTabs';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—');

function Panel({ title, count, tone, children }) {
  const tones = { danger: 'border-danger', gold: 'border-gold', beacon: 'border-beacon' };
  return (
    <section className={`rounded border-l-4 ${tones[tone] || 'border-border'} border-y border-r border-border bg-white`}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded bg-surface px-2 py-0.5 text-xs font-medium">{count}</span>
      </div>
      <div className="max-h-72 overflow-y-auto p-2">{children}</div>
    </section>
  );
}

export default function IncidentCompliance() {
  const { data, isFetching, error } = useQuery({ queryKey: ['inc-compliance'], queryFn: api.incCompliance });
  const d = data || {};
  const rows = (x) => (Array.isArray(x) ? x : []);

  return (
    <div className="space-y-4">
      <ComplianceTabs />
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-beacon" />
        <h1 className="text-xl font-semibold">Incident Compliance</h1>
      </div>
      {error && <p className="text-sm text-danger">{String(error.message)}</p>}
      {isFetching && <p className="text-sm text-ink-muted">Loading…</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Serious / reportable — no root cause" count={rows(d.missingRootCause).length} tone="danger">
          {!rows(d.missingRootCause).length && <p className="p-2 text-sm text-ink-muted/60">None — all covered.</p>}
          {rows(d.missingRootCause).map((r) => (
            <div key={r.id} className="flex justify-between border-b border-border py-1 text-sm last:border-0">
              <span>#{r.id} · {r.client} · {r.severity || 'type: Death/Abuse'}</span>
              <span className="text-ink-muted">{fmtDate(r.date)} · {r.facility || ''}</span>
            </div>
          ))}
        </Panel>

        <Panel title="Overdue open tasks" count={rows(d.overdueTasks).length} tone="gold">
          {!rows(d.overdueTasks).length && <p className="p-2 text-sm text-ink-muted/60">None overdue.</p>}
          {rows(d.overdueTasks).map((t) => (
            <div key={t.id} className="flex justify-between border-b border-border py-1 text-sm last:border-0">
              <span>#{t.incidentId} · {t.title}</span>
              <span className="text-danger">due {t.dueDate}{t.assignee ? ` · @${t.assignee}` : ''}</span>
            </div>
          ))}
        </Panel>

        <Panel title="Recent incidents — no notification logged" count={rows(d.noNotification).length} tone="beacon">
          {!rows(d.noNotification).length && <p className="p-2 text-sm text-ink-muted/60">None.</p>}
          {rows(d.noNotification).map((r) => (
            <div key={r.id} className="flex justify-between border-b border-border py-1 text-sm last:border-0">
              <span>#{r.id} · {r.client}</span>
              <span className="text-ink-muted">{fmtDate(r.date)} · {r.facility || ''}</span>
            </div>
          ))}
        </Panel>

        <Panel title="High-frequency individuals (90 days)" count={rows(d.highFrequency).length} tone="beacon">
          {!rows(d.highFrequency).length && <p className="p-2 text-sm text-ink-muted/60">None.</p>}
          {rows(d.highFrequency).map((r) => (
            <div key={r.clientRef} className="flex justify-between border-b border-border py-1 text-sm last:border-0">
              <span>{r.client}</span>
              <span className="font-medium">{r.c} incidents</span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
