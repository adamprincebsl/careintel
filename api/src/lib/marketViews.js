// State documentation view (residential). A residential day is 24h that should
// be documented. Residential notes are pre-created "shells" from the home's
// schedule; a shell with no LastModifiedOn is a scheduled note not yet completed.
//
// Absence-aware: the daily census (UD_DailyCensus / UD_DailyCensusDetail — mostly
// residential) records when a client was NOT present (hospital, therapeutic
// leave, vacation, temporary discharge, center closed, etc.). On those days the
// 24h is "not needed", so we exclude them from the gap and count them separately.
//
// Program mode comes from c_ClientProgram (date-based: DischargeTime IS NULL — the
// IsActive flag is unused in the source). Day-hab service notes are empty in c360,
// so this view covers Residential + Both clients (they have residential notes);
// day-only clients have no documentation here.
//
// State = s_Locations.State. Times are UTC (day attribution + display use UTC).
// Coverage uses note time-spans (overnight-split, unioned). PHI — caller gates.
import { c360Query } from './fabricC360.js';

const RES = 'dbo.BSL_ResidentialServiceNote';
const DAY = 'dbo.BSL_ServiceNoteDayHabilitation';
const LOC = 'dbo.s_Locations';
const DCEN = 'dbo.UD_DailyCensus';
const DDET = 'dbo.UD_DailyCensusDetail';
const CPROG = 'dbo.c_ClientProgram';
const SPROG = 'dbo.s_Program';
const SPTYPE = 'dbo.s_ProgramType';
const MS_MIN = 60000;
const MS_DAY = 86400000;
const DAY_MIN = 1440; // minutes in 24h
// Out-day reason flags, in priority order (first set flag wins as the label).
const OUT_REASONS = [
  ['hospPsy', 'Hospital (psychiatric)'], ['hospMed', 'Hospital (medical)'], ['illHosp', 'Illness / hospital'],
  ['therLeave', 'Therapeutic leave'], ['tempDisch', 'Temporary discharge'], ['vacation', 'Vacation'],
  ['jail', 'Jail'], ['closed', 'Center closed'], ['absUnk', 'Absent (unknown)']
];

function range({ from, to } = {}) {
  const end = to ? new Date(to + 'T00:00:00Z') : new Date();
  const start = from ? new Date(from + 'T00:00:00Z') : new Date(end.getTime() - 30 * MS_DAY);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(start), toEnd: iso(new Date(end.getTime() + MS_DAY)) };
}

export async function marketOptions() {
  const [states, facilities] = await Promise.all([
    c360Query(`SELECT DISTINCT State AS name FROM ${LOC}
      WHERE State IS NOT NULL AND State <> '' AND IsInactive = 0 ORDER BY State`, {}),
    c360Query(`SELECT DISTINCT loc.LocationID AS id, loc.LocationName AS name, loc.State AS state
      FROM ${RES} n JOIN ${LOC} loc ON n.Location = loc.LocationID
      WHERE loc.State IS NOT NULL AND loc.State <> '' ORDER BY loc.State, loc.LocationName`, {})
  ]);
  return { states, facilities };
}

// ---- interval helpers -------------------------------------------------------
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
function normSpan(s, e) {
  if (!s || !e) return null;
  let start = new Date(s).getTime(), end = new Date(e).getTime();
  if (!(start > 0) || !(end > 0)) return null;
  if (end < start) end += MS_DAY;
  if (end <= start) return null;
  if (end - start > 36 * 3600000) end = start + MS_DAY;
  return [start, end];
}
const merge = (ivals) => {
  if (!ivals.length) return [];
  const a = [...ivals].sort((x, y) => x[0] - y[0]);
  const out = [a[0].slice()];
  for (let i = 1; i < a.length; i++) {
    const last = out[out.length - 1];
    if (a[i][0] <= last[1]) last[1] = Math.max(last[1], a[i][1]); else out.push(a[i].slice());
  }
  return out;
};
const unionMin = (merged) => Math.round(merged.reduce((s, [a, b]) => s + (b - a), 0) / MS_MIN);
function intersectMin(A, B) {
  let i = 0, j = 0, total = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i][0], B[j][0]), e = Math.min(A[i][1], B[j][1]);
    if (s < e) total += e - s;
    if (A[i][1] < B[j][1]) i++; else j++;
  }
  return Math.round(total / MS_MIN);
}
const dominant = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

