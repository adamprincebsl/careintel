// c360 "views" implemented as vetted, read-only, de-identified query functions.
//
// We have Viewer (read) on c360, so we can't physically CREATE VIEW there — the
// equivalent CREATE VIEW DDL is in docs/c360-mappings/ for the data team to
// stand up server-side. Until then, these functions ARE the views: parameterized
// SELECTs that de-identify (initials, no DOB/names/free-text), resolve UDO codes,
// and derive a clean note state.
//
// PHI posture: the Structured view is de-identified (client = initials only, no
// free text). Staff names are workforce data (shown for accountability). The
// free-text note (DetailedSummaryNote) is NOT here — it lives only in the
// scoring path (clientLookup-style, BAA-covered).

import { c360Query } from './fabricC360.js';

const NOTE = 'dbo.BSL_ResidentialServiceNote';
const UDO = 'dbo.s_UserDefinedOptions';

// The c360 note family (allowlist — generic profiling only runs on these).
export const NOTE_TABLES = [
  'BSL_ResidentialServiceNote',
  'BSL_ServiceNoteDayHabilitation',
  'BSL_ServiceNoteNursing',
  'BSL_WaiverServiceNote',
  'BSL_EnhancedStaffingNote',
  'UD_HabilitationServiceNote',
  'BSLBR_BehaviorSupportResidentialNote',
  'BSLBA_ServiceNoteBehaviorAnalyst'
];

/**
 * Generic note profiler — works for ANY note table in NOTE_TABLES. Returns its
 * column list + volume, and (when the columns exist) the validated org-wide
 * signals: SubmissionStatus distribution (Saved vs Submitted) and IsAbsent
 * breakdown. This is how we "look at" a new note type before writing its
 * specific structured view. Metadata + aggregates only — no client rows.
 */
export async function profileNote(table) {
  if (!NOTE_TABLES.includes(table)) throw new Error(`unknown note table: ${table}`);
  const out = { table };
  const run = async (key, sql, params) => {
    try { out[key] = await c360Query(sql, params); } catch (e) { out[key] = { error: e.code || e.message }; }
  };
  await run('columns', `SELECT COLUMN_NAME name, DATA_TYPE type, CHARACTER_MAXIMUM_LENGTH len
    FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t ORDER BY ORDINAL_POSITION`, { t: table });
  const cols = Array.isArray(out.columns) ? out.columns.map((c) => c.name) : [];
  await run('volume', `SELECT COUNT(*) total FROM dbo.${table}`);
  if (cols.includes('SubmissionStatus')) {
    await run('bySubmissionStatus', `SELECT TOP 15 n.SubmissionStatus code,
      COALESCE(u.UDDescription, 'Saved/Unsubmitted') label, COUNT(*) cnt
      FROM dbo.${table} n LEFT JOIN ${UDO} u ON n.SubmissionStatus = u.UDID
      GROUP BY n.SubmissionStatus, u.UDDescription ORDER BY cnt DESC`);
  }
  if (cols.includes('IsAbsent')) {
    await run('byAbsence', `SELECT ISNULL(IsAbsent,0) isAbsent, COUNT(*) cnt FROM dbo.${table} GROUP BY ISNULL(IsAbsent,0)`);
  }
  return out;
}
// Initials come from the CLIENT master (c_Client) — the note's own FirstName/
// LastName are frequently blank (esp. scheduled-origin notes).
const CLIENT = 'dbo.c_Client';
const CLIENT_JOIN = `LEFT JOIN ${CLIENT} cl ON n.ClientID = cl.ClientID`;
const INITIALS = "UPPER(LEFT(LTRIM(cl.FirstName),1)) + '.' + UPPER(LEFT(LTRIM(cl.LastName),1)) + '.'";

// Resolve Program/Location ids → names + State via the dimension tables.
const DIM_JOINS = `
  LEFT JOIN dbo.s_Program pr ON n.Program = pr.ProgramID
  LEFT JOIN dbo.s_ProgramType pt ON pr.ProgramTypeID = pt.ProgramTypeID
  LEFT JOIN dbo.s_Locations loc ON n.Location = loc.LocationID`;
const DIM_COLS = `pr.Program AS ProgramName, pt.ProgramType AS ProgramType, loc.LocationName AS LocationName, loc.State AS State`;

