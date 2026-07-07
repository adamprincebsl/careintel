// Incident reporting views over c360 `BSL_Incident` (the initial incident report).
// Consolidated report; type comes from the child table BSL_Incident_TypeofIncident
// (one incident -> many types). De-identified list + identified detail (PHI narrative).
// Client linkage (IndividualServedsName) is unresolved — shown as a raw ref for now.
import { c360Query } from './fabricC360.js';

const INC = 'dbo.BSL_Incident';
const TYPE = 'dbo.BSL_Incident_TypeofIncident';
const UDO = 'dbo.s_UserDefinedOptions';
const LOC = 'dbo.s_Locations';
// The incident's client = the "Individual Served", joined by Legacy EHR id (404/427).
const CLIENT_JOIN = 'LEFT JOIN dbo.c_Client cl ON i.LegacyEHRID = cl.LegacyEHRID';
const INITIALS = "UPPER(LEFT(LTRIM(cl.FirstName),1)) + '.' + UPPER(LEFT(LTRIM(cl.LastName),1)) + '.'";
const udo = (col) => `(SELECT TOP 1 UDDescription FROM ${UDO} WHERE UDID = i.[${col}])`;

const INCIDENT_DATE = 'CAST(i.DateofIncident AS date)';
const MONTH = "LEFT(CONVERT(varchar(10), i.DateofIncident, 23), 7)"; // yyyy-MM
const TYPES_AGG = `(SELECT STRING_AGG(u.UDDescription, ', ')
  FROM ${TYPE} t JOIN ${UDO} u ON t.TypeofIncident = u.UDID
  WHERE t.BSL_IncidentID = i.BSL_IncidentID)`;

