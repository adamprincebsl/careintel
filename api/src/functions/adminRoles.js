// Custom role management (Phase 6 item 2).
//
//   GET    /api/admin/roles         — system + custom roles (with permissions)
//   PUT    /api/admin/roles/{name}  — create/update a custom role
//   DELETE /api/admin/roles/{name}  — delete a custom role
//
// All gated on `admin.manage`. System roles are read-only (the write/delete
// paths reject system names). Mutations are audited.

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { repo } from '../lib/cosmos.js';
import { getRoleMap, buildRoleDoc } from '../lib/roles.js';
import { PERMISSIONS, SYSTEM_ROLES } from '../lib/permissions.js';
import { writeAudit } from '../lib/audit.js';

app.http('adminRolesList', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'admin/roles',
  handler: async (request) => {
    await authorize(request, 'admin.manage');
    const map = await getRoleMap();
    return {
      status: 200,
      jsonBody: { roles: Object.values(map), permissionCatalog: PERMISSIONS }
    };
  }
});

app.http('adminRolePut', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'admin/roles/{name}',
  handler: async (request, context) => {
    const { principal } = await authorize(request, 'admin.manage');
    const name = request.params.name;
    const body = await request.json().catch(() => ({}));
    const roles = repo('roles');
    try {
      const existing = await roles.get(name, 'roles');
      const doc = buildRoleDoc({
        name,
        description: body.description,
        permissions: body.permissions,
        now: new Date().toISOString()
      });
      const saved = await roles.upsert(doc);
      await writeAudit({
        actor: principal,
        action: existing ? 'role.update' : 'role.create',
        targetId: name,
        before: existing,
        after: saved,
        summary: `permissions=[${saved.permissions}]`,
        logger: context
      });
      return { status: 200, jsonBody: saved };
    } catch (err) {
      return { status: 400, jsonBody: { error: err.message } };
    }
  }
});

app.http('adminRoleDelete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'admin/roles/{name}',
  handler: async (request, context) => {
    const { principal } = await authorize(request, 'admin.manage');
    const name = request.params.name;
    if (SYSTEM_ROLES[name]) {
      return { status: 400, jsonBody: { error: `"${name}" is a system role and cannot be deleted` } };
    }
    const roles = repo('roles');
    const existing = await roles.get(name, 'roles');
    if (!existing) return { status: 404, jsonBody: { error: 'role not found' } };
    await roles.delete(name, 'roles');
    await writeAudit({ actor: principal, action: 'role.delete', targetId: name, before: existing, logger: context });
    return { status: 200, jsonBody: { deleted: name } };
  }
});
