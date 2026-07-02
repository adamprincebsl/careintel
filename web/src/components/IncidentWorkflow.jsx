// Incident workflow panel — manual tasks (app Cosmos) across 7 lanes + auto-derived
// c360 sub-form status. Shown inside the incident detail drawer.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';

const LANE_LABEL = {
  alerting: 'Alerting', rootCause: 'Root Cause', medical: 'Medical', clinical: 'Clinical',
  operational: 'Operational', correctiveAction: 'Corrective Action', qa: 'QA Follow-up'
};
const LANES = ['alerting', 'rootCause', 'medical', 'clinical', 'operational', 'correctiveAction', 'qa'];
// Which c360-derived flag backs a lane (shows an "on file in c360" badge).
const DERIVED_FOR = { rootCause: 'rootCauseOnFile', correctiveAction: 'correctiveActionOnFile', qa: 'qaOnFile' };
const STATUS_LABEL = { open: 'Open', inProgress: 'In progress', done: 'Done' };
const nextStatus = { open: 'inProgress', inProgress: 'done', done: 'open' };

export default function IncidentWorkflow({ incidentId }) {
  const { user } = useAuth();
  const canManage = can(user, 'incident.manage');
  const qc = useQueryClient();
  const key = ['inc-tasks', incidentId];
  const { data, isFetching } = useQuery({ queryKey: key, queryFn: () => api.incTasks(incidentId), enabled: !!incidentId });
  const [form, setForm] = useState({ lane: 'rootCause', title: '', assignee: '', dueDate: '', notes: '' });

  const inval = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({ mutationFn: (body) => api.incTaskCreate(incidentId, body), onSuccess: () => { inval(); setForm({ lane: 'rootCause', title: '', assignee: '', dueDate: '', notes: '' }); } });
  const update = useMutation({ mutationFn: ({ taskId, body }) => api.incTaskUpdate(incidentId, taskId, body), onSuccess: inval });
  const del = useMutation({ mutationFn: (taskId) => api.incTaskDelete(incidentId, taskId), onSuccess: inval });

  const tasks = data?.tasks || [];
  const derived = data?.derived || {};
  const byLane = (lane) => tasks.filter((t) => t.lane === lane);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-beacon">Workflow</h3>
      {isFetching && <p className="text-xs text-ink-muted">Loading tasks…</p>}

      {canManage && (
        <form onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) create.mutate(form); }}
          className="grid grid-cols-2 gap-2 rounded border border-border bg-surface p-2 text-sm">
          <select value={form.lane} onChange={(e) => setForm({ ...form, lane: e.target.value })} className="rounded border border-border px-2 py-1">
            {LANES.map((l) => <option key={l} value={l}>{LANE_LABEL[l]}</option>)}
          </select>
          <input value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} placeholder="Assignee" className="rounded border border-border px-2 py-1" />
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Task…" className="col-span-2 rounded border border-border px-2 py-1" />
          <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="rounded border border-border px-2 py-1" />
          <button className="rounded bg-beacon px-3 py-1 font-medium text-white">Add task</button>
        </form>
      )}

      <div className="space-y-2">
        {LANES.map((lane) => {
          const items = byLane(lane);
          const derivedKey = DERIVED_FOR[lane];
          const onFile = derivedKey && derived[derivedKey];
          if (!items.length && !onFile && !canManage) return null;
          return (
            <div key={lane} className="rounded border border-border p-2">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-medium">{LANE_LABEL[lane]}</span>
                {onFile && <span className="rounded bg-success/10 px-1.5 py-0.5 text-[11px] text-success">on file in c360</span>}
                {!items.length && !onFile && <span className="text-xs text-ink-muted/60">no tasks</span>}
              </div>
              {items.map((t) => (
                <div key={t.id} className="flex items-start justify-between gap-2 border-t border-border py-1 first:border-0">
                  <div>
                    <div className="text-sm">
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] ${t.status === 'done' ? 'bg-success/10 text-success' : t.status === 'inProgress' ? 'bg-gold-tint text-gold-dark' : 'bg-surface text-ink-muted'}`}>{STATUS_LABEL[t.status]}</span>
                      {t.title}
                    </div>
                    <div className="text-xs text-ink-muted">{t.assignee ? `@${t.assignee} · ` : ''}{t.dueDate ? `due ${t.dueDate}` : 'no due date'}</div>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => update.mutate({ taskId: t.id, body: { status: nextStatus[t.status] } })}
                        className="rounded border border-border px-2 py-0.5 text-xs">{t.status === 'done' ? 'Reopen' : t.status === 'open' ? 'Start' : 'Done'}</button>
                      <button onClick={() => del.mutate(t.id)} className="rounded border border-border px-2 py-0.5 text-xs text-danger">✕</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
