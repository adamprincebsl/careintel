// Live, read-only lookup of a single identified client from c360 (PHI).
//
// This is the ONE sanctioned path that returns identifying client data. It is a
// PASS-THROUGH: read live from Fabric per request, hand to the authorized
// caller, never persist (no Cosmos, no cache, no logs of the values, no
// embeddings). See clients.js for the authorization + audit wrapper.
//
// ⚠️ ILLUSTRATIVE projection — column names match docs/c360-annotations.example.json.
// Finalize against the real c360 dictionary (C1) once the dump is reviewed.

import { c360Query } from './fabricC360.js';

// Minimum-necessary projection: name + program/location + enrollment dates.
// DOB and other identifiers are deliberately NOT selected — they aren't needed
// for the client detail surface, so they never leave c360.
export async function getClientById(clientId) {
  const rows = await c360Query(
    `SELECT TOP (1)
        ClientId, FirstName, LastName,
        ProgramId, State, AdmissionDate, DischargeDate
     FROM dbo.Client
     WHERE ClientId = @id`,
    { id: clientId }
  );
  return rows[0] || null;
}
