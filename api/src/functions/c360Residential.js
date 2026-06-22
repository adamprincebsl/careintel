// Residential Notes reporting endpoints (the testable view).
//
//   GET /api/c360/residential/options              — distinct Program/Location for filters
//   GET /api/c360/residential/metrics?…filters…    — KPIs + activity metrics
//   GET /api/c360/residential/notes?…filters…       — de-identified note list
//   GET /api/c360/residential/note/{id}            — full structured note detail (no free text)
//
// Filters (query string): program, location, from, to, status (saved|submitted), top.
// Gated `report.view`. De-identified (initials, no narrative). No client rows persisted.

import { app } from '@azure/functions';
import { authorize, resolveClientScope, clientInScope } from '../lib/authz.js';
import { logAccess } from '../lib/audit.js';
import {
  queryResidentialNotesStructured, residentialNoteMetrics,
  residentialFilterOptions, getResidentialNoteDetail, getResidentialNoteIdentified
} from '../lib/c360Views.js';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };

const filtersFrom = (q) => ({
  program: q.get('program') ?? undefined,
  location: q.get('location') ?? undefined,
  client: q.get('client') ?? undefined,
  from: q.get('from') ?? undefined,
  to: q.get('to') ?? undefined,
  status: q.get('status') ?? undefined,
  chartType: q.get('chartType') ?? undefined,
  top: q.get('top') ?? undefined
});
const fail = (context, err) => {
  context.warn(`residential endpoint failed: ${err.message}`);
  return { status: 502, jsonBody: { error: 'c360 unavailable', detail: err.message } };
};

app.http('residentialOptions', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/residential/options',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    try { return { status: 200, jsonBody: await residentialFilterOptions() }; }
    catch (err) { return fail(context, err); }
  }
});

app.http('residentialMetrics', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/residential/metrics',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    try { return { status: 200, jsonBody: await residentialNoteMetrics(filtersFrom(request.query)) }; }
    catch (err) { return fail(context, err); }
  }
});

app.http('residentialNotes', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/residential/notes',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    try {
      const rows = await queryResidentialNotesStructured(filtersFrom(request.query));
      return { status: 200, jsonBody: { rows, count: rows.length } };
    } catch (err) { return fail(context, err); }
  }
});

app.http('residentialNoteDetail', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/residential/note/{id}',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    try {
      const note = await getResidentialNoteDetail(request.params.id);
      return note ? { status: 200, jsonBody: { note } } : { status: 404, jsonBody: { error: 'note not found' } };
    } catch (err) { return fail(context, err); }
  }
});

// FULL IDENTIFIED note (PHI). Gated note.viewPhi + location scope + fail-closed
// access audit + no-store. The clinical-viewing surface for the formatted note.
app.http('residentialNoteFull', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/residential/note/{id}/full',
  handler: async (request, context) => {
    const { principal, profile } = await authorize(request, 'note.viewPhi');
    const id = request.params.id;
    let note;
    try { note = await getResidentialNoteIdentified(id); }
    catch (err) { return { status: 502, headers: NO_STORE, jsonBody: { error: 'c360 unavailable', detail: err.message } }; }
    if (!note) {
      try { await logAccess({ actor: principal, action: 'view-note-phi', clientId: note?.ClientID ?? id, outcome: 'not-found' }); } catch { /* */ }
      return { status: 404, headers: NO_STORE, jsonBody: { error: 'note not found' } };
    }
    // Location scope: the note's Program against the caller's client scope.
    const scope = resolveClientScope(profile);
    if (!clientInScope(scope, { ProgramId: note.Program, State: null })) {
      try { await logAccess({ actor: principal, action: 'view-note-phi', clientId: note.ClientID, outcome: 'denied-scope' }); } catch { /* */ }
      return { status: 403, headers: NO_STORE, jsonBody: { error: 'note outside your location scope' } };
    }
    // Fail-closed: don't serve PHI we can't log.
    try { await logAccess({ actor: principal, action: 'view-note-phi', clientId: note.ClientID, outcome: 'granted' }); }
    catch (err) { context.error(`note PHI access log failed: ${err.message}`); return { status: 503, headers: NO_STORE, jsonBody: { error: 'unable to record access; not served' } }; }
    return { status: 200, headers: NO_STORE, jsonBody: { note } };
  }
});