// A note is complete/"saved" when LastModifiedOn is set (n.inc = 0); otherwise
// it's a scheduled shell (n.inc = 1). Coverage/overlap use documented notes only.
const noteStatus = (n) => (n.inc ? 'Scheduled' : n.sub === 1015 ? 'Submitted' : n.sub === 1017 ? 'Approved' : n.sub === 1016 ? 'Feedback' : 'Saved');

// Group notes by their ServiceDate (the business day) and union each documented
// note's full span (overnight rollover applied). A note is attributed wholly to
// its service date — no splitting at calendar/UTC midnight — so a night shift
// (7pm–7:30am) counts toward the day it serves. Covered caps at 24h.
function perDayFromNotes(notes) {
  const days = {};
  const nd = () => ({ res: [], day: [], doc: 0, inc: 0, fac: {} });
  for (const n of notes) {
    const k = n.svcDate ? dayKey(new Date(n.svcDate).getTime()) : (n.startT ? dayKey(new Date(n.startT).getTime()) : null);
    if (!k) continue;
    const d = (days[k] ||= nd());
    if (n.inc) d.inc++; else d.doc++;
    if (n.facility) d.fac[n.facility] = (d.fac[n.facility] || 0) + 1;
    if (n.inc) continue; // coverage from documented (saved) notes only — skip shells
    const span = normSpan(n.startT, n.endT);
    if (span) (n.typ === 'D' ? d.day : d.res).push(span);
  }
  let incompleteRes = 0, documented = 0;
  const rows = Object.entries(days).map(([day, d]) => {
    incompleteRes += d.inc; documented += d.doc;
    const resU = merge(d.res), dayU = merge(d.day), allU = merge([...d.res, ...d.day]);
    const coveredU = unionMin(allU);
    const rawMin = Math.round([...d.res, ...d.day].reduce((s, [a, b]) => s + (b - a), 0) / MS_MIN);
    return {
      day,
      resMin: Math.min(unionMin(resU), DAY_MIN), dayMin: Math.min(unionMin(dayU), DAY_MIN),
      coveredMin: Math.min(coveredU, DAY_MIN), rawMin,
      overlapMin: Math.max(0, rawMin - coveredU), // double-documented time (uncapped union)
      resDayOverlapMin: intersectMin(resU, dayU),
      doc: d.doc, inc: d.inc, location: dominant(d.fac)
    };
  }).sort((a, b) => (a.day < b.day ? 1 : -1));
  return { rows, incompleteRes, documented };
}

// Optional filters shared by the note/census queries (cid, facility LocationID).
function scope({ cid, facility }) {
  const clause = [cid ? 'AND n.ClientID = @cid' : '', facility ? 'AND loc.LocationID = @facility' : ''].join(' ');
  const params = { ...(cid ? { cid: parseInt(cid, 10) } : {}), ...(facility ? { facility: parseInt(facility, 10) } : {}) };
  return { clause, params };
}

// Note-status filter (residential notes only). Saved = LastModifiedOn set.
const STATUS_SQL = {
  scheduled: 'AND n.LastModifiedOn IS NULL AND n.SubmissionStatus IS NULL',
  documented: 'AND (n.LastModifiedOn IS NOT NULL OR n.SubmissionStatus IS NOT NULL)',
  saved: 'AND n.LastModifiedOn IS NOT NULL AND n.SubmissionStatus IS NULL',
  submitted: 'AND n.SubmissionStatus = 1015',
  approved: 'AND n.SubmissionStatus = 1017',
  feedback: 'AND n.SubmissionStatus = 1016'
};
const statusClause = (status) => STATUS_SQL[status] || '';

