// Roles — system (code-defined, read-only) + custom (admin-defined, stored in
// the `roles` Cosmos container). Phase 6 item 2.
//
// A custom role is { name, description, permissions[] }. Resolution (in
// authz.getEffectivePermissions) merges system + custom so a user holding either
// kind gets the union of their permissions. Custom role names can't collide with
// system role names.

import { repo } from './cosmos.js';
import { PERMISSIONS, SYSTEM_ROLES } from './permissions.js';

const NAME_RE = /^[A-Za-z0-9_]{2,40}$/;

export async function getCustomRoles() {
  return repo('roles').list({ query: "SELECT * FROM c WHERE c.pk = 'roles'" });
}

/**
 * Merged role map: name -> { permissions[], system, description }.
 * System roles first, then custom (custom can't overwrite a system name — the
 * write path rejects that, so there's no collision here).
 */
export async function getRoleMap() {
  const map = {};
  for (const [name, permissions] of Object.entries(SYSTEM_ROLES)) {
    map[name] = { name, permissions, system: true, description: '' };
  }
  for (const r of await getCustomRoles()) {
    map[r.name] = { name: r.name, permissions: r.permissions || [], system: false, description: r.description || '' };
  }
  return map;
}

/** Build + validate a custom role doc. */
export function buildRoleDoc({ name, description, permissions, now }) {
  if (!NAME_RE.test(name || '')) throw new Error('role name must be 2–40 chars [A-Za-z0-9_]');
  if (SYSTEM_ROLES[name]) throw new Error(`"${name}" is a system role — pick a different name`);
  const bad = (permissions || []).filter((p) => !PERMISSIONS[p]);
  if (bad.length) throw new Error(`Unknown permission(s): ${bad.join(', ')}`);
  return {
    id: name,
    pk: 'roles',
    name,
    description: description || '',
    permissions: permissions || [],
    system: false,
    updatedAt: now
  };
}
