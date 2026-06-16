// GET /api/clients/{id} — identified client detail (PHI), live from c360.
//
// The PHI display path. Hard rules enforced here:
//   1. Permission: caller must hold `client.viewPii`.
//   2. Location scope: caller sees a client only if that client's program/state
//      is in their scope (clientInScope). Fail closed.
//   3. Pass-through: read live from c360, return, NEVER persist the values.
//      Response is marked no-store so browsers/proxies don't cache PHI.
//   4. Audit: every attempt (granted, denied, not-found) writes a PHI-FREE row
//      to `accessLog` — who / when / whichClientId / outcome. The audit stores
//      the client *id* (required for HIPAA access logging), never the name.
//
// Only completes from Azure (live Fabric query). Locally it returns the c360
// connectivity error, which is expected off-network.

import { app } from '@azure/functions';
import { authorize, resolveClientScope, clientInScope } from '../lib/authz.js';
import { repo } from '../lib/cosmos.js';
import { getClientById } from '../lib/clientLookup.js';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };

async function audit(principal, clientId, outcome) {
  try {
    const at = new Date().toISOString();
    await repo('accessLog').upsert({
      id: `${principal.userId}_${clientId}_${at}`,
      pk: 'accessLog',
      userOid: principal.userId,
      action: 'view-client-pii',
      clientId: String(clientId),
      outcome,            // 'granted' | 'denied-scope' | 'not-found'
      at
    });
  } catch { /* never let audit failure block or leak — but log upstream */ }
}

app.http('clients', {
  methods: ['GET'],
  authLevel: 'anonymous', // SWA enforces auth at the edge; authorize re-checks
  route: 'clients/{id}',
  handler: async (request, context) => {
    const { principal, profile } = await authorize(request, 'client.viewPii');
    const clientId = request.params.id;

    let client;
    try {
      client = await getClientById(clientId);
    } catch (err) {
      context.warn(`clients/{id} c360 read failed: ${err.message}`);
      return { status: 502, headers: NO_STORE, jsonBody: { error: 'c360 unavailable', detail: err.message } };
    }

    if (!client) {
      await audit(principal, clientId, 'not-found');
      return { status: 404, headers: NO_STORE, jsonBody: { error: 'client not found' } };
    }

    const scope = resolveClientScope(profile);
    if (!clientInScope(scope, client)) {
      await audit(principal, clientId, 'denied-scope');
      return { status: 403, headers: NO_STORE, jsonBody: { error: 'client outside your location scope' } };
    }

    await audit(principal, clientId, 'granted');
    // Pass-through: returned to the authorized caller, never persisted.
    return { status: 200, headers: NO_STORE, jsonBody: { client } };
  }
});