async function fetchSpans({ state, from, toEnd, cid, facility, status }) {
  const { clause, params } = scope({ cid, facility });
  const sc = statusClause(status);
  const p = { state, from, toEnd, ...params };
  return c360Query(`
    SELECT n.ClientID AS cid, n.ServiceStartTime AS startT, n.ServiceEndTime AS endT, 'R' AS typ,
           CASE WHEN n.LastModifiedOn IS NULL THEN 1 ELSE 0 END AS inc, loc.LocationName AS facility, n.ServiceDate AS svcDate
    FROM ${RES} n JOIN ${LOC} loc ON n.Location = loc.LocationID
    WHERE loc.State = @state AND n.ServiceDate >= @from AND n.ServiceDate < @toEnd ${clause} ${sc}
    UNION ALL
    SELECT n.ClientID, n.ServiceStart, n.ServiceEnd, 'D',
           CASE WHEN n.LastModifiedOn IS NULL THEN 1 ELSE 0 END, loc.LocationName, CAST(n.ServiceStart AS date)
    FROM ${DAY} n JOIN ${LOC} loc ON n.Location = loc.LocationID
    WHERE loc.State = @state AND n.ServiceStart >= @from AND n.ServiceStart < @toEnd ${clause} ${status ? 'AND 1=0' : ''}`, p);
}

// Individual notes for one client (drill-down): time, duration, author, status.
async function fetchClientNotes({ state, from, toEnd, cid, facility, status }) {
  const facClause = facility ? 'AND loc.LocationID = @facility' : '';
  const sc = statusClause(status);
  return c360Query(`SELECT n.BSL_ResidentialServiceNoteID AS id, n.ServiceStartTime AS startT, n.ServiceEndTime AS endT,
      n.ServiceDate AS svcDate, n.Duration AS dur, n.SubmissionStatus AS sub, 'R' AS typ,
      CASE WHEN n.LastModifiedOn IS NULL THEN 1 ELSE 0 END AS inc,
      loc.LocationName AS facility, loc.State AS state,
      au.FirstName + ' ' + au.LastName AS author, mo.FirstName + ' ' + mo.LastName AS modBy
    FROM ${RES} n JOIN ${LOC} loc ON n.Location = loc.LocationID
    LEFT JOIN dbo.s_User au ON n.CreatedBy = au.UserID
    LEFT JOIN dbo.s_User mo ON n.LastModifiedBy = mo.UserID
    WHERE n.ClientID = @cid AND loc.State = @state AND n.ServiceDate >= @from AND n.ServiceDate < @toEnd ${facClause} ${sc}
    ORDER BY n.ServiceDate DESC, n.ServiceStartTime`,
    { cid: parseInt(cid, 10), state, from, toEnd, ...(facility ? { facility: parseInt(facility, 10) } : {}) }).catch(() => []);
}

// Out-days from the daily census: Map cid -> { dayKey -> reasonLabel }.
async function fetchCensusOutDays({ state, from, toEnd, cid, facility }) {
  const where = [cid ? 'AND d.ClientID = @cid' : '', facility ? 'AND loc.LocationID = @facility' : ''].join(' ');
  const p = { state, from, toEnd, ...(cid ? { cid: parseInt(cid, 10) } : {}), ...(facility ? { facility: parseInt(facility, 10) } : {}) };
  const rows = await c360Query(`
    SELECT d.ClientID AS cid, c.CensusDate AS day,
      MAX(CAST(d.IsPresent AS int)) AS present,
      MAX(CAST(d.IsHospitalPsychiatric AS int)) AS hospPsy,
      MAX(CAST(d.IsHospitalMedical AS int)) AS hospMed,
      MAX(CAST(d.IsAbsentIllnessHospital AS int)) AS illHosp,
      MAX(CAST(d.IsTherapeuticLeave AS int)) AS therLeave,
      MAX(CAST(d.IsTemporaryDischarge AS int)) AS tempDisch,
      MAX(CAST(d.IsAbsentVacation AS int)) AS vacation,
      MAX(CAST(d.IsJail AS int)) AS jail,
      MAX(CAST(d.IsCenterClosed AS int)) AS closed,
      MAX(CAST(d.IsAbsentUnknown AS int)) AS absUnk
    FROM ${DDET} d JOIN ${DCEN} c ON d.DailyCensusID = c.DailyCensusID
    JOIN ${LOC} loc ON c.LocationID = loc.LocationID
    WHERE loc.State = @state AND c.CensusDate >= @from AND c.CensusDate < @toEnd ${where}
    GROUP BY d.ClientID, c.CensusDate`, p).catch(() => []);
  const map = new Map();
  for (const r of rows) {
    if (r.present === 1) continue; // present that day — not an out-day
    const reason = (OUT_REASONS.find(([k]) => r[k] === 1) || [null, 'Out'])[1];
    if (!map.has(r.cid)) map.set(r.cid, {});
    map.get(r.cid)[dayKey(new Date(r.day).getTime())] = reason;
  }
  return map;
}

