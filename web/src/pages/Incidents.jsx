import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';

function Kpi({ label, value, tone, sub }) {
  const tones = { success: 'text-success', gold: 'text-gold-dark', danger: 'text-danger' };
  return (
    <div className="rounded border border-border bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className={`text-2xl font-semibold ${tones[tone] || ''}`}>{value ?? '—'}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

const DETAIL_SECTIONS = [
  { title: 'Incident', keys: ['IncidentId', 'IncidentDate', 'TimeofIncident', 'IncidentTypes', 'Severity', 'PlaceOfIncident', 'OtherLocation', 'Facility', 'State', 'IndividualRef', 'Was911Called'] },
  { title: 'What happened', keys: ['WhatHappened', 'WhereOccurred', 'WhenOccurred', 'WhyOccurred', 'HowOccurred', 'TeamRecommendations'] },
  { title: 'Fall', keys: ['FallLocation', 'FallPreceding', 'FallContributingFactors'] },
  { title: 'Vitals', keys: ['BloodPressure', 'Temperature', 'HeartRate', 'Respirations', 'BloodSugar'] },
  { title: 'Reporting', keys: ['ReportedBy', 'CreatedOn', 'LastModifiedOn'] }
];
// Child + workflow sub-forms (rendered generically — labels = cleaned column names
// until decoded from the source forms).
const SUBFORM_TITLES = [
  ['deathReporting', 'Death Reporting'], ['medicationVariance', 'Medication Variance'],
  ['sib', 'Self-Injurious Behavior'], ['rootCause', 'Root Cause Analysis'],
  ['correctiveAction', 'Corrective Action Plan'], ['clinicalDebrief', 'Clinical Debrief'],
  ['supervisorFollowUp', 'Supervisor Follow-up'], ['qaFollowUp', 'QA Follow-up']
];
const SKIP_COLS = new Set(['CompanyID', 'IsDraft', 'RowGUID', 'RowId', 'RowVer', 'SourceKeyFieldID', 'SourceCompanyID', 'LegacyEHRID']);
const cleanLabel = (k) => k.replace(/_$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
const isSkip = (k) => /ID$/.test(k) || SKIP_COLS.has(k);
function subformEntries(row) {
  return Object.entries(row).filter(([k, v]) => v != null && v !== '' && !isSkip(k) && row[k + '_'] == null);
}
const LABELS = {
  IncidentId: 'Incident #', IncidentDate: 'Date', TimeofIncident: 'Time', IncidentTypes: 'Type(s)',
  Severity: 'Severity', PlaceOfIncident: 'Place', OtherLocation: 'Other location', Facility: 'Facility',
  State: 'State', IndividualRef: 'Individual (ref)', Was911Called: '911 called',
  WhatHappened: 'What happened', WhereOccurred: 'Where', WhenOccurred: 'When', WhyOccurred: 'Why',
  HowOccurred: 'How', TeamRecommendations: 'Team recommendations',
  FallLocation: 'Where the fall occurred', FallPreceding: 'Immediately preceding the fall', FallContributingFactors: 'Contributing factors',
  BloodPressure: 'Blood pressure', Temperature: 'Temperature', HeartRate: 'Heart rate',
  Respirations: 'Respirations', BloodSugar: 'Blood sugar', ReportedBy: 'Reported by',
  CreatedOn: 'Created on', LastModifiedOn: 'Last modified'
};
const LONG = new Set(['WhatHappened', 'WhereOccurred', 'WhenOccurred', 'WhyOccurred', 'HowOccurred', 'TeamRecommendations', 'FallPreceding', 'FallContributingFactors']);
function fmt(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) {
    const d = new Date(v);
    return /T00:00:00/.test(v) ? d.toLocaleDateString('en-US', { timeZone: 'UTC' }) : d.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
  }
  return String(v);
}

export default function Incidents() {
  const { user } = useAuth();
  const canPhi = can(user, 'note.viewPhi');
  const [f, setF] = useState({ type: '', severity: '', facility: '', from: '', to: '' });
  const [applied, setApplied] = useState(f);
  const [selected, setSelected] = useState(null);

  const { data: opts } = useQuery({ queryKey: ['inc-options'], queryFn: api.incOptions });
  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString();
  const { data: metrics } = useQuery({ queryKey: ['inc-metrics', qs], queryFn: () => api.incMetrics(qs) });
  const { data: list } = useQuery({ queryKey: ['inc-list', qs], queryFn: () => api.incList(qs) });
  const { data: detail, isFetching: dFetch, error: dErr } = useQuery({
    queryKey: ['inc-full', selected], queryFn: () => api.incFull(selected), enabled: !!selected && canPhi
  });

  const s = metrics?.total?.[0] || {};
  const byType = metrics?.byType || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-beacon" />
        <h1 className="text-xl font-semibold">Incidents</h1>
      </div>

      <section className="flex flex-wrap items-end gap-3 rounded border border-border bg-surface p-3">
        <label className="text-xs text-ink-muted">Type
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="mt-1 block w-48 rounded border border-border px-2 py-1 text-sm">
            <option value="">All types</option>
            {(opts?.types || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">Severity
          <select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })} className="mt-1 block w-44 rounded border border-border px-2 py-1 text-sm">
            <option value="">All</option>
            {(opts?.severities || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">Facility
          <select value={f.facility} onChange={(e) => setF({ ...f, facility: e.target.value })} className="mt-1 block w-48 rounded border border-border px-2 py-1 text-sm">
            <option value="">All facilities</option>
            {(opts?.facilities || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">From
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="mt-1 block rounded border border-border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-ink-muted">To
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="mt-1 block rounded border border-border px-2 py-1 text-sm" />
        </label>
        <button onClick={() => setApplied(f)} className="rounded bg-beacon px-3 py-1.5 text-sm font-medium text-white">Apply</button>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total incidents" value={s.total} />
        <Kpi label="Behavior" value={s.behavior} tone="gold" />
        <Kpi label="Accident / Medical" value={s.accidentMedical} />
        <Kpi label="Abuse / Neglect" value={s.abuseNeglect} tone="danger" />
      </section>

      {byType.length > 0 && (
        <section className="rounded border border-border bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold">By type</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byType} layout="vertical" margin={{ left: 40 }}>
              <XAxis type="number" hide /><YAxis type="category" dataKey="label" width={180} tick={{ fontSize: 11 }} />
              <Tooltip /><Bar dataKey="c" fill="#2f6f7a" />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      <section className="overflow-x-auto rounded border border-border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
            <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type(s)</th><th className="px-3 py-2">Severity</th><th className="px-3 py-2">Place</th><th className="px-3 py-2">Facility</th><th className="px-3 py-2">State</th><th className="px-3 py-2">A/N</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody>
            {list && !list.rows?.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={8}>No incidents for these filters.</td></tr>}
            {(list?.rows || []).map((r) => (
              <tr key={r.IncidentId} className="border-t border-border hover:bg-surface/50">
                <td className="px-3 py-1.5">{fmt(r.IncidentDate)}</td>
                <td className="px-3 py-1.5">{r.IncidentTypes || '—'}</td>
                <td className="px-3 py-1.5">{r.Severity || '—'}</td>
                <td className="px-3 py-1.5">{r.PlaceOfIncident || '—'}</td>
                <td className="px-3 py-1.5">{r.Facility || '—'}</td>
                <td className="px-3 py-1.5">{r.State || '—'}</td>
                <td className="px-3 py-1.5">{r.AbuseNeglect}</td>
                <td className="px-3 py-1.5">
                  {canPhi && <button onClick={() => setSelected(r.IncidentId)} className="text-beacon hover:underline">view</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setSelected(null)}>
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Incident {selected}</h2>
              <button onClick={() => setSelected(null)}><X className="h-5 w-5 text-ink-muted" /></button>
            </div>
            {dErr && <p className="text-sm text-danger">{String(dErr.message)}</p>}
            {dFetch && <p className="text-sm text-ink-muted">Loading…</p>}
            {detail?.incident && (
              <div className="space-y-4">
                <div className="rounded border border-gold bg-gold-tint px-3 py-1.5 text-xs text-gold-dark">Identified incident (PHI) — access is audited.</div>
                {DETAIL_SECTIONS.map((sec) => {
                  const present = sec.keys.filter((k) => fmt(detail.incident[k]) != null);
                  if (!present.length) return null;
                  return (
                    <section key={sec.title}>
                      <h3 className="mb-1.5 border-b border-border pb-1 text-sm font-semibold text-beacon">{sec.title}</h3>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                        {present.map((k) => (
                          <div key={k} className={LONG.has(k) ? 'col-span-2' : ''}>
                            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{LABELS[k] || k}</dt>
                            <dd className={`text-sm ${LONG.has(k) ? 'mt-0.5 whitespace-pre-wrap rounded bg-surface p-2' : ''}`}>{fmt(detail.incident[k])}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  );
                })}

                {detail.subforms && (() => {
                  const sf = detail.subforms;
                  const present = SUBFORM_TITLES.filter(([k]) => sf[k] && subformEntries(sf[k]).length);
                  const witness = Array.isArray(sf.witness) ? sf.witness : [];
                  if (!present.length && !witness.length) return null;
                  return (
                    <div className="space-y-2 pt-2">
                      <h3 className="text-sm font-semibold text-beacon">Child &amp; workflow reports</h3>
                      {present.map(([k, title]) => (
                        <details key={k} className="rounded border border-border p-2">
                          <summary className="cursor-pointer text-sm font-medium">{title}</summary>
                          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                            {subformEntries(sf[k]).map(([col, v]) => (
                              <div key={col} className={String(v).length > 60 ? 'col-span-2' : ''}>
                                <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{cleanLabel(col)}</dt>
                                <dd className="text-sm">{fmt(v)}</dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ))}
                      {witness.length > 0 && (
                        <details className="rounded border border-border p-2">
                          <summary className="cursor-pointer text-sm font-medium">Witness / Investigation ({witness.length})</summary>
                          {witness.map((w, i) => (
                            <dl key={i} className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-2 first:border-0">
                              {subformEntries(w).map(([col, v]) => (
                                <div key={col} className={String(v).length > 60 ? 'col-span-2' : ''}>
                                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{cleanLabel(col)}</dt>
                                  <dd className="text-sm">{fmt(v)}</dd>
                                </div>
                              ))}
                            </dl>
                          ))}
                        </details>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
