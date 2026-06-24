// Client-centric view: documentation rolled up per day (with total time) +
// residential / day-program census. PHI (named client) — caller gates + audits.
import { c360Query } from './fabricC360.js';

const RES = 'dbo.BSL_ResidentialServiceNote';
const DAY = 'dbo.BSL_ServiceNoteDayHabilitation';

export async function getClientDocumentation(clientId) {
  const cid = parseInt(clientId, 10);

  const client = (await c360Query(
    `SELECT TOP 1 ClientID, FirstName, LastName, BirthDate FROM dbo.c_Client WHERE ClientID = @cid`,
    { cid }).catch(() => []))[0] || null;

  // Census: residential / day / life-sharing enrollments (CaseID = ClientID).
  const census = await c360Query(`SELECT pt.ProgramType programType, pr.Program program,
      cp.IsActive isActive, CAST(cp.AdmitDate AS date) admitDate, CAST(cp.DischargeTime AS date) dischargeDate
    FROM dbo.c_ClientProgram cp
    LEFT JOIN dbo.s_Program pr ON cp.ProgramID = pr.ProgramID
    LEFT JOIN dbo.s_ProgramType pt ON pr.ProgramTypeID = pt.ProgramTypeID
    WHERE cp.CaseID = @cid AND pt.ProgramType IN ('Residential','Day Program','Life Sharing')
    ORDER BY cp.IsActive DESC, cp.AdmitDate DESC`, { cid }).catch(() => []);

  // Residential documentation per day (Duration is minutes).
  const residentialByDay = await c360Query(`SELECT CAST(COALESCE(ServiceStartTime, ServiceDate) AS date) day,
      COUNT(*) notes, SUM(ISNULL(Duration,0)) minutes
    FROM ${RES} WHERE ClientID = @cid
    GROUP BY CAST(COALESCE(ServiceStartTime, ServiceDate) AS date) ORDER BY day DESC`, { cid }).catch(() => []);

  // Day-hab documentation per day (minutes = end - start).
  const dayByDay = await c360Query(`SELECT CAST(ServiceStart AS date) day,
      COUNT(*) notes, SUM(DATEDIFF(MINUTE, ServiceStart, ServiceEnd)) minutes
    FROM ${DAY} WHERE ClientID = @cid AND ServiceStart IS NOT NULL
    GROUP BY CAST(ServiceStart AS date) ORDER BY day DESC`, { cid }).catch(() => []);

  return { client, census, residentialByDay, dayByDay };
}
