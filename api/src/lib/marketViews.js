// Market documentation view. Residential notes are pre-created "shells" from the
// home's schedule; a shell with no LastModifiedOn is a scheduled note that hasn't
// been completed. This view measures completion of scheduled notes per market,
// rolled up per client, with the incomplete (missing/pending) notes' times.
//
// Market = s_Locations.MarketLH (a UserDefinedOption). A note's market comes from
// note.Location -> s_Locations. Times are stored UTC; the caller formats to the
// facility state's zone. PHI (named clients) — caller gates + audits.
import { c360Query } from './fabricC360.js';

const RES = 'dbo.BSL_ResidentialServiceNote';
const DAY = 'dbo.BSL_ServiceNoteDayHabilitation';
const LOC = 'dbo.s_Locations';
const UDO = 'dbo.s_UserDefinedOptions';

// Normalize a from/to window to inclusive-start / exclusive-end date strings.
function range({ from, to } = {}) {
  const day = 86400000;
  const end = to ? new Date(to + 'T00:00:00Z') : new Date();
  const start = from ? new Date(from + 'T00:00:00Z') : new Date(end.getTime() - 30 * day);
  const toExcl = new Date((to ? end.getTime() : end.getTime()) + day); // end-of-range day is inclusive
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(start), toEnd: iso(toExcl) };
}

// Markets that have facilities, with facility counts.
export async function marketOptions() {
  const markets = await c360Query(`SELECT udo.UDID AS id, udo.UDDescription AS name, COUNT(*) AS facilities
      FROM ${LOC} loc JOIN ${UDO} udo ON udo.UDID = loc.MarketLH
      WHERE loc.IsInactive = 0
      GROUP BY udo.UDID, udo.UDDescription
      ORDER BY udo.UDDescription`, {});
  return { markets };
}

// Roster: per-client residential + day-hab completion for a market + window.
export async function marketDocRoster(params) {
  const market = parseInt(params.market, 10);
  const { from, toEnd } = range(params);
  const rows = await c360Query(`
    WITH res AS (
      SELECT n.ClientID AS cid,
        COUNT(*) AS scheduled,
        SUM(CASE WHEN n.LastModifiedOn IS NOT NULL THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN n.LastModifiedOn IS NULL THEN 1 ELSE 0 END) AS incomplete,
        SUM(CASE WHEN n.LastModifiedOn IS NOT NULL THEN ISNULL(n.Duration,0) ELSE 0 END) AS minutes
      FROM ${RES} n JOIN ${LOC} loc ON n.Location = loc.LocationID
      WHERE loc.MarketLH = @market
        AND COALESCE(n.ServiceStartTime, n.ServiceDate) >= @from
        AND COALESCE(n.ServiceStartTime, n.ServiceDate) < @toEnd
      GROUP BY n.ClientID
    ),
    day AS (
      SELECT n.ClientID AS cid,
        COUNT(*) AS scheduled,
        SUM(CASE WHEN n.LastModifiedOn IS NOT NULL THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN n.LastModifiedOn IS NULL THEN 1 ELSE 0 END) AS incomplete,
        SUM(CASE WHEN n.LastModifiedOn IS NOT NULL THEN DATEDIFF(MINUTE, n.ServiceStart, n.ServiceEnd) ELSE 0 END) AS minutes
      FROM ${DAY} n JOIN ${LOC} loc ON n.Location = loc.LocationID
      WHERE loc.MarketLH = @market AND n.ServiceStart >= @from AND n.ServiceStart < @toEnd
      GROUP BY n.ClientID
    )
    SELECT COALESCE(r.cid, d.cid) AS clientId, cl.FirstName, cl.LastName,
      ISNULL(r.scheduled,0) AS resScheduled, ISNULL(r.completed,0) AS resCompleted,
      ISNULL(r.incomplete,0) AS resIncomplete, ISNULL(r.minutes,0) AS resMinutes,
      ISNULL(d.scheduled,0) AS dayScheduled, ISNULL(d.completed,0) AS dayCompleted,
      ISNULL(d.incomplete,0) AS dayIncomplete, ISNULL(d.minutes,0) AS dayMinutes
    FROM res r
    FULL OUTER JOIN day d ON r.cid = d.cid
    LEFT JOIN dbo.c_Client cl ON cl.ClientID = COALESCE(r.cid, d.cid)
    ORDER BY (ISNULL(r.incomplete,0) + ISNULL(d.incomplete,0)) DESC, cl.LastName, cl.FirstName`,
    { market, from, toEnd });
  return { rows, range: { from, toEnd } };
}

