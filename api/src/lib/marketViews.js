// State documentation view. For a client in a residential program, a full day is
// 24h that should be accounted for across residential + day-hab notes. This view
// combines both note types into total hours documented per client per day and
// compares against 24h (the gap = undocumented time).
//
// State = s_Locations.State (a note's state comes from note.Location). Residential
// notes are pre-created "shells"; a shell with no LastModifiedOn is a scheduled
// note that hasn't been completed. Times are stored UTC (caller formats to the
// facility zone). PHI (named clients) — caller gates + audits.
//
// Perf: filter on ServiceDate/ServiceStart (sargable — ServiceDate is never null)
// and pre-filter locations by state, then UNION ALL + aggregate (no FULL OUTER JOIN).
import { c360Query } from './fabricC360.js';

const RES = 'dbo.BSL_ResidentialServiceNote';
const DAY = 'dbo.BSL_ServiceNoteDayHabilitation';
const LOC = 'dbo.s_Locations';
const DAY_MIN = 1440; // minutes in 24h

function range({ from, to } = {}) {
  const day = 86400000;
  const end = to ? new Date(to + 'T00:00:00Z') : new Date();
  const start = from ? new Date(from + 'T00:00:00Z') : new Date(end.getTime() - 30 * day);
  const toExcl = new Date(end.getTime() + day); // end-of-range day is inclusive
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(start), toEnd: iso(toExcl) };
}

// States that have facilities.
export async function marketOptions() {
  const states = await c360Query(`SELECT DISTINCT State AS name FROM ${LOC}
      WHERE State IS NOT NULL AND State <> '' AND IsInactive = 0 ORDER BY State`, {});
  return { states };
}

// The combined residential + day-hab note stream for a state + window.
const combined = (whereExtra) => `
  SELECT ClientID AS cid, CAST(ServiceDate AS date) AS day, ISNULL(Duration,0) AS mins,
         CASE WHEN LastModifiedOn IS NULL THEN 1 ELSE 0 END AS inc, 1 AS isRes
  FROM ${RES}
  WHERE Location IN (SELECT LocationID FROM ${LOC} WHERE State = @state)
    AND ServiceDate >= @from AND ServiceDate < @toEnd ${whereExtra.res}
  UNION ALL
  SELECT ClientID, CAST(ServiceStart AS date), DATEDIFF(MINUTE, ServiceStart, ServiceEnd),
         CASE WHEN LastModifiedOn IS NULL THEN 1 ELSE 0 END, 0
  FROM ${DAY}
  WHERE Location IN (SELECT LocationID FROM ${LOC} WHERE State = @state)
    AND ServiceStart >= @from AND ServiceStart < @toEnd ${whereExtra.day}`;

// Roster: per-client rollup — total documented hours, res/day split, days,
// incomplete shells, and the total 24h gap (undocumented minutes across days).
export async function marketDocRoster(params) {
  const state = params.state;
  const { from, toEnd } = range(params);
  const rows = await c360Query(`
    WITH n AS (${combined({ res: '', day: '' })}),
    perDay AS (
      SELECT cid, day, SUM(mins) AS totalMin, SUM(inc) AS incomplete,
        SUM(CASE WHEN isRes=1 THEN mins ELSE 0 END) AS resMin,
        SUM(CASE WHEN isRes=0 THEN mins ELSE 0 END) AS dayMin, COUNT(*) AS notes
      FROM n GROUP BY cid, day
    )
    SELECT p.cid AS clientId, cl.FirstName, cl.LastName,
      COUNT(*) AS days, SUM(p.notes) AS notes, SUM(p.totalMin) AS totalMin,
      SUM(p.resMin) AS resMin, SUM(p.dayMin) AS dayMin, SUM(p.incomplete) AS incomplete,
      SUM(CASE WHEN p.totalMin < ${DAY_MIN} THEN ${DAY_MIN} - p.totalMin ELSE 0 END) AS gapMin,
      SUM(CASE WHEN p.totalMin < ${DAY_MIN} THEN 1 ELSE 0 END) AS daysUnder,
      CASE WHEN SUM(p.resMin) > 0 THEN 1 ELSE 0 END AS hasRes
    FROM perDay p LEFT JOIN dbo.c_Client cl ON cl.ClientID = p.cid
    GROUP BY p.cid, cl.FirstName, cl.LastName
    ORDER BY gapMin DESC, cl.LastName, cl.FirstName`,
    { state, from, toEnd });
  return { rows, range: { from, toEnd } };
}

// Per-client detail: combined per-day totals (res/day split + 24h gap) and the
// incomplete scheduled residential notes with their shift times.
export async function marketClientDetail(params) {
  const cid = parseInt(params.clientId, 10);
  const state = params.state;
  const { from, toEnd } = range(params);
  const p = { cid, state, from, toEnd };

  const client = (await c360Query(
    `SELECT TOP 1 ClientID, FirstName, LastName, BirthDate FROM dbo.c_Client WHERE ClientID = @cid`,
    { cid }).catch(() => []))[0] || null;

  const byDay = await c360Query(`
    WITH n AS (${combined({ res: 'AND ClientID = @cid', day: 'AND ClientID = @cid' })})
    SELECT day, SUM(mins) AS totalMin,
      SUM(CASE WHEN isRes=1 THEN mins ELSE 0 END) AS resMin,
      SUM(CASE WHEN isRes=0 THEN mins ELSE 0 END) AS dayMin,
      COUNT(*) AS notes, SUM(inc) AS incomplete,
      (${DAY_MIN} - SUM(mins)) AS gapMin
    FROM n GROUP BY day ORDER BY day DESC`, p).catch(() => []);

  // Scheduled-but-not-completed residential shells (no LastModifiedOn): show times.
  const incomplete = await c360Query(`SELECT TOP 300 n.BSL_ResidentialServiceNoteID AS id,
      CAST(n.ServiceDate AS date) AS day, n.ServiceStartTime, n.ServiceEndTime, n.CreatedOn,
      loc.LocationName AS facility, loc.State AS state
    FROM ${RES} n JOIN ${LOC} loc ON n.Location = loc.LocationID
    WHERE n.ClientID = @cid AND loc.State = @state AND n.LastModifiedOn IS NULL
      AND n.ServiceDate >= @from AND n.ServiceDate < @toEnd
    ORDER BY day DESC, n.ServiceStartTime DESC`, p).catch(() => []);

  return { client, range: { from, toEnd }, byDay, incomplete };
}
