// GET /api/c360/metrics            — list available rollup keys + whether each
//                                     has a snapshot yet.
// GET /api/c360/metrics?key=<key>  — latest de-identified snapshot for a rollup.
//
// Reads only the PHI-free `c360Snapshots` materialized by the nightly timer
// (plan step C2). Gated on `report.view`.

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { repo } from '../lib/cosmos.js';
import { ROLLUPS } from '../lib/c360Rollups.js';

app.http('c360Metrics', {
  methods: ['GET'],
  authLevel: 'anonymous', // SWA enforces auth at the edge; authorize re-checks
  route: 'c360/metrics',
  handler: async (request) => {
    await authorize(request, 'report.view');
    const key = request.query.get('key');
    const snapshots = repo('c360Snapshots');

    if (!key) {
      // Which rollups exist, and which have at least one snapshot.
      const present = await snapshots.list({
        query: 'SELECT DISTINCT VALUE c.rollupKey FROM c'
      });
      const have = new Set(present);
      return {
        status: 200,
        jsonBody: {
          available: ROLLUPS.map((r) => ({
            key: r.key,
            grain: r.grain,
            hasSnapshot: have.has(r.key)
          }))
        }
      };
    }

    // Latest snapshot for one rollup (partition = rollupKey).
    const rows = await snapshots.list({
      query: 'SELECT TOP 1 * FROM c WHERE c.rollupKey = @k ORDER BY c.asOf DESC',
      parameters: [{ name: '@k', value: key }]
    });
    return { status: 200, jsonBody: { snapshot: rows[0] || null } };
  }
});