// Active program flags per client (Map cid -> {hasRes,hasDay,hasLife}).
async function fetchProgramFlags(clientIds) {
  if (!clientIds.length) return new Map();
  const params = Object.fromEntries(clientIds.map((id, i) => [`c${i}`, id]));
  const rows = await c360Query(`
    SELECT cp.CaseID AS cid,
      MAX(CASE WHEN pt.ProgramType='Residential' THEN 1 ELSE 0 END) AS hasRes,
      MAX(CASE WHEN pt.ProgramType='Day Program' THEN 1 ELSE 0 END) AS hasDay,
      MAX(CASE WHEN pt.ProgramType='Life Sharing' THEN 1 ELSE 0 END) AS hasLife
    FROM ${CPROG} cp JOIN ${SPROG} pr ON cp.ProgramID = pr.ProgramID
    JOIN ${SPTYPE} pt ON pr.ProgramTypeID = pt.ProgramTypeID
    WHERE cp.DischargeTime IS NULL AND cp.CaseID IN (${clientIds.map((_, i) => `@c${i}`).join(',')})
    GROUP BY cp.CaseID`, params).catch(() => []);
  return new Map(rows.map((r) => [r.cid, r]));
}
const modeOf = (f) => (f?.hasRes && f?.hasDay ? 'Both' : f?.hasDay && !f?.hasRes ? 'Day' : f?.hasLife && !f?.hasRes ? 'Life Sharing' : 'Residential');

// Enrolled programs for one client (drill-down).
async function fetchPrograms(cid) {
  return c360Query(`SELECT pt.ProgramType AS programType, pr.Program AS program,
      CAST(cp.AdmitDate AS date) AS admit, CAST(cp.DischargeTime AS date) AS discharge,
      CASE WHEN cp.DischargeTime IS NULL THEN 1 ELSE 0 END AS active
    FROM ${CPROG} cp JOIN ${SPROG} pr ON cp.ProgramID = pr.ProgramID
    JOIN ${SPTYPE} pt ON pr.ProgramTypeID = pt.ProgramTypeID
    WHERE cp.CaseID = @cid ORDER BY active DESC, cp.AdmitDate DESC`, { cid }).catch(() => []);
}

