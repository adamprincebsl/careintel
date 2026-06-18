// Admin user provisioning (subset of the C6 admin module).
//
//   GET    /api/admin/users            — list provisioned users
//   GET    /api/admin/users/{oid}      — one user
//   PUT    /api/admin/users/{oid}      — create/update: roles, permissions, clientScope
//
// All gated on `admin.manage`. This is how a user gets `client.viewPii` AND a
// `clientScope`, which together unlock the client-detail path (clients.js).
//
// Note: a user's Entra OID is the doc id. The admin supplies it (find it in the
// Entra portal, or from the user's /api/users/me while unprovisioned).

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { repo } from '../lib/cosmos.js';
import { buildUserDoc } from '../lib/userModel.js';
import { SYSTEM_ROLES } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';

app.http('adminUsersList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'admin/users',
  handler: async (request) => {
    await authorize(request, 'admin.manage');
    const users = await repo('users').list({ query: "SELECT * FROM c WHERE c.pk = 'users'" });
    return { status: 200, jsonBody: { users, roleCatalog: Object.keys(SYSTEM_ROLES) } };
  }
});

app.http('adminUserGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'admin/users/{oid}',
  handler: async (request) => {
    await authorize(request, 'admin.manage');
    const user = await repo('users').get(request.params.oid, 'users');
    return user
      ? { status: 200, jsonBody: user }
      : { status: 404, jsonBody: { error: 'user not found' } };
  }
});

app.http('adminUserPut', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'admin/users/{oid}',
  handler: async (request, context) => {
    const { principal } = await authorize(request, 'admin.manage');
    const oid = request.params.oid;
    const body = await request.json().catch(() => ({}));
    const users = repo('users');

    try {
      const existing = await users.get(oid, 'users');
      const doc = buildUserDoc({
        oid,
        name: body.name,
        email: body.email,
        roles: body.roles,
        permissions: body.permissions,
        clientScope: body.clientScope,
        existing,
        now: new Date().toISOString()
      });
      const saved = await users.upsert(doc);
      await writeAudit({
        actor: principal,
        action: existing ? 'user.update' : 'user.provision',
        targetId: oid,
        before: existing,
        after: saved,
        summary: `roles=[${saved.roles}] perms=[${saved.permissions}]`,
        logger: context
      });
      return { status: 200, jsonBody: saved };
    } catch (err) {
      return { status: 400, jsonBody: { error: err.message } };
    }
  }
});
