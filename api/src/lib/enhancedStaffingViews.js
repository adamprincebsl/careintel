// Enhanced (1:1 / 2:1) staffing coverage. BSL_EnhancedStaffingNote documents a
// day hour-by-hour: 24 bit columns (was that hour staffed/documented) + per-hour
// text. Each note ≈ one staffer's shift; a full 24h day needs enough notes so
// every hour is covered, and a 2:1 client needs two notes deep per hour.
//
// This view rolls the notes up per client/day into a 24-slot coverage "depth"
// (how many notes cover each hour) so you can see whole-day coverage and by how
// many people. State = facility's s_Locations.State. PHI (named clients) — caller
// gates + audits.
import { c360Query } from './fabricC360.js';

const ESN = 'dbo.BSL_EnhancedStaffingNote';
const LOC = 'dbo.s_Locations';
const MS_DAY = 86400000;

// 24 hourly bit columns, midnight→midnight, with short labels for the UI.
export const HOURS = ['MidnightToOneAM', 'OneAMtoTwoAM', 'TwoAMtoThreeAM', 'ThreeAMtoFourAM', 'FourAMtoFiveAM', 'FiveAMtoSixAM', 'SixtoSevenAM', 'SeventoEightAM', 'EighttoNineAM', 'NinetoTenAM', 'TentoElevenAM', 'EleventoNoon', 'TwelvetoOnePM', 'OnetoTwoPM', 'TwotoThreePM', 'ThreetoFourPM', 'FourtoFivePM', 'FivetoSixPM', 'SixtoSevenPM', 'SeventoEightPM', 'EighttoNinePM', 'NinetoTenPM', 'TentoElevenPM', 'EleventoMidnight'];

function range({ from, to } = {}) {
  const end = to ? new Date(to + 'T00:00:00Z') : new Date();
  const start = from ? new Date(from + 'T00:00:00Z') : new Date(end.getTime() - 30 * MS_DAY);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(start), toEnd: iso(new Date(end.getTime() + MS_DAY)) };
}
const dayKey = (v) => new Date(v).toISOString().slice(0, 10);
const dominant = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

// Names resolve from c_Client (the note's own FirstName/LastName are blank).
async function fetchNames(ids) {
  if (!ids.length) return new Map();
  const params = Object.fromEntries(ids.map((id, i) => [`c${i}`, id]));
  const rows = await c360Query(`SELECT ClientID AS id, FirstName, LastName FROM dbo.c_Client WHERE ClientID IN (${ids.map((_, i) => `@c${i}`).join(',')})`, params).catch(() => []);
  return new Map(rows.map((r) => [r.id, r]));
}

export async function enhancedOptions() {
  const [states, facilities] = await Promise.all([
    c360Query(`SELECT DISTINCT loc.State AS name FROM ${ESN} n JOIN ${LOC} loc ON n.Location = loc.LocationID
      WHERE loc.State IS NOT NULL AND loc.State <> '' ORDER BY loc.State`, {}),
    c360Query(`SELECT DISTINCT loc.LocationID AS id, loc.LocationName AS name, loc.State AS state
      FROM ${ESN} n JOIN ${LOC} loc ON n.Location = loc.LocationID
      WHERE loc.State IS NOT NULL AND loc.State <> '' ORDER BY loc.State, loc.LocationName`, {})
  ]);
  return { states, facilities };
}

// Per client/day: SUM each hour bit (= coverage depth), note count, distinct staff.
const DEPTH_SELECT = HOURS.map((h, i) => `SUM(CAST(n.${h} AS int)) AS h${i}`).join(', ');

async function fetchDayDepths({ state, facility, from, toEnd, cid }) {
  const extra = [facility ? 'AND loc.LocationID = @facility' : '', cid ? 'AND n.ClientID = @cid' : ''].join(' ');
  const p = { state, from, toEnd, ...(facility ? { facility: parseInt(facility, 10) } : {}), ...(cid ? { cid: parseInt(cid, 10) } : {}) };
  return c360Query(`SELECT n.ClientID AS cid, MAX(n.FirstName) AS firstName, MAX(n.LastName) AS lastName,
      CAST(n.DateofService AS date) AS day, MAX(loc.LocationName) AS facility,
      ${DEPTH_SELECT}, COUNT(*) AS notes, COUNT(DISTINCT n.CreatedBy) AS staff
    FROM ${ESN} n JOIN ${LOC} loc ON n.Location = loc.LocationID
    WHERE loc.State = @state AND n.DateofService >= @from AND n.DateofService < @toEnd ${extra}
    GROUP BY n.ClientID, CAST(n.DateofService AS date)`, p);
}

