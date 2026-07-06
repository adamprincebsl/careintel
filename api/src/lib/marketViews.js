// State documentation view. For a client in a residential program, a full day is
// 24h that should be accounted for across residential + day-hab notes.
//
// This works from note time-spans (ServiceStartTime->ServiceEndTime for
// residential, ServiceStart->ServiceEnd for day-hab), not the Duration field, so
// we can: split overnight shifts across calendar days, sum total time across a
// day's notes (a day can have several), and measure where residential and
// day-program times OVERLAP (double-documented time = raw sum − unique covered).
//
// State = s_Locations.State (a note's state comes from note.Location). Residential
// notes are pre-created "shells"; a shell with no LastModifiedOn is a scheduled
// note not yet completed. Times are stored UTC; day attribution + display use UTC.
// PHI (named clients) — caller gates + audits.
//
// Perf: filter on ServiceDate/ServiceStart (sargable — ServiceDate is never null),
// pre-filter locations by state, pull raw spans, and do interval math in JS.
import { c360Query } from './fabricC360.js';

const RES = 'dbo.BSL_ResidentialServiceNote';
const DAY = 'dbo.BSL_ServiceNoteDayHabilitation';
const LOC = 'dbo.s_Locations';
const MS_MIN = 60000;
const MS_DAY = 86400000;
const DAY_MIN = 1440; // minutes in 24h

function range({ from, to } = {}) {
  const end = to ? new Date(to + 'T00:00:00Z') : new Date();
  const start = from ? new Date(from + 'T00:00:00Z') : new Date(end.getTime() - 30 * MS_DAY);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(start), toEnd: iso(new Date(end.getTime() + MS_DAY)) };
}

export async function marketOptions() {
  const states = await c360Query(`SELECT DISTINCT State AS name FROM ${LOC}
      WHERE State IS NOT NULL AND State <> '' AND IsInactive = 0 ORDER BY State`, {});
  return { states };
}

// ---- interval helpers -------------------------------------------------------
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
// Normalize a span to [startMs, endMs], rolling the end past midnight for
// overnight shifts (end time earlier than start). Guard runaway spans at 24h.
function normSpan(s, e) {
  if (!s || !e) return null;
  let start = new Date(s).getTime(), end = new Date(e).getTime();
  if (!(start > 0) || !(end > 0)) return null;
  if (end < start) end += MS_DAY;
  if (end <= start) return null;
  if (end - start > 36 * 3600000) end = start + MS_DAY;
  return [start, end];
}
// Clip a span at UTC midnights, yielding one [dayKey, startMs, endMs] per day.
function slicesByDay(start, end) {
  const out = [];
  let cur = start;
  while (cur < end) {
    const d = new Date(cur);
    const nextMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    const sEnd = Math.min(end, nextMidnight);
    out.push([dayKey(cur), cur, sEnd]);
    cur = sEnd;
  }
  return out;
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
function intersectMin(A, B) { // A, B are merged unions
  let i = 0, j = 0, total = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i][0], B[j][0]), e = Math.min(A[i][1], B[j][1]);
    if (s < e) total += e - s;
    if (A[i][1] < B[j][1]) i++; else j++;
  }
  return Math.round(total / MS_MIN);
}

// Pick the most-frequent key from a { key: count } tally.
const dominant = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

// Roll a client's raw notes into per-day metrics (overnight-split + overlap).
function perDayFromNotes(notes) {
  const days = {}; // dayKey -> { res:[slices], day:[slices], notes, fac:{name:count} }
  let incompleteRes = 0;
  for (const n of notes) {
    const span = normSpan(n.startT, n.endT);
    if (n.typ === 'R' && n.inc) incompleteRes++;
    if (!span) continue;
    for (const [k, s, e] of slicesByDay(span[0], span[1])) {
      const d = (days[k] ||= { res: [], day: [], notes: 0, fac: {} });
      (n.typ === 'R' ? d.res : d.day).push([s, e]);
      if (n.facility) d.fac[n.facility] = (d.fac[n.facility] || 0) + 1;
    }
  }
  // Notes counted per day at their service start day.
  for (const n of notes) {
    const span = normSpan(n.startT, n.endT);
    const k = span ? dayKey(span[0]) : (n.startT ? dayKey(new Date(n.startT).getTime()) : null);
    if (k && days[k]) days[k].notes++;
  }
  const rows = Object.entries(days).map(([day, d]) => {
    const resU = merge(d.res), dayU = merge(d.day), allU = merge([...d.res, ...d.day]);
    const resMin = unionMin(resU), dayMin = unionMin(dayU), coveredMin = unionMin(allU);
    const rawMin = Math.round([...d.res, ...d.day].reduce((s, [a, b]) => s + (b - a), 0) / MS_MIN);
    return {
      day, resMin, dayMin, coveredMin, rawMin,
      overlapMin: Math.max(0, rawMin - coveredMin),
      resDayOverlapMin: intersectMin(resU, dayU),
      gapMin: Math.max(0, DAY_MIN - coveredMin),
      notes: d.notes, location: dominant(d.fac)
    };
  }).sort((a, b) => (a.day < b.day ? 1 : -1));
  return { rows, incompleteRes };
}

