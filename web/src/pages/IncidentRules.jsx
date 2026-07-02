import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Filter, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';
import ComplianceTabs from '../components/ComplianceTabs';

const PRIORITIES = ['info', 'warning', 'critical'];
const blank = () => ({ name: '', priority: 'warning', enabled: true, message: '', conditions: [] });

export default function IncidentRules() {
  const { user } = useAuth();
  const canManage = can(user, 'admin.manage');
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['inc-rules'], queryFn: api.incRules });
  const { data: evalData } = useQuery({ queryKey: ['inc-rules-eval'], queryFn: api.incRulesEvaluate });
  const catalog = data?.catalog || {};
  const rules = data?.rules || [];
  const counts = Object.fromEntries((evalData?.results || []).map((r) => [r.id, r.matchCount]));

  const [draft, setDraft] = useState(null); // editing/creating rule
  const inval = () => { qc.invalidateQueries({ queryKey: ['inc-rules'] }); qc.invalidateQueries({ queryKey: ['inc-rules-eval'] }); };
  const save = useMutation({ mutationFn: (r) => (r.id ? api.incRuleUpdate(r.id, r) : api.incRuleCreate(r)), onSuccess: () => { inval(); setDraft(null); } });
  const del = useMutation({ mutationFn: (id) => api.incRuleDelete(id), onSuccess: inval });

  const setCond = (i, patch) => setDraft({ ...draft, conditions: draft.conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c) });
  const addCond = () => setDraft({ ...draft, conditions: [...draft.conditions, { type: Object.keys(catalog)[0] || 'severityContains', value: '' }] });
  const rmCond = (i) => setDraft({ ...draft, conditions: draft.conditions.filter((_, idx) => idx !== i) });
  const condSummary = (c) => `${catalog[c.type]?.label || c.type}${catalog[c.type]?.value !== 'none' && c.value != null ? `: ${c.value}` : ''}`;

  return (
    <div className="space-y-4">
      <ComplianceTabs />
      <div className="flex items-center gap-2">
        <Filter className="h-5 w-5 text-beacon" />
        <h1 className="text-xl font-semibold">Incident Rules</h1>
        {canManage && !draft && (
          <button onClick={() => setDraft(blank())} className="ml-auto flex items-center gap-1 rounded bg-beacon px-3 py-1.5 text-sm font-medium text-white">
            <Plus className="h-4 w-4" /> New rule
          </button>
        )}
      </div>
      <p className="text-sm text-ink-muted">Rules flag incidents from read-only c360 (conditions are ALL-match). Match counts are live.</p>

      {draft && (
        <div className="space-y-3 rounded border border-beacon bg-surface p-3">
          <div className="grid grid-cols-2 gap-2">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Rule name" className="rounded border border-border px-2 py-1 text-sm" />
            <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} className="rounded border border-border px-2 py-1 text-sm">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input value={draft.message || ''} onChange={(e) => setDraft({ ...draft, message: e.target.value })} placeholder="Message / description" className="col-span-2 rounded border border-border px-2 py-1 text-sm" />
            <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Enabled</label>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase text-ink-muted">Conditions (all must match)</div>
            {draft.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={c.type} onChange={(e) => setCond(i, { type: e.target.value, value: '' })} className="rounded border border-border px-2 py-1 text-sm">
                  {Object.entries(catalog).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                {catalog[c.type]?.value !== 'none' && (
                  <input value={c.value || ''} onChange={(e) => setCond(i, { value: e.target.value })}
                    type={catalog[c.type]?.value === 'int' ? 'number' : 'text'} placeholder="value"
                    className="w-40 rounded border border-border px-2 py-1 text-sm" />
                )}
                <button onClick={() => rmCond(i)} className="text-danger"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <button onClick={addCond} className="flex items-center gap-1 text-sm text-beacon"><Plus className="h-3 w-3" /> Add condition</button>
          </div>

          <div className="flex gap-2">
            <button disabled={!draft.name.trim()} onClick={() => save.mutate(draft)} className="rounded bg-beacon px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save rule</button>
            <button onClick={() => setDraft(null)} className="rounded border border-border px-3 py-1.5 text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
            <tr><th className="px-3 py-2">Rule</th><th className="px-3 py-2">Priority</th><th className="px-3 py-2">Conditions</th><th className="px-3 py-2">Matches</th><th className="px-3 py-2">On</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {!rules.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={6}>No rules yet.</td></tr>}
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-1.5"><div className="font-medium">{r.name}</div>{r.message && <div className="text-xs text-ink-muted">{r.message}</div>}</td>
                <td className="px-3 py-1.5">{r.priority}</td>
                <td className="px-3 py-1.5 text-xs text-ink-muted">{(r.conditions || []).map(condSummary).join(' · ') || '—'}</td>
                <td className="px-3 py-1.5 font-medium">{counts[r.id] ?? '…'}</td>
                <td className="px-3 py-1.5">{r.enabled ? 'Yes' : 'No'}</td>
                <td className="px-3 py-1.5">
                  {canManage && (
                    <div className="flex gap-2">
                      <button onClick={() => setDraft({ ...blank(), ...r })} className="text-beacon hover:underline">Edit</button>
                      <button onClick={() => del.mutate(r.id)} className="text-danger hover:underline">Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
