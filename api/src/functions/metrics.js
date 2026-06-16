// /api/metrics/overview — the first reporting endpoint. Reads the cap app's
// core data READ-ONLY and returns the KPI roll-ups the dashboard renders.
//
// This is intentionally a thin, real example of the read-only reporting pattern
// (capData.js → aggregate → JSON). The full report catalog (by-state, by-
// severity, aging, risk heatmap, audit pass-rate, etc.) is enumerated in
// PLAN.md; they all follow this same shape.
//
// In local/mock mode with no cap Cosmos reachable, capData throws and we return
// a small deterministic sample so the SPA renders during early development.

import { app } from '@azure/functions';
import { requireAuth } from '../lib/auth.js';
import { listCaps, listRisks, listLocations } from '../lib/capData.js';

const SAMPLE = {
  source: 'sample',
  caps: { total: 42, open: 18, pendingVerification: 6, closed: 18, overdue: 4 },
  risks: { total: 27, severe: 3, high: 8, outOfTolerance: 5 },
  programs: { total: 528, states: 8 },
  generatedAt: new Date().toISOString()
};

app.http('metricsOverview', {
  methods: ['GET'],
  authLevel: 'anonymous', // SWA enforces auth at the edge
  route: 'metrics/overview',
  handler: async (request, context) => {
    requireAuth(request);

    try {
      const [caps, risks, locations] = await Promise.all([
        listCaps(),
        listRisks(),
        listLocations()
      ]);

      const open = caps.filter((c) => ['Open', 'In Progress'].includes(c.status)).length;
      const pendingVerification = caps.filter((c) => c.status === 'Pending Verification').length;
      const closed = caps.filter((c) => c.status === 'Closed').length;
      const now = Date.now();
      const overdue = caps.filter((c) =>
        c.status !== 'Closed' && c.targetCloseDate && Date.parse(c.targetCloseDate) < now).length;

      const score = (r) => (r.residualLikelihood || 0) * (r.residualImpact || 0);
      const severe = risks.filter((r) => score(r) >= 16).length;
      const high = risks.filter((r) => { const s = score(r); return s >= 10 && s < 16; }).length;

      const states = new Set(locations.map((l) => l.state).filter(Boolean));

      return {
        status: 200,
        jsonBody: {
          source: 'live',
          caps: { total: caps.length, open, pendingVerification, closed, overdue },
          risks: { total: risks.length, severe, high, outOfTolerance: null },
          programs: { total: locations.length, states: states.size },
          generatedAt: new Date().toISOString()
        }
      };
    } catch (err) {
      context.warn(`metrics/overview falling back to sample: ${err.message}`);
      return { status: 200, jsonBody: SAMPLE };
    }
  }
});
