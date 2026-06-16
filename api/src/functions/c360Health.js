// GET /api/internal/c360-health — admin-only connectivity check for the c360
// Fabric warehouse. Returns metadata only (db name, visible table count,
// latency) — NEVER client rows, so it's PHI-safe to expose to an admin.
//
// This is plan step C0: the canonical way to confirm the app's real query path
// (managed identity → Fabric) works from Azure once the MI has been granted
// Viewer on the workspace. Locally it runs through your `az login`.

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { c360Query } from '../lib/fabricC360.js';

app.http('c360Health', {
  methods: ['GET'],
  authLevel: 'anonymous', // SWA enforces auth at the edge; requireAdmin re-checks
  route: 'internal/c360-health',
  handler: async (request, context) => {
    await authorize(request, 'admin.manage');

    const t0 = Date.now();
    try {
      const rows = await c360Query(`
        SELECT DB_NAME() AS db,
               (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES) AS visibleTableCount`);
      return {
        status: 200,
        jsonBody: {
          ok: true,
          endpoint: process.env.FABRIC_C360_SQL_ENDPOINT || null,
          warehouse: process.env.FABRIC_C360_WAREHOUSE_NAME || null,
          latencyMs: Date.now() - t0,
          result: rows[0] || null
        }
      };
    } catch (err) {
      context.warn(`c360-health failed: ${err.message}`);
      return {
        status: 200,
        jsonBody: {
          ok: false,
          endpoint: process.env.FABRIC_C360_SQL_ENDPOINT || null,
          warehouse: process.env.FABRIC_C360_WAREHOUSE_NAME || null,
          latencyMs: Date.now() - t0,
          error: err.message,
          code: err.code || err.originalError?.code || null
        }
      };
    }
  }
});