// Resolve charting/modifying staff from s_User — the note's CreatedBy_/LastModifiedBy_
// name twins are often blank; fall back to the user master.
const STAFF_JOINS = `
  LEFT JOIN dbo.s_User su ON n.CreatedBy = su.UserID
  LEFT JOIN dbo.s_User sm ON n.LastModifiedBy = sm.UserID`;
const CHARTED_BY = "COALESCE(NULLIF(LTRIM(n.CreatedBy_),''), NULLIF(LTRIM(CONCAT(su.FirstName,' ',su.LastName)),''))";
const MODIFIED_BY = "COALESCE(NULLIF(LTRIM(n.LastModifiedBy_),''), NULLIF(LTRIM(CONCAT(sm.FirstName,' ',sm.LastName)),''))";

// SELECT list for the de-identified structured residential-note view.
//
// VALIDATED mapping (against live data, 58,025 rows) + domain rules:
//  - There is NO draft feature. A note is either SAVED or SUBMITTED, keyed off
//    SubmissionStatus: NULL = Saved; set = Submitted (1015 Submitted /
//    1016 Feedback / 1017 Approved are submitted sub-states). IsDraft and
//    RecordStatus are not used.
//  - IsAbsent = 1 means the client was absent → the activity/community section
//    below is legitimately blank. Such notes are EXCLUDED from completeness /
//    offered / participated metrics (filter ISNULL(IsAbsent,0)=0).
//  - Activity/offered fields are CATEGORY-RELATIVE small codes, NOT global UDIDs
//    — do NOT join them to UDO.UDID. Use the denormalized `_` text columns
//    (CommunityActivitesOffered_ = 'Offered' / 'Not Offered').
const STRUCTURED_SELECT = `
  SELECT TOP (@top)
    n.BSL_ResidentialServiceNoteID AS NoteId,
    n.ClientID                     AS ClientId,
    ${INITIALS}                    AS ClientInitials,
    n.Program, n.Location, n.ServiceName, n.ServiceDate, n.Duration, n.InRatio,
    ${DIM_COLS},
    CASE WHEN n.CreatedBy IS NULL THEN 'Scheduled' ELSE 'Adhoc' END AS ChartType,
    n.CreatedBy        AS ChartedByStaffId,
    ${CHARTED_BY}      AS ChartedByName,
    n.CreatedOn        AS ChartedOn,
    ${MODIFIED_BY}     AS LastModifiedByName,
    n.LastModifiedOn,
    n.SubmissionStatus, ss.UDDescription AS SubmissionStatusLabel,
    CASE WHEN n.SubmissionStatus IS NULL THEN 'Saved' ELSE 'Submitted' END AS NoteState,
    n.IsAbsent,
    n.CommunityActivitesOffered_         AS CommunityServicesOffered,
    n.Library, n.Park, n.Shopping, n.SpecialEvent,
    n.SportsExercise, n.Walk, n.WorshipService, n.[Other],
    n.Appointment, n.ActivitiesofDailyLiving, n.InHomeActivities
  FROM ${NOTE} n
  LEFT JOIN ${UDO} ss ON n.SubmissionStatus = ss.UDID
  ${CLIENT_JOIN}
  ${DIM_JOINS}
  ${STAFF_JOINS}`;

/**
 * Query de-identified structured residential notes.
 * @param {object} f  { program?, from?, to?, state?: 'draft'|'submitted', top? }
 *   `from`/`to` filter ServiceDate; `state` filters draft vs submitted.
 */
export async function queryResidentialNotesStructured(f = {}) {
  const { where, params } = residentialWhere(f);
  params.top = Math.min(Math.max(parseInt(f.top, 10) || 100, 1), 1000);
  let w = where;
  if (f.absent === 'exclude') w = (w ? w + ' AND ' : 'WHERE ') + 'ISNULL(n.IsAbsent,0)=0';
  if (f.absent === 'only') w = (w ? w + ' AND ' : 'WHERE ') + 'n.IsAbsent=1';
  return c360Query(`${STRUCTURED_SELECT}\n  ${w}\n  ORDER BY n.ServiceDate DESC`, params);
}