// Per-client detail: per-day completion + the incomplete scheduled notes (times).
export async function marketClientDetail(params) {
  const cid = parseInt(params.clientId, 10);
  const market = params.market ? parseInt(params.market, 10) : null;
  const { from, toEnd } = range(params);
  const marketClause = market ? 'AND loc.MarketLH = @market' : '';
  const p = { cid, from, toEnd, ...(market ? { market } : {}) };

  const client = (await c360Query(
    `SELECT TOP 1 ClientID, FirstName, LastName, BirthDate FROM dbo.c_Client WHERE ClientID = @cid`,
    { cid }).catch(() => []))[0] || null;

  const residentialByDay = await c360Query(`SELECT CAST(COALESCE(n.ServiceStartTime, n.ServiceDate) AS date) AS day,
      COUNT(*) AS scheduled,
      SUM(CASE WHEN n.LastModifiedOn IS NOT NULL THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN n.LastModifiedOn IS NULL THEN 1 ELSE 0 END) AS incomplete,
      SUM(CASE WHEN n.LastModifiedOn IS NOT NULL THEN ISNULL(n.Duration,0) ELSE 0 END) AS minutes
    FROM ${RES} n JOIN ${LOC} loc ON n.Location = loc.LocationID
    WHERE n.ClientID = @cid ${marketClause}
      AND COALESCE(n.ServiceStartTime, n.ServiceDate) >= @from
      AND COALESCE(n.ServiceStartTime, n.ServiceDate) < @toEnd
    GROUP BY CAST(COALESCE(n.ServiceStartTime, n.ServiceDate) AS date) ORDER BY day DESC`, p).catch(() => []);

  const dayByDay = await c360Query(`SELECT CAST(n.ServiceStart AS date) AS day,
      COUNT(*) AS scheduled,
      SUM(CASE WHEN n.LastModifiedOn IS NOT NULL THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN n.LastModifiedOn IS NULL THEN 1 ELSE 0 END) AS incomplete,
      SUM(CASE WHEN n.LastModifiedOn IS NOT NULL THEN DATEDIFF(MINUTE, n.ServiceStart, n.ServiceEnd) ELSE 0 END) AS minutes
    FROM ${DAY} n JOIN ${LOC} loc ON n.Location = loc.LocationID
    WHERE n.ClientID = @cid ${marketClause} AND n.ServiceStart >= @from AND n.ServiceStart < @toEnd
    GROUP BY CAST(n.ServiceStart AS date) ORDER BY day DESC`, p).catch(() => []);

  // The scheduled-but-not-completed residential notes (no LastModifiedOn): show times.
  const incomplete = await c360Query(`SELECT TOP 300 n.BSL_ResidentialServiceNoteID AS id,
      CAST(COALESCE(n.ServiceStartTime, n.ServiceDate) AS date) AS day,
      n.ServiceStartTime, n.ServiceEndTime, n.CreatedOn,
      loc.LocationName AS facility, loc.State AS state
    FROM ${RES} n JOIN ${LOC} loc ON n.Location = loc.LocationID
    WHERE n.ClientID = @cid ${marketClause} AND n.LastModifiedOn IS NULL
      AND COALESCE(n.ServiceStartTime, n.ServiceDate) >= @from
      AND COALESCE(n.ServiceStartTime, n.ServiceDate) < @toEnd
    ORDER BY day DESC, n.ServiceStartTime DESC`, p).catch(() => []);

  return { client, range: { from, toEnd }, residentialByDay, dayByDay, incomplete };
}
