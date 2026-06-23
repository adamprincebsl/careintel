// Incident reporting views over c360 `BSL_Incident` (the initial incident report).
// Consolidated report; type comes from the child table BSL_Incident_TypeofIncident
// (one incident -> many types). De-identified list + identified detail (PHI narrative).
// Client linkage (IndividualServedsName) is unresolved — shown as a raw ref for now.
import { c360Query } from './fabricC360.js';

const INC = 'dbo.BSL_Incident';
const TYPE = 'dbo.BSL_Incident_TypeofIncident';
const UDO = 'dbo.s_UserDefinedOptions';
const LOC = 'dbo.s_Locations';

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
  return { clause: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
}

export async function incidentFilterOptions() {
  const m = (r) => ({ id: r.id, name: r.name || String(r.id) });
  const types = await c360Query(`SELECT DISTINCT t.TypeofIncident id, u.UDDescription name
    FROM ${TYPE} t JOIN ${UDO} u ON t.TypeofIncident = u.UDID ORDER BY u.UDDescription`).catch(() => []);
  const severities = await c360Query(`SELECT DISTINCT i.Severity id, u.UDDescription name
    FROM ${INC} i JOIN ${UDO} u ON i.Severity = u.UDID ORDER BY u.UDDescription`).catch(() => []);
  const facilities = await c360Query(`SELECT DISTINCT i.HomeFacility id, loc.LocationName name
    FROM ${INC} i LEFT JOIN ${LOC} loc ON i.HomeFacility = loc.LocationID
    WHERE i.HomeFacility IS NOT NULL ORDER BY loc.LocationName`).catch(() => []);
  return { types: types.map(m), severities: severities.map(m), facilities: facilities.map(m) };
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
  return out;
}

// De-identified list (no narrative, no client identity) — reporting.
export async function queryIncidentsStructured(f = {}) {
  const { clause, params } = buildWhere(f);
  const top = Math.min(parseInt(f.top, 10) || 200, 1000);
  return c360Query(`SELECT TOP ${top}
    i.BSL_IncidentID AS IncidentId,
    ${INCIDENT_DATE} AS IncidentDate,
    ${TYPES_AGG} AS IncidentTypes,
    sev.UDDescription AS Severity,
    pl.UDDescription AS PlaceOfIncident,
    loc.LocationName AS Facility, loc.State AS State,
    CASE WHEN ISNULL(i.AbuseNeglect,0)=1 THEN 'Yes' ELSE 'No' END AS AbuseNeglect
    FROM ${INC} i
    LEFT JOIN ${UDO} sev ON i.Severity = sev.UDID
    LEFT JOIN ${UDO} pl ON i.LocationofIncident = pl.UDID
    LEFT JOIN ${LOC} loc ON i.HomeFacility = loc.LocationID
    ${clause}
    ORDER BY i.DateofIncident DESC`, params);
}

// Identified detail (PHI narrative). Caller gates note.viewPhi + audits.
export async function getIncidentIdentified(id) {
  const rows = await c360Query(`SELECT TOP 1
    i.BSL_IncidentID AS IncidentId, ${INCIDENT_DATE} AS IncidentDate, i.TimeofIncident,
    ${TYPES_AGG} AS IncidentTypes,
    sev.UDDescription AS Severity, pl.UDDescription AS PlaceOfIncident, i.OtherLocation,
    loc.LocationName AS Facility, loc.State AS State,
    i.IndividualServedsName AS IndividualRef,
    i.Descriptionofwhathappenedduringtheincident AS WhatHappened,
    i.Descriptionofwheretheincidentoccurred AS WhereOccurred,
    i.Descriptionofwhentheincidentoccurred AS WhenOccurred,
    i.Descriptionofwhytheincidentoccurred AS WhyOccurred,
    i.Descriptionofhowtheincidentoccurred AS HowOccurred,
    i.Was911called_ AS Was911Called, i.RecommendationsfromtheTeam AS TeamRecommendations,
    i.BloodPressure, i.Temperature, i.HeartRate, i.Respirations, i.BloodSugar,
    i.CreatedBy_ AS ReportedBy, i.CreatedOn, i.LastModifiedOn
    FROM ${INC} i
    LEFT JOIN ${UDO} sev ON i.Severity = sev.UDID
    LEFT JOIN ${UDO} pl ON i.LocationofIncident = pl.UDID
    LEFT JOIN ${LOC} loc ON i.HomeFacility = loc.LocationID
    WHERE i.BSL_IncidentID = @id`, { id: parseInt(id, 10) });
  return rows[0] || null;
}
