// Live, read-only client lookup from a c360 **view** (not base tables).
//
// The app is INITIALS-ONLY: we read the minimum columns from the data-team's
// curated view, compute initials in flight, and return ONLY initials + program/
// location context. Full name / DOB are never returned, never cached, never
// persisted. The full identified record is reached separately via an approved
// link-back to the DW (see functions/clients.js dw-link).
//
// Source view is configurable so the data team controls exactly what's exposed:
//   FABRIC_C360_CLIENT_VIEW   e.g. dbo.vw_ClientDirectory  (default dbo.vw_Client)
// Ideally the view itself exposes only what we need (or an Initials column); if
// it returns FirstName/LastName we reduce them to initials here and drop them.

import { c360Query } from './fabricC360.js';

const CLIENT_VIEW = () => process.env.FABRIC_C360_CLIENT_VIEW || 'dbo.vw_Client';

export function toInitials(first, last) {
  const ch = (s) => (s || '').trim().charAt(0).toUpperCase();
  const parts = [ch(first), ch(last)].filter(Boolean);
  return parts.length ? parts.map((c) => `${c}.`).join('') : '—';
}

/**
 * Returns a de-identified display object for a client, or null if not found:
 *   { clientId, initials, programId, state, admissionDate, dischargeDate }
 * FirstName/LastName are read only to derive initials and are then discarded.
 */
export async function getClientForDisplay(clientId) {
  const rows = await c360Query(
    `SELECT TOP (1)
        ClientId, FirstName, LastName, ProgramId, State, AdmissionDate, DischargeDate
     FROM ${CLIENT_VIEW()}
     WHERE ClientId = @id`,
    { id: clientId }
  );
  const r = rows[0];
  if (!r) return null;
  return {
    clientId: r.ClientId,
    initials: toInitials(r.FirstName, r.LastName),
    programId: r.ProgramId ?? null,
    state: r.State ?? null,
    admissionDate: r.AdmissionDate ?? null,
    dischargeDate: r.DischargeDate ?? null
  };
}