// Roster: per-client rollup, absence-aware (out-days excluded from the gap).
export async function marketDocRoster(params) {
  const { from, toEnd } = range(params);
  const facility = params.facility;
  const [spans, censusMap] = await Promise.all([
    fetchSpans({ state: params.state, from, toEnd, facility, status: params.status }),
    fetchCensusOutDays({ state: params.state, from, toEnd, facility })
  ]);
  const byClient = new Map();
  for (const s of spans) { if (!byClient.has(s.cid)) byClient.set(s.cid, []); byClient.get(s.cid).push(s); }

  const rows = [];
  for (const [cid, notes] of byClient) {
    const { rows: pd, incompleteRes, documented } = perDayFromNotes(notes);
    const outMap = censusMap.get(cid) || {};
    let coveredMin = 0, totalMin = 0, resMin = 0, dayMin = 0, overlapMin = 0, gapMin = 0, daysUnder = 0, outDays = 0;
    const noteDays = new Set();
    for (const d of pd) {
      noteDays.add(d.day);
      coveredMin += d.coveredMin; totalMin += d.rawMin; resMin += d.resMin; dayMin += d.dayMin; overlapMin += d.overlapMin;
      if (outMap[d.day]) { outDays++; continue; } // out — 24h not needed
      gapMin += Math.max(0, DAY_MIN - d.coveredMin);
      if (d.coveredMin < DAY_MIN) daysUnder++;
    }
    for (const k of Object.keys(outMap)) if (!noteDays.has(k)) outDays++; // absences with no shell
    const facCounts = {};
    for (const n of notes) if (n.facility) facCounts[n.facility] = (facCounts[n.facility] || 0) + 1;
    rows.push({
      clientId: cid, days: pd.length, documented, incomplete: incompleteRes, hasRes: resMin > 0,
      location: dominant(facCounts), locationCount: Object.keys(facCounts).length,
      coveredMin, totalMin, resMin, dayMin, overlapMin, gapMin, daysUnder, outDays
    });
  }

  const ids = rows.map((r) => r.clientId);
  const flags = await fetchProgramFlags(ids);
  rows.forEach((r) => { r.mode = modeOf(flags.get(r.clientId)); });
  rows.sort((a, b) => (b.gapMin - a.gapMin) || (b.outDays - a.outDays));

  if (ids.length) {
    const names = await c360Query(
      `SELECT ClientID AS id, FirstName, LastName FROM dbo.c_Client WHERE ClientID IN (${ids.map((_, i) => `@c${i}`).join(',')})`,
      Object.fromEntries(ids.map((id, i) => [`c${i}`, id]))).catch(() => []);
    const m = new Map(names.map((n) => [n.id, n]));
    rows.forEach((r) => { const n = m.get(r.clientId); r.FirstName = n?.FirstName; r.LastName = n?.LastName; });
  }
  return { rows, range: { from, toEnd } };
}

// Per-client detail: per-day metrics (with census out-days) + enrolled programs
// + the incomplete scheduled shells.
export async function marketClientDetail(params) {
  const cid = parseInt(params.clientId, 10);
  const { from, toEnd } = range(params);
  const facility = params.facility;
  const [clientRows, noteRows, censusMap, programs] = await Promise.all([
    c360Query(`SELECT TOP 1 ClientID, FirstName, LastName, BirthDate FROM dbo.c_Client WHERE ClientID = @cid`, { cid }).catch(() => []),
    fetchClientNotes({ state: params.state, from, toEnd, cid, facility, status: params.status }),
    fetchCensusOutDays({ state: params.state, from, toEnd, cid, facility }),
    fetchPrograms(cid)
  ]);
  const client = clientRows[0] || null;
  const outMap = censusMap.get(cid) || {};
  const { rows: byDayRaw } = perDayFromNotes(noteRows);
  const byDay = byDayRaw.map((d) => {
    const outReason = outMap[d.day] || null;
    const expectedMin = outReason ? 0 : DAY_MIN;
    return { ...d, out: !!outReason, outReason, expectedMin, gapMin: Math.max(0, expectedMin - d.coveredMin) };
  });

  // Per-note rows for the note-level drill-down (grouped by day in the UI).
  const notes = noteRows.map((n) => ({
    id: n.id, day: n.svcDate ? dayKey(new Date(n.svcDate).getTime()) : (n.startT ? dayKey(new Date(n.startT).getTime()) : null),
    start: n.startT, end: n.endT, durMin: n.dur, status: noteStatus(n),
    author: (n.author || '').trim() || null, modBy: (n.modBy || '').trim() || null,
    facility: n.facility, state: n.state
  }));

  return { client, range: { from, toEnd }, byDay, notes, programs };
}