// Shared filter → WHERE builder for residential-note queries.
// Filters: program (id), location (id), from/to (ServiceDate), status saved|submitted.
// NOTE: state/market filtering needs the location dimension (not in this table) — pending.
function residentialWhere(f = {}, alias = 'n') {
  const conds = [];
  const params = {};
  if (f.program !== undefined && f.program !== null && f.program !== '') { conds.push(`${alias}.Program = @program`); params.program = parseInt(f.program, 10); }
  if (f.location !== undefined && f.location !== null && f.location !== '') { conds.push(`${alias}.Location = @location`); params.location = parseInt(f.location, 10); }
  if (f.from) { conds.push(`${alias}.ServiceDate >= @from`); params.from = f.from; }
  if (f.to) { conds.push(`${alias}.ServiceDate <= @to`); params.to = f.to; }
  if (f.client !== undefined && f.client !== null && f.client !== '') { conds.push(`${alias}.ClientID = @client`); params.client = parseInt(f.client, 10); }
  if (f.status === 'submitted') conds.push(`${alias}.SubmissionStatus IS NOT NULL`);
  if (f.status === 'saved') conds.push(`${alias}.SubmissionStatus IS NULL`);
  // Scheduled (system-generated, CreatedBy blank) vs Adhoc (a staffer created it).
  if (f.chartType === 'scheduled') conds.push(`${alias}.CreatedBy IS NULL`);
  if (f.chartType === 'adhoc') conds.push(`${alias}.CreatedBy IS NOT NULL`);
  return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
}

const ACT_SUM = `(ISNULL(n.Library,0)+ISNULL(n.Park,0)+ISNULL(n.Shopping,0)+ISNULL(n.SpecialEvent,0)+ISNULL(n.SportsExercise,0)+ISNULL(n.Walk,0)+ISNULL(n.WorshipService,0)+ISNULL(n.[Other],0))`;

/**
 * Dashboard metrics for the Residential Notes page, honoring filters.
 * Activity "engaged" is heuristically value > 0 (encoding to confirm in Explore).
 */
export async function residentialNoteMetrics(f = {}) {
  const { where, params } = residentialWhere(f);
  // "present" = submitted + not absent (the population that should have activity data)
  const presentWhere = (where ? where + ' AND ' : 'WHERE ') + 'n.SubmissionStatus IS NOT NULL AND ISNULL(n.IsAbsent,0)=0';
  const out = {};
  const run = async (k, sql) => { try { out[k] = await c360Query(sql, params); } catch (e) { out[k] = { error: e.code || e.message }; } };

  await run('status', `SELECT COUNT(*) total,
    SUM(CASE WHEN n.SubmissionStatus IS NOT NULL THEN 1 ELSE 0 END) documented,
    SUM(CASE WHEN n.SubmissionStatus IS NULL THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN ISNULL(n.IsAbsent,0)=1 THEN 1 ELSE 0 END) absent,
    SUM(ISNULL(n.Duration,0)) totalMinutes
    FROM ${NOTE} n ${where}`);
  await run('timePerDay', `SELECT TOP 60 CAST(n.ServiceDate AS date) day,
    SUM(ISNULL(n.Duration,0)) minutes, COUNT(*) notes
    FROM ${NOTE} n ${where} GROUP BY CAST(n.ServiceDate AS date) ORDER BY day DESC`);
  await run('communityEngagement', `SELECT COUNT(*) notes,
    SUM(CASE WHEN n.CommunityActivitesOffered_='Offered' THEN 1 ELSE 0 END) offered,
    SUM(CASE WHEN n.CommunityActivitesOffered_='Not Offered' THEN 1 ELSE 0 END) notOffered,
    SUM(CASE WHEN ${ACT_SUM}>0 THEN 1 ELSE 0 END) participatedAny,
    SUM(CASE WHEN n.Library>0 THEN 1 ELSE 0 END) library, SUM(CASE WHEN n.Park>0 THEN 1 ELSE 0 END) park,
    SUM(CASE WHEN n.Shopping>0 THEN 1 ELSE 0 END) shopping, SUM(CASE WHEN n.SpecialEvent>0 THEN 1 ELSE 0 END) specialEvent,
    SUM(CASE WHEN n.SportsExercise>0 THEN 1 ELSE 0 END) sportsExercise, SUM(CASE WHEN n.Walk>0 THEN 1 ELSE 0 END) walk,
    SUM(CASE WHEN n.WorshipService>0 THEN 1 ELSE 0 END) worship, SUM(CASE WHEN n.[Other]>0 THEN 1 ELSE 0 END) other
    FROM ${NOTE} n ${presentWhere}`);
  await run('dayLivingActivities', `SELECT COUNT(*) notes,
    SUM(CASE WHEN n.ActivitiesofDailyLiving>0 THEN 1 ELSE 0 END) adlAddressed,
    SUM(CASE WHEN n.Appointment>0 THEN 1 ELSE 0 END) appointment
    FROM ${NOTE} n ${presentWhere}`);
  await run('homeEntertainment', `SELECT COUNT(*) notes,
    SUM(CASE WHEN n.InHomeActivities>0 THEN 1 ELSE 0 END) inHomeAny,
    SUM(CASE WHEN n.Games>0 THEN 1 ELSE 0 END) games, SUM(CASE WHEN n.Movie>0 THEN 1 ELSE 0 END) movie,
    SUM(CASE WHEN n.CookingBaking>0 THEN 1 ELSE 0 END) cookingBaking,
    SUM(CASE WHEN n.OutdoorActivities>0 THEN 1 ELSE 0 END) outdoor
    FROM ${NOTE} n ${presentWhere}`);
  return out;
}

