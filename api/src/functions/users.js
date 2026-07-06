// /api/users/me — resolve the signed-in principal into a BCI user profile.
//
// Pattern mirrors the cap app: SWA authenticates the user (Entra), the API
// decodes the principal, and we join it to a per-user profile doc in this app's
// own Cosmos `users` container (keyed by Entra OID). If no profile exists yet,
// we return a provisional one with no roles — the SPA shows an "Account not
// provisioned" panel until an admin assigns roles (admin UI is in PLAN.md).

import { app } from '@azure/functions';
import { requireAuth } from '../lib/auth.js';
import { repo } from '../lib/cosmos.js';
import { SYSTEM_ROLES } from '../lib/permissions.js';

app.http('usersMe', {
  methods: ['GET'],
  authLevel: 'anonymous', // SWA enforces auth at the edge; we still requireAuth() below
  route: 'users/me',
  handler: async (request) => {
    const principal = requireAuth(request);
    const users = repo('users');

    // Profile doc id = Entra OID (principal.userId). pk = 'users' (single
    // logical partition is fine for a small user table).
    let profile = await users.get(principal.userId, 'users');

    if (!profile) {
      profile = {
        id: principal.userId,
        pk: 'users',
        oid: principal.userId,
        name: principal.name,
        email: principal.name, // SWA userDetails is usually the email/UPN
        roles: [],             // unprovisioned — admin assigns roles
        permissions: [],
        provisioned: false,
        createdAt: new Date().toISOString()
      };
      // We do NOT auto-persist unprovisioned users here; admin provisioning
      // creates the durable record. Return the provisional shape so the SPA
      // can render the "not provisioned" state.
    } else {
      // Flatten role -> permission set so the SPA can gate on permissions.
      const perms = new Set();
      for (const r of profile.roles || []) {
        for (const p of SYSTEM_ROLES[r] || []) perms.add(p);
      }
      for (const p of profile.permissions || []) perms.add(p);
      profile.effectivePermissions = [...perms];
    }

    return { status: 200, jsonBody: profile };
  }
});

// PUT /api/users/me/preferences — persist per-user UI preferences (e.g. table
// columns + sort) on the profile doc so they follow the user across browsers.
// Body is a shallow patch merged under profile.preferences (per-view keys).
const PREF_KEYS = new Set(['incidents', 'marketDoc', 'residential']);

app.http('usersMePreferences', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'users/me/preferences',
  handler: async (request) => {
    const principal = requireAuth(request);
    const patch = await request.json().catch(() => null);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { status: 400, jsonBody: { error: 'preferences must be an object' } };
    }
    if (JSON.stringify(patch).length > 8000) {
      return { status: 413, jsonBody: { error: 'preferences too large' } };
    }
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => PREF_KEYS.has(k)));

    const users = repo('users');
    const profile = await users.get(principal.userId, 'users');
    if (!profile) return { status: 404, jsonBody: { error: 'no profile to update' } };

    profile.preferences = { ...(profile.preferences || {}), ...clean };
    profile.updatedAt = new Date().toISOString();
    const saved = await users.upsert(profile);
    return { status: 200, jsonBody: { preferences: saved.preferences } };
  }
});
