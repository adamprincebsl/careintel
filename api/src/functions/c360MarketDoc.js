// Market documentation completion endpoints over c360 residential/day-hab notes.
//   GET /api/c360/market-doc/options                        — market dropdown
//   GET /api/c360/market-doc/roster?market&from&to          — per-client completion (PHI)
//   GET /api/c360/market-doc/client/{id}?market&from&to     — per-day detail + incomplete times (PHI)
// Roster/detail show named clients → gated note.viewPhi + fail-closed audit + no-store.

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { logAccess } from '../lib/audit.js';
import { marketOptions, marketDocRoster, marketClientDetail } from '../lib/marketViews.js';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };
const paramsFrom = (q) => ({ state: q.get('state') ?? undefined, from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, facility: q.get('facility') || undefined });
const c360Fail = (context, err) => { context.warn(`market-doc failed: ${err.message}`); return { status: 502, headers: NO_STORE, jsonBody: { error: 'c360 unavailable', detail: err.message } }; };

app.http('marketDocOptions', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/market-doc/options',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    try { return { status: 200, headers: NO_STORE, jsonBody: await marketOptions() }; }
    catch (err) { return c360Fail(context, err); }
  }
});

app.http('marketDocRoster', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/market-doc/roster',
  handler: async (request, context) => {
    const { principal } = await authorize(request, 'note.viewPhi');
    const p = paramsFrom(request.query);
    if (!p.state) return { status: 400, headers: NO_STORE, jsonBody: { error: 'state is required' } };
    let data;
    try { data = await marketDocRoster(p); } catch (err) { return c360Fail(context, err); }
    try { await logAccess({ actor: principal, action: 'view-market-doc-roster', clientId: `state:${p.state}`, outcome: 'granted' }); }
    catch (err) { context.error(`market-doc audit failed: ${err.message}`); return { status: 503, headers: NO_STORE, jsonBody: { error: 'unable to record access; not served' } }; }
    return { status: 200, headers: NO_STORE, jsonBody: data };
  }
});

app.http('marketDocClient', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/market-doc/client/{id}',
  handler: async (request, context) => {
    const { principal } = await authorize(request, 'note.viewPhi');
    const id = request.params.id;
    let data;
    try { data = await marketClientDetail({ clientId: id, ...paramsFrom(request.query) }); } catch (err) { return c360Fail(context, err); }
    try { await logAccess({ actor: principal, action: 'view-market-doc-client', clientId: id, outcome: 'granted' }); }
    catch (err) { context.error(`market-doc audit failed: ${err.message}`); return { status: 503, headers: NO_STORE, jsonBody: { error: 'unable to record access; not served' } }; }
    return { status: 200, headers: NO_STORE, jsonBody: data };
  }
});
