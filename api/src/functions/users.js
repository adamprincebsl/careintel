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
