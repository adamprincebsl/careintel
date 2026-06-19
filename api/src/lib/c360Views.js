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
const INITIALS = "UPPER(LEFT(LTRIM(n.FirstName),1)) + '.' + UPPER(LEFT(LTRIM(n.LastName),1)) + '.'";

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
    ${INITIALS}                    AS ClientInitials,
    n.Program, n.Location, n.ServiceName, n.ServiceDate, n.Duration, n.InRatio,
    n.CreatedBy        AS ChartedByStaffId,
    n.CreatedBy_       AS ChartedByName,
    n.CreatedOn        AS ChartedOn,
    n.LastModifiedBy_  AS LastModifiedByName,
    n.LastModifiedOn,
    n.SubmissionStatus, ss.UDDescription AS SubmissionStatusLabel,
    CASE WHEN n.SubmissionStatus IS NULL THEN 'Saved' ELSE 'Submitted' END AS NoteState,
    n.IsAbsent,
    n.CommunityActivitesOffered_         AS CommunityServicesOffered,
    n.Library, n.Park, n.Shopping, n.SpecialEvent,
    n.SportsExercise, n.Walk, n.WorshipService, n.[Other],
    n.Appointment, n.ActivitiesofDailyLiving, n.InHomeActivities
  FROM ${NOTE} n
  LEFT JOIN ${UDO} ss ON n.SubmissionStatus = ss.UDID`;

/**
 * Query de-identified structured residential notes.
 * @param {object} f  { program?, from?, to?, state?: 'draft'|'submitted', top? }
 *   `from`/`to` filter ServiceDate; `state` filters draft vs submitted.
 */
export async function queryResidentialNotesStructured(f = {}) {
  const conds = [];
  const params = { top: Math.min(Math.max(parseInt(f.top, 10) || 100, 1), 1000) };
  if (f.program != null) { conds.push('n.Program = @program'); params.program = parseInt(f.program, 10); }
  if (f.from) { conds.push('n.ServiceDate >= @from'); params.from = f.from; }
  if (f.to) { conds.push('n.ServiceDate <= @to'); params.to = f.to; }
  // State keys off SubmissionStatus (validated): NULL = Saved, set = Submitted.
  if (f.state === 'saved') conds.push('n.SubmissionStatus IS NULL');
  if (f.state === 'submitted') conds.push('n.SubmissionStatus IS NOT NULL');
  // Absent notes legitimately skip the activity section.
  if (f.absent === 'exclude') conds.push('ISNULL(n.IsAbsent, 0) = 0');
  if (f.absent === 'only') conds.push('n.IsAbsent = 1');
  const where = conds.length ? `\n  WHERE ${conds.join(' AND ')}` : '';
  return c360Query(`${STRUCTURED_SELECT}${where}\n  ORDER BY n.ServiceDate DESC`, params);
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
