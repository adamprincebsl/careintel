// Enhanced staffing coverage endpoints over BSL_EnhancedStaffingNote.
//   GET /api/c360/enhanced/options                     — state + facility dropdowns
//   GET /api/c360/enhanced/roster?state&facility&from&to  — per-client coverage (PHI)
//   GET /api/c360/enhanced/client/{id}?…               — per-day 24h depth + notes (PHI)
// Named clients -> gated note.viewPhi + fail-closed audit + no-store.

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { logAccess } from '../lib/audit.js';
import { enhancedOptions, enhancedRoster, enhancedClientDetail } from '../lib/enhancedStaffingViews.js';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };
const paramsFrom = (q) => ({ state: q.get('state') ?? undefined, facility: q.get('facility') || undefined, from: q.get('from') ?? undefined, to: q.get('to') ?? undefined });
const fail = (context, err) => { context.warn(`enhanced-staffing failed: ${err.message}`); return { status: 502, headers: NO_STORE, jsonBody: { error: 'c360 unavailable', detail: err.message } }; };

app.http('enhancedOptions', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/enhanced/options',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    try { return { status: 200, headers: NO_STORE, jsonBody: await enhancedOptions() }; }
    catch (err) { return fail(context, err); }
  }
});

app.http('enhancedRoster', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/enhanced/roster',
  handler: async (request, context) => {
    const { principal } = await authorize(request, 'note.viewPhi');
    const p = paramsFrom(request.query);
    if (!p.state) return { status: 400, headers: NO_STORE, jsonBody: { error: 'state is required' } };
    let data;
    try { data = await enhancedRoster(p); } catch (err) { return fail(context, err); }
    try { await logAccess({ actor: principal, action: 'view-enhanced-roster', clientId: `state:${p.state}`, outcome: 'granted' }); }
    catch (err) { context.error(`enhanced audit failed: ${err.message}`); return { status: 503, headers: NO_STORE, jsonBody: { error: 'unable to record access; not served' } }; }
    return { status: 200, headers: NO_STORE, jsonBody: data };
  }
});

app.http('enhancedClient', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/enhanced/client/{id}',
  handler: async (request, context) => {
    const { principal } = await authorize(request, 'note.viewPhi');
    const id = request.params.id;
    let data;
    try { data = await enhancedClientDetail({ clientId: id, ...paramsFrom(request.query) }); } catch (err) { return fail(context, err); }
    try { await logAccess({ actor: principal, action: 'view-enhanced-client', clientId: id, outcome: 'granted' }); }
    catch (err) { context.error(`enhanced audit failed: ${err.message}`); return { status: 503, headers: NO_STORE, jsonBody: { error: 'unable to record access; not served' } }; }
    return { status: 200, headers: NO_STORE, jsonBody: data };
  }
});
