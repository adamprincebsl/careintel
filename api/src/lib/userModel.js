// User profile shape + validation, shared by the provisioning endpoint and the
// provisioning CLI so both write identical, valid docs to the `users` container.
//
// A user profile carries:
//   roles[]        — system role names (resolved to permissions via SYSTEM_ROLES)
//   permissions[]  — direct permission grants on top of roles
//   clientScope    — '*' (all) OR { programIds:[], states:[] }; controls which
//                    clients the user may view (client.viewInitials / viewDwLink).
//                    Fail-closed: absent/empty scope => no client access.

import { PERMISSIONS, SYSTEM_ROLES } from './permissions.js';

export function validateClientScope(scope) {
  if (scope === '*') return '*';
  if (scope == null) return { programIds: [], states: [] };
  if (typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error("clientScope must be '*' or { programIds:[], states:[] }");
  }
  const programIds = (scope.programIds || []).map(String);
  const states = (scope.states || []).map((s) => String(s).toUpperCase());
  return { programIds, states };
}

// validRoles: optional Set of allowed role names (system + custom). Defaults to
// system roles only — the CLI bootstrap path uses system roles; the admin
// endpoint passes the full set so custom roles are assignable.
export function validateRoles(roles = [], validRoles = null) {
  const allowed = validRoles || new Set(Object.keys(SYSTEM_ROLES));
  const bad = roles.filter((r) => !allowed.has(r));
  if (bad.length) throw new Error(`Unknown role(s): ${bad.join(', ')}`);
  return roles;
}

export function validatePermissions(permissions = []) {
  const bad = permissions.filter((p) => !PERMISSIONS[p]);
  if (bad.length) throw new Error(`Unknown permission(s): ${bad.join(', ')}`);
  return permissions;
}

/**
 * Build a validated user profile doc. `oid` is the Entra object id (= doc id).
 * `existing` (optional) is merged so a partial update keeps prior fields.
 */
export function buildUserDoc({ oid, name, email, roles, permissions, clientScope, existing = null, now, validRoles = null }) {
  if (!oid) throw new Error('oid is required');
  const merged = existing || {};
  const finalRoles = validateRoles(roles ?? merged.roles ?? [], validRoles);
  const finalPerms = validatePermissions(permissions ?? merged.permissions ?? []);
  const finalScope = clientScope !== undefined
    ? validateClientScope(clientScope)
    : (merged.clientScope ?? { programIds: [], states: [] });

  return {
    id: oid,
    pk: 'users',
    oid,
    name: name ?? merged.name ?? null,
    email: email ?? merged.email ?? null,
    roles: finalRoles,
    permissions: finalPerms,
    clientScope: finalScope,
    provisioned: finalRoles.length > 0 || finalPerms.length > 0,
    createdAt: merged.createdAt || now,
    updatedAt: now
  };
}