async function fetchSpans({ state, from, toEnd, cid }) {
  const where = cid ? 'AND n.ClientID = @cid' : '';
  const p = cid ? { state, from, toEnd, cid: parseInt(cid, 10) } : { state, from, toEnd };
  return c360Query(`
    SELECT n.ClientID AS cid, n.ServiceStartTime AS startT, n.ServiceEndTime AS endT, 'R' AS typ,
           CASE WHEN n.LastModifiedOn IS NULL THEN 1 ELSE 0 END AS inc, loc.LocationName AS facility
    FROM ${RES} n JOIN ${LOC} loc ON n.Location = loc.LocationID
    WHERE loc.State = @state AND n.ServiceDate >= @from AND n.ServiceDate < @toEnd ${where}
    UNION ALL
    SELECT n.ClientID, n.ServiceStart, n.ServiceEnd, 'D',
           CASE WHEN n.LastModifiedOn IS NULL THEN 1 ELSE 0 END, loc.LocationName
    FROM ${DAY} n JOIN ${LOC} loc ON n.Location = loc.LocationID
    WHERE loc.State = @state AND n.ServiceStart >= @from AND n.ServiceStart < @toEnd ${where}`, p);
}

// Roster: per-client rollup across the window.
export async function marketDocRoster(params) {
  const { from, toEnd } = range(params);
  const spans = await fetchSpans({ state: params.state, from, toEnd });
  const byClient = new Map();
  for (const s of spans) { (byClient.get(s.cid) || byClient.set(s.cid, []).get(s.cid)).push(s); }

  const rows = [];
  for (const [cid, notes] of byClient) {
    const { rows: pd, incompleteRes } = perDayFromNotes(notes);
    const agg = pd.reduce((a, d) => ({
      totalMin: a.totalMin + d.rawMin, coveredMin: a.coveredMin + d.coveredMin,
      resMin: a.resMin + d.resMin, dayMin: a.dayMin + d.dayMin,
      overlapMin: a.overlapMin + d.overlapMin, gapMin: a.gapMin + d.gapMin,
      daysUnder: a.daysUnder + (d.coveredMin < DAY_MIN ? 1 : 0)
    }), { totalMin: 0, coveredMin: 0, resMin: 0, dayMin: 0, overlapMin: 0, gapMin: 0, daysUnder: 0 });
    const facCounts = {};
    for (const n of notes) if (n.facility) facCounts[n.facility] = (facCounts[n.facility] || 0) + 1;
    rows.push({
      clientId: cid, days: pd.length, incomplete: incompleteRes, hasRes: agg.resMin > 0,
      location: dominant(facCounts), locationCount: Object.keys(facCounts).length, ...agg
    });
  }
  rows.sort((a, b) => (b.hasRes - a.hasRes) || (b.gapMin - a.gapMin));

  // Attach names in one query.
  const ids = rows.map((r) => r.clientId);
  if (ids.length) {
    const names = await c360Query(
      `SELECT ClientID AS id, FirstName, LastName FROM dbo.c_Client WHERE ClientID IN (${ids.map((_, i) => `@c${i}`).join(',')})`,
      Object.fromEntries(ids.map((id, i) => [`c${i}`, id]))).catch(() => []);
    const m = new Map(names.map((n) => [n.id, n]));
    rows.forEach((r) => { const n = m.get(r.clientId); r.FirstName = n?.FirstName; r.LastName = n?.LastName; });
  }
  return { rows, range: { from, toEnd } };
}

// Per-client detail: combined per-day metrics + incomplete scheduled shells.
export async function marketClientDetail(params) {
  const cid = parseInt(params.clientId, 10);
  const { from, toEnd } = range(params);

  const [client] = await c360Query(
    `SELECT TOP 1 ClientID, FirstName, LastName, BirthDate FROM dbo.c_Client WHERE ClientID = @cid`,
    { cid }).catch(() => [null]);

  const spans = await fetchSpans({ state: params.state, from, toEnd, cid });
  const { rows: byDay } = perDayFromNotes(spans);

  const incomplete = await c360Query(`SELECT TOP 300 n.BSL_ResidentialServiceNoteID AS id,
      CAST(n.ServiceDate AS date) AS day, n.ServiceStartTime, n.ServiceEndTime, n.CreatedOn,
      loc.LocationName AS facility, loc.State AS state
    FROM ${RES} n JOIN ${LOC} loc ON n.Location = loc.LocationID
    WHERE n.ClientID = @cid AND loc.State = @state AND n.LastModifiedOn IS NULL
      AND n.ServiceDate >= @from AND n.ServiceDate < @toEnd
    ORDER BY day DESC, n.ServiceStartTime DESC`, { cid, state: params.state, from, toEnd }).catch(() => []);

  return { client: client || null, range: { from, toEnd }, byDay, incomplete };
}
