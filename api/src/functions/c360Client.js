// Client documentation + census view. PHI (named client) — gated note.viewPhi + audited.
//   GET /api/c360/client/{id}/documentation
import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { logAccess } from '../lib/audit.js';
import { getClientDocumentation } from '../lib/clientViews.js';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };

app.http('clientDocumentation', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/client/{id}/documentation',
  handler: async (request, context) => {
    const { principal } = await authorize(request, 'note.viewPhi');
    const id = request.params.id;
    let data;
    try { data = await getClientDocumentation(id); }
    catch (err) { return { status: 502, headers: NO_STORE, jsonBody: { error: 'c360 unavailable', detail: err.message } }; }
    try { await logAccess({ actor: principal, action: 'view-client-documentation', clientId: id, outcome: 'granted' }); }
    catch (err) { context.error(`client-doc access log failed: ${err.message}`); return { status: 503, headers: NO_STORE, jsonBody: { error: 'unable to record access; not served' } }; }
    return { status: 200, headers: NO_STORE, jsonBody: data };
  }
});