/** Distinct Program / Location ids present (for filter dropdowns). State pending location-dim mapping. */
export async function residentialFilterOptions() {
  const programs = await c360Query(`SELECT DISTINCT TOP 200 Program FROM ${NOTE} WHERE Program IS NOT NULL ORDER BY Program`).catch(() => []);
  const locations = await c360Query(`SELECT DISTINCT TOP 500 Location FROM ${NOTE} WHERE Location IS NOT NULL ORDER BY Location`).catch(() => []);
  return { programs: programs.map((r) => r.Program), locations: locations.map((r) => r.Location) };
}

/** Full structured detail for ONE note (de-identified; NO free-text narrative — PHI). */
export async function getResidentialNoteDetail(noteId) {
  const rows = await c360Query(`SELECT TOP 1
    n.BSL_ResidentialServiceNoteID AS NoteId, n.ClientID AS ClientId, ${INITIALS} AS ClientInitials,
    n.Program, n.Location, n.ServiceName, n.ServiceDate, n.ServiceStartTime, n.ServiceEndTime, n.Duration, n.InRatio,
    ${DIM_COLS},
    CASE WHEN n.CreatedBy IS NULL THEN 'Scheduled' ELSE 'Adhoc' END AS ChartType,
    ${CHARTED_BY} AS ChartedByName, n.CreatedOn, ${MODIFIED_BY} AS LastModifiedByName, n.LastModifiedOn,
    n.SubmissionStatus, ss.UDDescription AS SubmissionStatusLabel,
    CASE WHEN n.SubmissionStatus IS NULL THEN 'Saved' ELSE 'Submitted' END AS NoteState, n.IsAbsent,
    n.CommunityActivitesOffered_ AS CommunityServicesOffered,
    n.Library, n.Park, n.Shopping, n.SpecialEvent, n.SportsExercise, n.Walk, n.WorshipService, n.[Other],
    n.ActivitiesofDailyLiving, n.Appointment,
    n.InHomeActivities, n.Games, n.Movie, n.CookingBaking, n.OutdoorActivities
    FROM ${NOTE} n LEFT JOIN ${UDO} ss ON n.SubmissionStatus = ss.UDID ${CLIENT_JOIN} ${DIM_JOINS} ${STAFF_JOINS}
    WHERE n.BSL_ResidentialServiceNoteID = @id`, { id: parseInt(noteId, 10) });
  return rows[0] || null;
}

/**
 * IDENTIFIED note (full PHI: names, DOB, gender, narrative). For authorized
 * clinical viewing ONLY — callers MUST gate on note.viewPhi + location scope +
 * fail-closed audit (see functions/c360Residential.js). Returns all note fields
 * + resolved status label + ChartType. Returns Program for the scope check.
 */
