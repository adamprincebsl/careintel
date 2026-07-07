// Incident reporting endpoints over c360 BSL_Incident.
//   GET /api/c360/incidents/options              — filter dropdowns (type/severity/facility)
//   GET /api/c360/incidents/metrics?…filters…     — counts by type/severity/month/place
//   GET /api/c360/incidents/list?…filters…        — de-identified incident list
//   GET /api/c360/incidents/{id}/full            — identified incident (PHI narrative)
// Filters: from, to, type, severity, facility, top. List/metrics gated report.view.

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { logAccess } from '../lib/audit.js';
import {
  incidentFilterOptions, incidentMetrics, queryIncidentsStructured, getIncidentIdentified,
  getIncidentSubforms
} from '../lib/incidentViews.js';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };
const filtersFrom = (q) => ({
  from: q.get('from') ?? undefined, to: q.get('to') ?? undefined,
  type: q.get('type') ?? undefined, severity: q.get('severity') ?? undefined,
  facility: q.get('facility') ?? undefined, state: q.get('state') ?? undefined,
  program: q.get('program') ?? undefined, top: q.get('top') ?? undefined
});
const fail = (context, err) => {
  context.warn(`incident endpoint failed: ${err.message}`);
  return { status: 502, jsonBody: { error: 'c360 unavailable', detail: err.message } };
};

app.http('incidentOptions', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/incidents/options',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    try { return { status: 200, jsonBody: await incidentFilterOptions() }; }
    catch (err) { return fail(context, err); }
  }
});

app.http('incidentMetrics', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/incidents/metrics',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    try { return { status: 200, jsonBody: await incidentMetrics(filtersFrom(request.query)) }; }
    catch (err) { return fail(context, err); }
  }
});

app.http('incidentList', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/incidents/list',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    try {
      const rows = await queryIncidentsStructured(filtersFrom(request.query));
      return { status: 200, jsonBody: { rows, count: rows.length } };
    } catch (err) { return fail(context, err); }
  }
});

// Identified incident (PHI narrative). Gated note.viewPhi + fail-closed audit + no-store.
app.http('incidentFull', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/incidents/{id}/full',
  handler: async (request, context) => {
    const { principal } = await authorize(request, 'note.viewPhi');
    const id = request.params.id;
    let incident, subforms = {};
    // Identified detail + all subforms fetched concurrently (pooled).
    try {
      const [inc, subs] = await Promise.all([
        getIncidentIdentified(id),
        getIncidentSubforms(id).catch((err) => { context.warn(`incident subforms failed: ${err.message}`); return {}; })
      ]);
      incident = inc; subforms = subs;
    } catch (err) { return { status: 502, headers: NO_STORE, jsonBody: { error: 'c360 unavailable', detail: err.message } }; }
    if (!incident) return { status: 404, headers: NO_STORE, jsonBody: { error: 'incident not found' } };
    try { await logAccess({ actor: principal, action: 'view-incident-phi', clientId: incident.IndividualRef ?? id, outcome: 'granted' }); }
    catch (err) { context.error(`incident PHI access log failed: ${err.message}`); return { status: 503, headers: NO_STORE, jsonBody: { error: 'unable to record access; not served' } }; }
    return { status: 200, headers: NO_STORE, jsonBody: { incident, subforms } };
  }
});
