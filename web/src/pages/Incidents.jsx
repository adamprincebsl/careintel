import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, X, FileDown, Columns3, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { can } from '../lib/permissions';
import IncidentWorkflow from '../components/IncidentWorkflow';
import ComplianceTabs from '../components/ComplianceTabs';

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
  { title: 'Incident', keys: ['IncidentId', 'IncidentDate', 'TimeofIncident', 'ClientId', 'ClientFirstName', 'ClientLastName', 'ClientBirthDate', 'IncidentTypes', 'SeverityOfInjury', 'AntagonistVictim', 'PlaceOfIncident', 'OtherLocation', 'Facility', 'State', 'Was911Called'] },
  { title: 'Incident type detail', keys: ['AbuseNeglectType', 'AccidentMedicalType', 'MedVarianceType', 'MedErrorType', 'IllnessType', 'BehaviorIncidentType'] },
  { title: 'What happened', keys: ['WhatHappened', 'WhereOccurred', 'WhenOccurred', 'WhyOccurred', 'HowOccurred', 'TeamRecommendations'] },
  { title: 'Behavior', keys: ['BehaviorCause', 'BehaviorDuration', 'BehaviorIntensity', 'BehaviorInterventions', 'BehaviorOutcome', 'RestraintType', 'PhysicalAggressionType'] },
  { title: 'Injury', keys: ['InjuryType', 'InjuryAreaPrimary', 'InjuryAreaSpecific', 'TreatmentProvidedBy', 'MedicalInterventions'] },
  { title: 'Seizure', keys: ['SeizureProtocolFollowed', 'SeizureDetails', 'SeizureStartTime', 'SeizureEndTime'] },
  { title: 'Choking / Ingestion', keys: ['ChokingEvent', 'ChokedOn', 'ChokingActivity', 'ChokingDiet'] },
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
  SeverityOfInjury: 'Severity of injury', AntagonistVictim: 'Antagonist / victim',
  ClientId: 'Client ID (EHR)', ClientFirstName: 'First name', ClientLastName: 'Last name', ClientBirthDate: 'Date of birth',
  PlaceOfIncident: 'Place', OtherLocation: 'Other location', Facility: 'Facility',
  State: 'State', Was911Called: '911 called',
  AbuseNeglectType: 'Abuse/Neglect type', AccidentMedicalType: 'Accident/Medical type', MedVarianceType: 'Med variance type',
  MedErrorType: 'Med error type', IllnessType: 'Illness type', BehaviorIncidentType: 'Behavior incident type',
  BehaviorCause: 'Cause', BehaviorDuration: 'Duration', BehaviorIntensity: 'Intensity', BehaviorInterventions: 'Interventions',
  BehaviorOutcome: 'Outcome', RestraintType: 'Restraint type', PhysicalAggressionType: 'Physical aggression type',
  InjuryType: 'Injury type', InjuryAreaPrimary: 'Injury area (primary)', InjuryAreaSpecific: 'Injury area (specific)',
  TreatmentProvidedBy: 'Treatment provided by', MedicalInterventions: 'Medical interventions',
  SeizureProtocolFollowed: 'Seizure protocol followed', SeizureDetails: 'Seizure details', SeizureStartTime: 'Seizure start', SeizureEndTime: 'Seizure end',
  ChokingEvent: 'Choking event?', ChokedOn: 'Choked on', ChokingActivity: 'Activity at time', ChokingDiet: 'Diet at time',
  WhatHappened: 'What happened', WhereOccurred: 'Where', WhenOccurred: 'When', WhyOccurred: 'Why',
  HowOccurred: 'How', TeamRecommendations: 'Team recommendations',
  FallLocation: 'Where the fall occurred', FallPreceding: 'Immediately preceding the fall', FallContributingFactors: 'Contributing factors',
  BloodPressure: 'Blood pressure', Temperature: 'Temperature', HeartRate: 'Heart rate',
  Respirations: 'Respirations', BloodSugar: 'Blood sugar', ReportedBy: 'Reported by',
  CreatedOn: 'Created on', LastModifiedOn: 'Last modified'
};
const LONG = new Set(['WhatHappened', 'WhereOccurred', 'WhenOccurred', 'WhyOccurred', 'HowOccurred', 'TeamRecommendations', 'FallPreceding', 'FallContributingFactors']);
const isMichigan = (s) => { const v = String(s || '').trim().toLowerCase(); return v === 'mi' || v === 'michigan'; };
async function downloadBcal4607(id) {
  const res = await fetch(`/api/c360/incidents/${id}/pdf/bcal4607`);
  if (!res.ok) { const t = await res.text().catch(() => ''); alert(`Couldn’t generate the form: ${res.status} ${t}`); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `BCAL-4607-incident-${id}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function fmt(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) {
    const d = new Date(v);
    return /T00:00:00/.test(v) ? d.toLocaleDateString('en-US', { timeZone: 'UTC' }) : d.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
  }
  return String(v);
}

// Available list columns (all de-identified). Users pick which to show + order
// is preserved from this catalog. `sort` sets comparison type.
const COLUMNS = [
  { key: 'IncidentDate', label: 'Date', sort: 'date' },
  { key: 'TimeofIncident', label: 'Time', sort: 'date' },
  { key: 'ClientInitials', label: 'Client', sort: 'str' },
  { key: 'IncidentTypes', label: 'Type(s)', sort: 'str' },
  { key: 'SeverityOfInjury', label: 'Inj. severity', sort: 'str' },
  { key: 'PlaceOfIncident', label: 'Place', sort: 'str' },
  { key: 'Facility', label: 'Location', sort: 'str' },
  { key: 'State', label: 'State', sort: 'str' },
  { key: 'AbuseNeglect', label: 'A/N', sort: 'str' },
  { key: 'OtherLocation', label: 'Other location', sort: 'str' },
  { key: 'AntagonistVictim', label: 'Antagonist / victim', sort: 'str' },
  { key: 'Was911Called', label: '911 called', sort: 'str' },
  { key: 'ReportedBy', label: 'Reported by', sort: 'str' },
  { key: 'CreatedOn', label: 'Created', sort: 'date' },
  { key: 'LastModifiedOn', label: 'Modified', sort: 'date' },
  { key: 'IncidentId', label: 'Incident #', sort: 'num' }
];
const DEFAULT_COLS = ['IncidentDate', 'ClientInitials', 'IncidentTypes', 'SeverityOfInjury', 'PlaceOfIncident', 'Facility', 'State', 'AbuseNeglect'];
const loadLS = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fallback; } catch { return fallback; } };

export default function Incidents() {
  const { user } = useAuth();
  const canPhi = can(user, 'note.viewPhi');
  const [f, setF] = useState({ type: '', severity: '', facility: '', state: '', program: '', from: '', to: '' });
  const [applied, setApplied] = useState(f);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState(() => loadLS('inc-sort', { key: 'IncidentDate', dir: 'desc' }));
  const [visible, setVisible] = useState(() => {
    const v = loadLS('inc-cols', DEFAULT_COLS);
    return Array.isArray(v) && v.length ? v : DEFAULT_COLS;
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const PAGE_SIZE = 50;

  useEffect(() => { localStorage.setItem('inc-sort', JSON.stringify(sort)); }, [sort]);
  useEffect(() => { localStorage.setItem('inc-cols', JSON.stringify(visible)); }, [visible]);
  useEffect(() => { setPage(0); }, [sort]);

  const cols = COLUMNS.filter((c) => visible.includes(c.key));
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const toggleCol = (key) => setVisible((v) => (v.includes(key) ? v.filter((k) => k !== key) : [...v, key]));

  const { data: opts } = useQuery({ queryKey: ['inc-options'], queryFn: api.incOptions });
  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString();
  const { data: metrics } = useQuery({ queryKey: ['inc-metrics', qs], queryFn: () => api.incMetrics(qs) });
  const { data: list } = useQuery({ queryKey: ['inc-list', qs], queryFn: () => api.incList(qs) });
  const { data: detail, isFetching: dFetch, error: dErr } = useQuery({
    queryKey: ['inc-full', selected], queryFn: () => api.incFull(selected), enabled: !!selected && canPhi
  });

  const s = metrics?.total?.[0] || {};
  const byType = metrics?.byType || [];
  const byClient = metrics?.byClient || [];
  const tCount = (re) => { const m = byType.find((t) => re.test(t.label || '')); return m ? m.c : 0; };
  const allRows = list?.rows || [];
  const sortedRows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    const out = [...allRows].sort((a, b) => {
      let av = a[sort.key], bv = b[sort.key];
      if (col?.sort === 'num') return (+av || 0) - (+bv || 0);
      if (col?.sort === 'date') return (av ? new Date(av).getTime() : 0) - (bv ? new Date(bv).getTime() : 0);
      av = (av ?? '').toString().toLowerCase(); bv = (bv ?? '').toString().toLowerCase();
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [allRows, sort]);
  const pageRows = sortedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <ComplianceTabs />
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
        <label className="text-xs text-ink-muted">State
          <select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} className="mt-1 block w-28 rounded border border-border px-2 py-1 text-sm">
            <option value="">All</option>
            {(opts?.states || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">Location (facility)
          <select value={f.facility} onChange={(e) => setF({ ...f, facility: e.target.value })} className="mt-1 block w-48 rounded border border-border px-2 py-1 text-sm">
            <option value="">All facilities</option>
            {(opts?.facilities || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">Program
          <select value={f.program} onChange={(e) => setF({ ...f, program: e.target.value })} className="mt-1 block w-40 rounded border border-border px-2 py-1 text-sm">
            <option value="">All programs</option>
            {(opts?.programs || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-ink-muted">From
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="mt-1 block rounded border border-border px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-ink-muted">To
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="mt-1 block rounded border border-border px-2 py-1 text-sm" />
        </label>
        <button onClick={() => { setApplied(f); setPage(0); }} className="rounded bg-beacon px-3 py-1.5 text-sm font-medium text-white">Apply</button>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Total incidents" value={s.total} />
        <Kpi label="Behavior" value={tCount(/behavior/i)} tone="gold" />
        <Kpi label="Accident / Medical" value={tCount(/accident|medical/i)} />
        <Kpi label="Abuse / Neglect" value={tCount(/abuse|neglect/i)} tone="danger" />
        <Kpi label="Death" value={tCount(/death/i)} />
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

      {byClient.length > 0 && (
        <section className="rounded border border-border bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold">Incidents by individual
            <span className="ml-1 font-normal text-ink-muted">(top {byClient.length}, de-identified)</span>
          </h2>
          <table className="w-full max-w-md text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-muted"><tr><th className="py-1">Individual</th><th className="py-1">Incidents</th></tr></thead>
            <tbody>
              {byClient.map((r) => (
                <tr key={r.clientRef} className="border-t border-border"><td className="py-1">{r.initials || `#${r.clientRef}`}</td><td className="py-1">{r.c}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="rounded border border-border bg-white">
        <div className="relative flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">{sortedRows.length} incident{sortedRows.length === 1 ? '' : 's'}</span>
          <button onClick={() => setPickerOpen((o) => !o)} className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-surface">
            <Columns3 className="h-4 w-4" /> Columns
          </button>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
              <div className="absolute right-3 top-10 z-20 w-60 rounded border border-border bg-white p-2 shadow-lg">
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Show columns</span>
                  <button onClick={() => setVisible(DEFAULT_COLS)} className="text-xs text-beacon hover:underline">Reset</button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {COLUMNS.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface">
                      <input type="checkbox" checked={visible.includes(c.key)}
                        disabled={visible.length === 1 && visible.includes(c.key)}
                        onChange={() => toggleCol(c.key)} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              {cols.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th key={c.key} className="px-3 py-2">
                    <button onClick={() => toggleSort(c.key)} className="flex items-center gap-1 font-medium uppercase tracking-wide hover:text-ink">
                      {c.label}
                      {active && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                    </button>
                  </th>
                );
              })}
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {list && !allRows.length && <tr><td className="px-3 py-3 text-ink-muted" colSpan={cols.length + 1}>No incidents for these filters.</td></tr>}
            {pageRows.map((r) => (
              <tr key={r.IncidentId} className="border-t border-border hover:bg-surface/50">
                {cols.map((c) => (
                  <td key={c.key} className="px-3 py-1.5">{fmt(r[c.key]) ?? '—'}</td>
                ))}
                <td className="px-3 py-1.5">
                  {canPhi && <button onClick={() => setSelected(r.IncidentId)} className="text-beacon hover:underline">view</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {allRows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm">
            <span className="text-ink-muted">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, allRows.length)} of {allRows.length}
            </span>
            <div className="flex items-center gap-2">
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded border border-border px-2 py-1 disabled:opacity-40">Prev</button>
              <span className="text-ink-muted">Page {page + 1} / {pageCount}</span>
              <button disabled={page + 1 >= pageCount} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="rounded border border-border px-2 py-1 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
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
                <div className="flex items-center justify-between gap-2">
                  <div className="rounded border border-gold bg-gold-tint px-3 py-1.5 text-xs text-gold-dark">Identified incident (PHI) — access is audited.</div>
                  {isMichigan(detail.incident.State) && (
                    <button onClick={() => downloadBcal4607(selected)}
                      className="flex shrink-0 items-center gap-1.5 rounded bg-beacon px-3 py-1.5 text-xs font-medium text-white hover:bg-beacon/90">
                      <FileDown className="h-4 w-4" /> BCAL-4607 (MI)
                    </button>
                  )}
                </div>
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

                <IncidentWorkflow incidentId={selected} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