export async function getResidentialNoteIdentified(noteId) {
  const rows = await c360Query(`SELECT TOP 1 n.*,
    ss.UDDescription AS SubmissionStatusLabel,
    CASE WHEN n.CreatedBy IS NULL THEN 'Scheduled' ELSE 'Adhoc' END AS ChartType,
    cl.FirstName AS ClientFirstName, cl.LastName AS ClientLastName,
    cl.BirthDate AS ClientBirthDate, cl.Sex_ AS ClientGenderText,
    ${DIM_COLS},
    ${CHARTED_BY} AS ChartedByName, ${MODIFIED_BY} AS LastModifiedByName
    FROM ${NOTE} n LEFT JOIN ${UDO} ss ON n.SubmissionStatus = ss.UDID ${CLIENT_JOIN} ${DIM_JOINS} ${STAFF_JOINS}
    WHERE n.BSL_ResidentialServiceNoteID = @id`, { id: parseInt(noteId, 10) });
  return rows[0] || null;
}

/**
 * Validation / profiling of the residential-note table — confirms the mapping
 * against live data (status labels, offered/participated, data quality). All
 * aggregate; no client rows. Returns a structured report. Each section is
 * independently guarded so a partial result still returns.
 */
export async function profileResidentialNotes() {
  const out = {};
  const run = async (key, sql, params) => {
    try { out[key] = await c360Query(sql, params); }
    catch (e) { out[key] = { error: e.code || e.message }; }
  };

  await run('volume', `SELECT COUNT(*) total, SUM(CAST(IsDraft AS int)) drafts,
    MIN(ServiceDate) minServiceDate, MAX(ServiceDate) maxServiceDate FROM ${NOTE}`);
  await run('bySubmissionStatus', `SELECT TOP 15 n.SubmissionStatus code,
    COALESCE(u.UDDescription, 'Saved/Unsubmitted') label, COUNT(*) cnt
    FROM ${NOTE} n LEFT JOIN ${UDO} u ON n.SubmissionStatus = u.UDID
    GROUP BY n.SubmissionStatus, u.UDDescription ORDER BY cnt DESC`);
  await run('communityOfferedLabels', `SELECT TOP 15 CommunityActivitesOffered_ lbl, COUNT(*) cnt
    FROM ${NOTE} GROUP BY CommunityActivitesOffered_ ORDER BY cnt DESC`);
  // Absence breakdown among submitted notes (absent notes skip the section).
  await run('byAbsence', `SELECT ISNULL(IsAbsent,0) isAbsent, COUNT(*) cnt
    FROM ${NOTE} WHERE SubmissionStatus IS NOT NULL GROUP BY ISNULL(IsAbsent,0)`);
  // Offered/participated among SUBMITTED, NON-ABSENT notes (validated + domain rule).
  await run('offeredVsParticipated', `SELECT COUNT(*) submittedPresentNotes,
    SUM(CASE WHEN CommunityActivitesOffered_ = 'Offered' THEN 1 ELSE 0 END) offered,
    SUM(CASE WHEN CommunityActivitesOffered_ = 'Not Offered' THEN 1 ELSE 0 END) notOffered,
    SUM(CASE WHEN (ISNULL(Library,0)+ISNULL(Park,0)+ISNULL(Shopping,0)+ISNULL(SpecialEvent,0)
      +ISNULL(SportsExercise,0)+ISNULL(Walk,0)+ISNULL(WorshipService,0)+ISNULL([Other],0)) > 0
      THEN 1 ELSE 0 END) participatedAny,
    SUM(CASE WHEN CommunityActivitesOffered_ = 'Offered' AND (ISNULL(Library,0)+ISNULL(Park,0)
      +ISNULL(Shopping,0)+ISNULL(SpecialEvent,0)+ISNULL(SportsExercise,0)+ISNULL(Walk,0)
      +ISNULL(WorshipService,0)+ISNULL([Other],0)) > 0 THEN 1 ELSE 0 END) offeredAndParticipated
    FROM ${NOTE} WHERE SubmissionStatus IS NOT NULL AND ISNULL(IsAbsent,0) = 0`);
  await run('dataQuality', `SELECT
    SUM(CASE WHEN ClientID IS NULL THEN 1 ELSE 0 END) nullClientId,
    SUM(CASE WHEN CreatedBy IS NULL THEN 1 ELSE 0 END) nullCreatedBy,
    SUM(CASE WHEN ServiceDate IS NULL THEN 1 ELSE 0 END) nullServiceDate,
    SUM(CASE WHEN ServiceDate < '2018-01-01' THEN 1 ELSE 0 END) preDate2018,
    SUM(CASE WHEN ServiceDate > GETDATE() THEN 1 ELSE 0 END) futureDated FROM ${NOTE}`);
  return out;
}
