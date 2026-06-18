// GET /api/admin/audit — recent admin/config audit rows (Phase 6 item 4).
// Gated on `admin.manage`. Returns the latest 100 entries, newest first.

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { repo } from '../lib/cosmos.js';

app.http('adminAudit', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'admin/audit',
  handler: async (request) => {
    await authorize(request, 'admin.manage');
    const rows = await repo('auditLog').list({
      query: "SELECT TOP 100 c.id, c.action, c.targetId, c.actorOid, c.actorName, c.summary, c.at FROM c WHERE c.pk = 'auditLog' ORDER BY c.at DESC"
    });
    return { status: 200, jsonBody: { entries: rows } };
  }
});
