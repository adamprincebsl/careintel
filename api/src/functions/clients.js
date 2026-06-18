// Client endpoints — initials-only in-app, full record via approved DW link-back.
//
//   GET  /api/clients/{id}          — de-identified: initials + program context.
//                                     Gated `client.viewInitials` + location scope.
//   POST /api/clients/{id}/dw-link  — returns the approved deep-link to the full
//                                     record in the DW. Gated `client.viewDwLink`
//                                     + location scope. Following it is audited;
//                                     the DW enforces its own access on top.
//
// Hard rules: read live from a c360 VIEW, return only initials + context, never
// persist identifying values, response no-store, every call audited to accessLog.

import { app } from '@azure/functions';
import { authorize, resolveClientScope, clientInScope } from '../lib/authz.js';
import { repo } from '../lib/cosmos.js';
import { getClientForDisplay } from '../lib/clientLookup.js';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };

async function audit(principal, clientId, action, outcome) {
  try {
    const at = new Date().toISOString();
    await repo('accessLog').upsert({
      id: `${principal.userId}_${clientId}_${action}_${at}`,
      pk: 'accessLog', userOid: principal.userId, action,
      clientId: String(clientId), outcome, at
    });
  } catch { /* best-effort */ }
}

// Shared: resolve client + enforce scope. Returns { client } or an error response.
async function loadScoped(request, perm, action) {
  const { principal, profile } = await authorize(request, perm);
  const clientId = request.params.id;
  let client;
  try {
    client = await getClientForDisplay(clientId);
  } catch (err) {
    return { err: { status: 502, headers: NO_STORE, jsonBody: { error: 'c360 unavailable', detail: err.message } } };
  }
  if (!client) {
    await audit(principal, clientId, action, 'not-found');
    return { err: { status: 404, headers: NO_STORE, jsonBody: { error: 'client not found' } } };
  }
  const scope = resolveClientScope(profile);
  if (!clientInScope(scope, { ProgramId: client.programId, State: client.state })) {
    await audit(principal, clientId, action, 'denied-scope');
    return { err: { status: 403, headers: NO_STORE, jsonBody: { error: 'client outside your location scope' } } };
  }
  return { principal, clientId, client };
}

app.http('clientGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'clients/{id}',
  handler: async (request) => {
    const r = await loadScoped(request, 'client.viewInitials', 'view-initials');
    if (r.err) return r.err;
    await audit(r.principal, r.clientId, 'view-initials', 'granted');
    return {
      status: 200,
      headers: NO_STORE,
      jsonBody: { client: r.client, hasDwLink: !!process.env.C360_DW_LINK_TEMPLATE }
    };
  }
});

app.http('clientDwLink', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'clients/{id}/dw-link',
  handler: async (request) => {
    const r = await loadScoped(request, 'client.viewDwLink', 'dw-link-followed');
    if (r.err) return r.err;
    const template = process.env.C360_DW_LINK_TEMPLATE;
    if (!template) {
      return { status: 404, headers: NO_STORE, jsonBody: { error: 'DW link-back not configured' } };
    }
    await audit(r.principal, r.clientId, 'dw-link-followed', 'granted');
    const url = template.replace('{clientId}', encodeURIComponent(r.clientId));
    return { status: 200, headers: NO_STORE, jsonBody: { url } };
  }
});
