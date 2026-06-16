// Request authorization helper — resolves the caller's effective permissions
// from their BCI profile (roles → permissions, plus any direct grants) and
// enforces one. Used by endpoints that need a specific permission beyond the
// SWA edge's "authenticated" gate. Keeps the role→permission join in one place.

import { requireAuth } from './auth.js';
import { repo } from './cosmos.js';
import { SYSTEM_ROLES } from './permissions.js';

/** Resolve { profile, permissions[] } for an authenticated principal. */
export async function getEffectivePermissions(principal) {
  const profile = await repo('users').get(principal.userId, 'users');
  const perms = new Set(profile?.permissions || []);
  for (const r of profile?.roles || []) for (const p of SYSTEM_ROLES[r] || []) perms.add(p);
  return { profile, permissions: [...perms] };
}

/**
 * Require auth + a specific permission. Throws 401 if unauthenticated, 403 if
 * the permission is missing. Returns { principal, profile, permissions }.
 */
export async function authorize(request, perm) {
  const principal = requireAuth(request);
  const { profile, permissions } = await getEffectivePermissions(principal);
  if (!permissions.includes(perm)) {
    const err = new Error(`Forbidden — permission "${perm}" required`);
    err.statusCode = 403;
    throw err;
  }
  return { principal, profile, permissions };
}

// ---- Location scope (two-axis authz: permission × location) ---------------
// Mirrors the cap app's resolveAllowedLocations. A user's profile carries
// `clientScope`: either '*' (all) or { programIds:[], states:[] }. Fail closed
// — a profile with no scope sees no identified clients.

export function resolveClientScope(profile) {
  const s = profile?.clientScope;
  if (s === '*') return '*';
  return {
    programIds: new Set((s?.programIds || []).map(String)),
    states: new Set((s?.states || []).map((x) => String(x).toUpperCase()))
  };
}

/** Is a c360 client row within the caller's scope? */
export function clientInScope(scope, client) {
  if (scope === '*') return true;
  if (client?.ProgramId != null && scope.programIds.has(String(client.ProgramId))) return true;
  if (client?.State && scope.states.has(String(client.State).toUpperCase())) return true;
  return false;
}