// Turn a depth row into per-day coverage metrics.
function dayMetrics(row) {
  const depth = HOURS.map((_, i) => row[`h${i}`] || 0);
  const coveredHours = depth.filter((d) => d > 0).length;
  return {
    day: dayKey(row.day), facility: row.facility, notes: row.notes, staff: row.staff,
    depth, coveredHours, fullDay: coveredHours === 24,
    minDepth: Math.min(...depth), maxDepth: Math.max(...depth)
  };
}

// Roster: per-client rollup over the window.
export async function enhancedRoster(params) {
  const { from, toEnd } = range(params);
  const rows = await fetchDayDepths({ state: params.state, facility: params.facility, from, toEnd });
  const byClient = new Map();
  for (const r of rows) {
    if (!byClient.has(r.cid)) byClient.set(r.cid, { cid: r.cid, name: `${r.lastName || ''}, ${r.firstName || ''}`, days: [], fac: {} });
    const c = byClient.get(r.cid);
    c.days.push(dayMetrics(r));
    if (r.facility) c.fac[r.facility] = (c.fac[r.facility] || 0) + 1;
  }
  const out = [...byClient.values()].map((c) => {
    const days = c.days.length;
    const fullDays = c.days.filter((d) => d.fullDay).length;
    const coveredSum = c.days.reduce((a, d) => a + d.coveredHours, 0);
    const staffSum = c.days.reduce((a, d) => a + d.staff, 0);
    const notes = c.days.reduce((a, d) => a + d.notes, 0);
    return {
      clientId: c.cid, name: c.name, location: dominant(c.fac), locationCount: Object.keys(c.fac).length,
      days, fullDays, gapDays: days - fullDays,
      avgCoveredHours: days ? +(coveredSum / days).toFixed(1) : 0,
      avgStaff: days ? +(staffSum / days).toFixed(1) : 0,
      maxDepth: Math.max(0, ...c.days.map((d) => d.maxDepth)), notes
    };
  });
  const names = await fetchNames(out.map((r) => r.clientId));
  out.forEach((r) => { const n = names.get(r.clientId); if (n) r.name = `${n.LastName || ''}, ${n.FirstName || ''}`.replace(/^, |, $/, '').trim(); });
  out.sort((a, b) => (b.gapDays - a.gapDays) || (a.avgCoveredHours - b.avgCoveredHours));
  return { rows: out, range: { from, toEnd } };
}

// Per-client detail: per-day coverage (with the 24-slot depth) + the notes.
export async function enhancedClientDetail(params) {
  const cid = parseInt(params.clientId, 10);
  const { from, toEnd } = range(params);
  const [dayRows, noteRows, names] = await Promise.all([
    fetchDayDepths({ state: params.state, facility: params.facility, from, toEnd, cid }),
    c360Query(`SELECT n.BSL_EnhancedStaffingNoteID AS id, CAST(n.DateofService AS date) AS day,
        u.FirstName + ' ' + u.LastName AS author, n.LastModifiedOn AS lastMod, n.SubmittedOn AS submittedOn,
        loc.LocationName AS facility, (${HOURS.map((h) => `CAST(n.${h} AS int)`).join('+')}) AS coveredHours,
        ${HOURS.map((h, i) => `CAST(n.${h} AS int) AS h${i}`).join(', ')}
      FROM ${ESN} n JOIN ${LOC} loc ON n.Location = loc.LocationID
      LEFT JOIN dbo.s_User u ON n.CreatedBy = u.UserID
      WHERE n.ClientID = @cid AND loc.State = @state AND n.DateofService >= @from AND n.DateofService < @toEnd
      ${params.facility ? 'AND loc.LocationID = @facility' : ''}
      ORDER BY n.DateofService DESC`, { cid, state: params.state, from, toEnd, ...(params.facility ? { facility: parseInt(params.facility, 10) } : {}) }).catch(() => []),
    fetchNames([cid])
  ]);
  const nm = names.get(cid);
  const client = { ClientID: cid, FirstName: nm?.FirstName ?? null, LastName: nm?.LastName ?? null };
  const byDay = dayRows.map(dayMetrics).sort((a, b) => (a.day < b.day ? 1 : -1));
  const notes = noteRows.map((n) => ({
    id: n.id, day: dayKey(n.day), author: (n.author || '').trim() || null,
    coveredHours: n.coveredHours, facility: n.facility,
    status: n.lastMod ? (n.submittedOn ? 'Submitted' : 'Saved') : 'Scheduled',
    hours: HOURS.map((_, i) => n[`h${i}`] === 1)
  }));
  return { client, range: { from, toEnd }, byDay, notes };
}