function buildWhere(f = {}) {
  const conds = [], params = {};
  if (f.from) { conds.push('i.DateofIncident >= @from'); params.from = f.from; }
  if (f.to) { conds.push('i.DateofIncident <= @to'); params.to = f.to; }
  if (f.severity) { conds.push('i.Severity = @sev'); params.sev = parseInt(f.severity, 10); }
  if (f.facility) { conds.push('i.HomeFacility = @fac'); params.fac = parseInt(f.facility, 10); }
  if (f.type) {
    conds.push(`EXISTS (SELECT 1 FROM ${TYPE} t WHERE t.BSL_IncidentID = i.BSL_IncidentID AND t.TypeofIncident = @typ)`);
    params.typ = parseInt(f.type, 10);
  }
  if (f.state) {
    conds.push(`i.HomeFacility IN (SELECT LocationID FROM ${LOC} WHERE State = @state)`);
    params.state = f.state;
  }
  if (f.program) {
    conds.push(`EXISTS (SELECT 1 FROM dbo.c_Client cl2
      JOIN dbo.c_ClientProgram cp ON cp.CaseID = cl2.ClientID
      JOIN dbo.s_Program pr ON cp.ProgramID = pr.ProgramID
      JOIN dbo.s_ProgramType pt ON pr.ProgramTypeID = pt.ProgramTypeID
      WHERE cl2.LegacyEHRID = i.LegacyEHRID AND pt.ProgramType = @program)`);
    params.program = f.program;
  }
  return { clause: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
}

export async function incidentFilterOptions() {
  const m = (r) => ({ id: r.id, name: r.name || String(r.id) });
  const types = await c360Query(`SELECT DISTINCT t.TypeofIncident id, u.UDDescription name
    FROM ${TYPE} t JOIN ${UDO} u ON t.TypeofIncident = u.UDID ORDER BY u.UDDescription`).catch(() => []);
  const severities = await c360Query(`SELECT DISTINCT i.Severity id, u.UDDescription name
    FROM ${INC} i JOIN ${UDO} u ON i.Severity = u.UDID ORDER BY u.UDDescription`).catch(() => []);
  const facilities = await c360Query(`SELECT DISTINCT loc.LocationID id, loc.LocationName name
    FROM ${INC} i JOIN ${LOC} loc ON i.HomeFacility = loc.LocationID
    WHERE loc.LocationName IS NOT NULL ORDER BY loc.LocationName`).catch(() => []);
  const states = await c360Query(`SELECT DISTINCT loc.State id, loc.State name
    FROM ${INC} i JOIN ${LOC} loc ON i.HomeFacility = loc.LocationID
    WHERE loc.State IS NOT NULL ORDER BY loc.State`).catch(() => []);
  const programs = await c360Query(`SELECT DISTINCT pt.ProgramType id, pt.ProgramType name
    FROM dbo.s_ProgramType pt WHERE pt.ProgramType IS NOT NULL ORDER BY pt.ProgramType`).catch(() => []);
  return { types: types.map(m), severities: severities.map(m), facilities: facilities.map(m), states: states.map(m), programs: programs.map(m) };
}

export async function incidentMetrics(f = {}) {
  const { clause, params } = buildWhere(f);
  const out = {};
  const run = async (k, sql) => { try { out[k] = await c360Query(sql, params); } catch (e) { out[k] = { error: e.message }; } };
  await run('total', `SELECT COUNT(*) total,
    SUM(CASE WHEN ISNULL(i.AbuseNeglect,0)=1 THEN 1 ELSE 0 END) abuseNeglect,
    SUM(CASE WHEN ISNULL(i.BehaviorIncident,0)=1 THEN 1 ELSE 0 END) behavior,
    SUM(CASE WHEN ISNULL(i.AccidentMedicalIncident,0)=1 THEN 1 ELSE 0 END) accidentMedical
    FROM ${INC} i ${clause}`);
  await run('byType', `SELECT u.UDDescription label, COUNT(*) c
    FROM ${TYPE} t JOIN ${UDO} u ON t.TypeofIncident = u.UDID
    JOIN ${INC} i ON i.BSL_IncidentID = t.BSL_IncidentID ${clause}
    GROUP BY u.UDDescription ORDER BY c DESC`);
  await run('bySeverity', `SELECT COALESCE(u.UDDescription,'(none)') label, COUNT(*) c
    FROM ${INC} i LEFT JOIN ${UDO} u ON i.Severity = u.UDID ${clause}
    GROUP BY u.UDDescription ORDER BY c DESC`);
  await run('byMonth', `SELECT ${MONTH} month, COUNT(*) c FROM ${INC} i ${clause}
    GROUP BY ${MONTH} ORDER BY month`);
  await run('byPlace', `SELECT TOP 15 COALESCE(pl.UDDescription,'(none)') place, COUNT(*) c
    FROM ${INC} i LEFT JOIN ${UDO} pl ON i.LocationofIncident = pl.UDID ${clause}
    GROUP BY pl.UDDescription ORDER BY c DESC`);
  // By individual — client resolved via Legacy EHR id -> initials (de-identified)
  await run('byClient', `SELECT TOP 20 ${INITIALS} initials, i.LegacyEHRID clientRef, COUNT(*) c
    FROM ${INC} i ${CLIENT_JOIN} ${clause ? clause + ' AND' : 'WHERE'} i.LegacyEHRID IS NOT NULL
    GROUP BY ${INITIALS}, i.LegacyEHRID ORDER BY c DESC`);
  return out;
}

// De-identified list (no narrative, no client identity) — reporting.
export async function queryIncidentsStructured(f = {}) {
  const { clause, params } = buildWhere(f);
  const top = Math.min(parseInt(f.top, 10) || 1000, 5000);
  return c360Query(`SELECT TOP ${top}
    i.BSL_IncidentID AS IncidentId,
    ${INCIDENT_DATE} AS IncidentDate,
    i.TimeofIncident AS TimeofIncident,
    ${INITIALS} AS ClientInitials,
    ${TYPES_AGG} AS IncidentTypes,
    sev.UDDescription AS SeverityOfInjury,
    ${udo('AntagonistVictim')} AS AntagonistVictim,
    pl.UDDescription AS PlaceOfIncident,
    i.OtherLocation AS OtherLocation,
    loc.LocationName AS Facility, loc.State AS State,
    CASE WHEN ISNULL(i.AbuseNeglect,0)=1 THEN 'Yes' ELSE 'No' END AS AbuseNeglect,
    i.Was911called_ AS Was911Called,
    i.CreatedBy_ AS ReportedBy, i.CreatedOn AS CreatedOn, i.LastModifiedOn AS LastModifiedOn
    FROM ${INC} i
    ${CLIENT_JOIN}
    LEFT JOIN ${UDO} sev ON i.Severity = sev.UDID
    LEFT JOIN ${UDO} pl ON i.LocationofIncident = pl.UDID
    LEFT JOIN ${LOC} loc ON i.HomeFacility = loc.LocationID
    ${clause}
    ORDER BY i.DateofIncident DESC`, params);
}

// Incident columns that are UDO codes, mapped to their output alias. Resolved in
// a single lookup (not 21 correlated subqueries — Fabric plans those O(n^2): 3
// subqueries ~0.7s but all 21 ~44s, which blew past the 60s timeout -> 502).
const IDENT_UDO = [
  ['AntagonistVictim', 'AntagonistVictim'],
  ['AbuseNeglectType', 'AbuseNeglectType'], ['AccidentMedicalIncidentType', 'AccidentMedicalType'],
  ['MedVarianceType', 'MedVarianceType'], ['MedErrorType', 'MedErrorType'],
  ['IllnessType', 'IllnessType'], ['BehaviorIncidentType', 'BehaviorIncidentType'],
  ['BehaviorCause', 'BehaviorCause'], ['BehaviorDuration', 'BehaviorDuration'],
  ['BehaviorIntensity', 'BehaviorIntensity'], ['BehaviorInterventions', 'BehaviorInterventions'],
  ['Outcome', 'BehaviorOutcome'], ['RestraintTypeUsed', 'RestraintType'], ['PhysicalAggressionType', 'PhysicalAggressionType'],
  ['InjuryType', 'InjuryType'], ['InjuryLocationPrimaryAreaoftheBody', 'InjuryAreaPrimary'],
  ['InjuryLocationSpecificAreaoftheBody', 'InjuryAreaSpecific'],
  ['TreatmentProvidedBy', 'TreatmentProvidedBy'], ['MedicalInterventions', 'MedicalInterventions'],
  ['Wasseizureprotocolfollowed', 'SeizureProtocolFollowed'], ['SeizureDetails', 'SeizureDetails']
];

// Identified detail (PHI narrative). Caller gates note.viewPhi + audits.
export async function getIncidentIdentified(id) {
  const udidCols = IDENT_UDO.map(([src, alias]) => `i.[${src}] AS [udid_${alias}]`).join(', ');
  const rows = await c360Query(`SELECT TOP 1
    i.BSL_IncidentID AS IncidentId, ${INCIDENT_DATE} AS IncidentDate, i.TimeofIncident,
    ${TYPES_AGG} AS IncidentTypes,
    cl.ClientID AS ClientId, cl.FirstName AS ClientFirstName, cl.LastName AS ClientLastName, cl.BirthDate AS ClientBirthDate,
    sev.UDDescription AS SeverityOfInjury,
    pl.UDDescription AS PlaceOfIncident, i.OtherLocation,
    loc.LocationName AS Facility, loc.State AS State,
    ${udidCols},
    i.SeizureStartTime, i.SeizureEndTime,
    i.Definedasachokingevent_ AS ChokingEvent, i.Whatdidtheindividualchokeon AS ChokedOn,
    i.Whatwastheindividualdoingatthetimeofthechokingincident AS ChokingActivity,
    i.Whatwasthedietfortheindividualatthetimeoftheincident AS ChokingDiet,
    i.Descriptionofwhathappenedduringtheincident AS WhatHappened,
    i.Descriptionofwheretheincidentoccurred AS WhereOccurred,
    i.Descriptionofwhentheincidentoccurred AS WhenOccurred,
    i.Descriptionofwhytheincidentoccurred AS WhyOccurred,
    i.Descriptionofhowtheincidentoccurred AS HowOccurred,
    i.Wheredidthefalloccur AS FallLocation,
    i.Whatwasgoingonwiththeindividualimmediatelyprecedingthefall AS FallPreceding,
    i.Whatcontributingfactorswererelatedtotheindividualsfall AS FallContributingFactors,
    i.Was911called_ AS Was911Called, i.RecommendationsfromtheTeam AS TeamRecommendations,
    i.BloodPressure, i.Temperature, i.HeartRate, i.Respirations, i.BloodSugar,
    i.CreatedBy_ AS ReportedBy, i.CreatedOn, i.LastModifiedOn
    FROM ${INC} i
    ${CLIENT_JOIN}
    LEFT JOIN ${UDO} sev ON i.Severity = sev.UDID
    LEFT JOIN ${UDO} pl ON i.LocationofIncident = pl.UDID
    LEFT JOIN ${LOC} loc ON i.HomeFacility = loc.LocationID
    WHERE i.BSL_IncidentID = @id`, { id: parseInt(id, 10) });
  const row = rows[0];
  if (!row) return null;

  // Resolve every UDO code in one lookup, then replace the raw udid_* fields.
  const codes = [...new Set(IDENT_UDO.map(([, a]) => row[`udid_${a}`]).filter((v) => v != null))];
  const map = new Map();
  if (codes.length) {
    const params = Object.fromEntries(codes.map((v, i) => [`u${i}`, v]));
    const lk = await c360Query(`SELECT UDID, UDDescription FROM ${UDO} WHERE UDID IN (${codes.map((_, i) => `@u${i}`).join(',')})`, params).catch(() => []);
    for (const r of lk) map.set(r.UDID, r.UDDescription);
  }
  for (const [, alias] of IDENT_UDO) { row[alias] = map.get(row[`udid_${alias}`]) ?? null; delete row[`udid_${alias}`]; }
  return row;
}

// Child + workflow sub-forms for one incident (each linked by BSL_IncidentID).
// Returns raw rows (TOP 1 each; witness can be many) — the UI filters system/blank
// columns. Fall is omitted (client-keyed; its detail is inline on the incident).
const SUBFORMS = [
  ['deathReporting', 'BSL_IncidentDeathReporting'],
  ['medicationVariance', 'BSL_IncidentMedicationVariance'],
  ['sib', 'BSL_IncidentSib'],
  ['rootCause', 'BSL_IncidentRootCauseAnalysis'],
  ['correctiveAction', 'BSL_IncidentCorrectiveActionPlan'],
  ['clinicalDebrief', 'BSLPA_IncidentClinicalDebriefTwo'],
  ['supervisorFollowUp', 'BSL_IncidentSupervisorFollowUpTwo'],
  ['qaFollowUp', 'BSL_IncidentQaFollowUp']
];
// Which follow-on sub-forms already exist in c360 for this incident (auto-derived
// workflow status — the app doesn't track these lanes, it reflects them).
export async function getIncidentWorkflowStatus(id) {
  const iid = parseInt(id, 10);
  const exists = async (tbl) => ((await c360Query(`SELECT TOP 1 1 x FROM dbo.${tbl} WHERE BSL_IncidentID = @id`, { id: iid }).catch(() => [])).length > 0);
  return {
    rootCauseOnFile: await exists('BSL_IncidentRootCauseAnalysis'),
    correctiveActionOnFile: await exists('BSL_IncidentCorrectiveActionPlan'),
    qaOnFile: await exists('BSL_IncidentQaFollowUp'),
    supervisorFollowUpOnFile: await exists('BSL_IncidentSupervisorFollowUpTwo'),
    clinicalDebriefOnFile: await exists('BSLPA_IncidentClinicalDebriefTwo'),
    notified: await exists('BSL_IncidentNotificationLog')
  };
}

// Compliance signals from c360 (the app layer adds overdue-task signals separately).
export async function incidentComplianceSignals() {
  const out = {};
  const run = async (k, sql) => { try { out[k] = await c360Query(sql); } catch (e) { out[k] = { error: e.message }; } };
  // Serious / reportable (serious injury, Death, or Abuse-Neglect) with no root cause on file.
  await run('missingRootCause', `SELECT TOP 100 i.BSL_IncidentID id, ${INCIDENT_DATE} date,
      ${INITIALS} client, sev.UDDescription severity, loc.LocationName facility
    FROM ${INC} i ${CLIENT_JOIN}
    LEFT JOIN ${UDO} sev ON i.Severity = sev.UDID
    LEFT JOIN ${LOC} loc ON i.HomeFacility = loc.LocationID
    WHERE (sev.UDDescription LIKE '%Serious%'
        OR EXISTS (SELECT 1 FROM ${TYPE} t JOIN ${UDO} u ON t.TypeofIncident=u.UDID
                   WHERE t.BSL_IncidentID=i.BSL_IncidentID AND (u.UDDescription LIKE '%Death%' OR u.UDDescription LIKE '%Abuse%')))
      AND NOT EXISTS (SELECT 1 FROM dbo.BSL_IncidentRootCauseAnalysis r WHERE r.BSL_IncidentID = i.BSL_IncidentID)
    ORDER BY i.DateofIncident DESC`);
  // Recent incidents with no notification logged.
  await run('noNotification', `SELECT TOP 100 i.BSL_IncidentID id, ${INCIDENT_DATE} date, ${INITIALS} client, loc.LocationName facility
    FROM ${INC} i ${CLIENT_JOIN} LEFT JOIN ${LOC} loc ON i.HomeFacility = loc.LocationID
    WHERE i.DateofIncident >= DATEADD(day, -90, CAST(GETUTCDATE() AS date))
      AND NOT EXISTS (SELECT 1 FROM dbo.BSL_IncidentNotificationLog n WHERE n.BSL_IncidentID = i.BSL_IncidentID)
    ORDER BY i.DateofIncident DESC`);
  // High-frequency individuals (last 90 days).
  await run('highFrequency', `SELECT TOP 15 ${INITIALS} client, i.LegacyEHRID clientRef, COUNT(*) c
    FROM ${INC} i ${CLIENT_JOIN}
    WHERE i.DateofIncident >= DATEADD(day, -90, CAST(GETUTCDATE() AS date)) AND i.LegacyEHRID IS NOT NULL
    GROUP BY ${INITIALS}, i.LegacyEHRID HAVING COUNT(*) >= 2 ORDER BY c DESC`);
  return out;
}

// Data needed to pre-fill the Michigan BCAL-4607 incident/accident report.
export async function getIncidentBcal4607Data(id) {
  const rows = await c360Query(`SELECT TOP 1
      i.BSL_IncidentID AS id, i.DateofIncident, i.TimeofIncident,
      cl.FirstName, cl.LastName,
      cl.Address1 AS clientAddr, cl.City AS clientCity, cl.State AS clientState, cl.ZipCode AS clientZip,
      loc.LocationName AS facilityName, loc.Address1 AS facilityAddr, loc.City AS facilityCity,
      loc.State AS facilityState, loc.ZipCode AS facilityZip, loc.Phone AS facilityPhone,
      COALESCE(loc.OperatingCertificateNumber, loc.ProviderNumber) AS licenseNumber,
      (SELECT TOP 1 UDDescription FROM ${UDO} WHERE UDID = i.LocationofIncident) AS placeOfIncident,
      i.Descriptionofwhathappenedduringtheincident AS whatHappened,
      i.CreatedBy_ AS reportedBy, i.CreatedOn
    FROM ${INC} i ${CLIENT_JOIN}
    LEFT JOIN ${LOC} loc ON i.HomeFacility = loc.LocationID
    WHERE i.BSL_IncidentID = @id`, { id: parseInt(id, 10) });
  return rows[0] || null;
}

// ---- Rules engine -----------------------------------------------------------
// Rules are stored in the app's Cosmos; each condition maps to a SAFE, fixed SQL
// fragment (values always parameterized). A rule matches incidents where ALL its
// conditions hold. Catalog is closed — no arbitrary SQL from the client.
export const RULE_CONDITIONS = {
  severityContains: { label: 'Severity contains', value: 'text' },
  hasType: { label: 'Has incident type', value: 'text' },
  stateEquals: { label: 'State is', value: 'text' },
  facilityEquals: { label: 'Facility id is', value: 'int' },
  olderThanDays: { label: 'Incident older than (days)', value: 'int' },
  missingRootCause: { label: 'Missing Root Cause Analysis', value: 'none' },
  missingNotification: { label: 'Missing Notification log', value: 'none' },
  missingCorrectiveAction: { label: 'Missing Corrective Action Plan', value: 'none' }
};

function buildRuleWhere(conditions = []) {
  const parts = [], params = {};
  conditions.forEach((c, idx) => {
    const p = `@c${idx}`, key = `c${idx}`;
    switch (c.type) {
      case 'severityContains':
        parts.push(`(SELECT TOP 1 UDDescription FROM ${UDO} WHERE UDID = i.Severity) LIKE ${p}`); params[key] = `%${c.value}%`; break;
      case 'hasType':
        parts.push(`EXISTS (SELECT 1 FROM ${TYPE} t JOIN ${UDO} u ON t.TypeofIncident = u.UDID WHERE t.BSL_IncidentID = i.BSL_IncidentID AND u.UDDescription LIKE ${p})`); params[key] = `%${c.value}%`; break;
      case 'stateEquals':
        parts.push(`i.HomeFacility IN (SELECT LocationID FROM ${LOC} WHERE State = ${p})`); params[key] = c.value; break;
      case 'facilityEquals':
        parts.push(`i.HomeFacility = ${p}`); params[key] = parseInt(c.value, 10); break;
      case 'olderThanDays':
        parts.push(`DATEDIFF(day, i.DateofIncident, GETUTCDATE()) >= ${p}`); params[key] = parseInt(c.value, 10); break;
      case 'missingRootCause':
        parts.push(`NOT EXISTS (SELECT 1 FROM dbo.BSL_IncidentRootCauseAnalysis r WHERE r.BSL_IncidentID = i.BSL_IncidentID)`); break;
      case 'missingNotification':
        parts.push(`NOT EXISTS (SELECT 1 FROM dbo.BSL_IncidentNotificationLog n WHERE n.BSL_IncidentID = i.BSL_IncidentID)`); break;
      case 'missingCorrectiveAction':
        parts.push(`NOT EXISTS (SELECT 1 FROM dbo.BSL_IncidentCorrectiveActionPlan cap WHERE cap.BSL_IncidentID = i.BSL_IncidentID)`); break;
      default: break; // unknown condition types are ignored
    }
  });
  return { where: parts.length ? 'WHERE ' + parts.join(' AND ') : '', params };
}

export async function evaluateRule(rule) {
  const { where, params } = buildRuleWhere(rule.conditions || []);
  const rows = await c360Query(`SELECT TOP 200 i.BSL_IncidentID id, ${INCIDENT_DATE} date, ${INITIALS} client,
      sev.UDDescription severity, loc.LocationName facility
    FROM ${INC} i ${CLIENT_JOIN}
    LEFT JOIN ${UDO} sev ON i.Severity = sev.UDID
    LEFT JOIN ${LOC} loc ON i.HomeFacility = loc.LocationID
    ${where} ORDER BY i.DateofIncident DESC`, params);
  return { matchCount: rows.length, matches: rows.slice(0, 50) };
}

export async function getIncidentSubforms(id) {
  const iid = parseInt(id, 10);
  // Run every subform lookup concurrently (pooled) instead of one-at-a-time —
  // ~9 serial Fabric round-trips was the slow part of opening an incident.
  const jobs = SUBFORMS.map(async ([key, tbl]) => {
    const rows = await c360Query(`SELECT TOP 1 * FROM dbo.${tbl} WHERE BSL_IncidentID = @id`, { id: iid }).catch(() => []);
    return [key, rows[0] || null];
  });
  const witnessJob = c360Query(`SELECT * FROM dbo.BSLVA_IncidentWitnessInvestigation WHERE BSL_IncidentID = @id`, { id: iid }).catch(() => []);
  const [entries, witness] = await Promise.all([Promise.all(jobs), witnessJob]);
  const out = Object.fromEntries(entries);
  out.witness = witness;
  return out;
}
