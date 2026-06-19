// c360 residential-note endpoints (the de-identified "view" surface).
//
//   GET /api/c360/notes/residential/profile  — validation/profiling aggregates
//                                               (confirms the mapping vs live data)
//   GET /api/c360/notes/residential           — de-identified structured notes
//        ?program= &from= &to= &state=draft|submitted &top=
//
// Gated `report.view`. The structured view is de-identified (initials, no free
// text), so it's reporting data — not the audited PHI path (that's clients.js).

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { queryResidentialNotesStructured, profileResidentialNotes, profileNote, NOTE_TABLES } from '../lib/c360Views.js';

// GET /api/c360/notes/profile?table=<NoteTable>  — generic profiler for any note
// type in the allowlist (columns + volume + Saved/Submitted + absence). Defaults
// to the residential note's richer profile (offered/participated) when no table
// or the residential table is given.
app.http('c360NotesProfile', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'c360/notes/profile',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    const table = request.query.get('table');
    try {
      if (!table || table === 'BSL_ResidentialServiceNote') {
        return { status: 200, jsonBody: await profileResidentialNotes() };
      }
      return { status: 200, jsonBody: await profileNote(table) };
    } catch (err) {
      if (/unknown note table/.test(err.message)) {
        return { status: 400, jsonBody: { error: err.message, allowed: NOTE_TABLES } };
      }
      context.warn(`notes profile failed: ${err.message}`);
      return { status: 502, jsonBody: { error: 'c360 unavailable', detail: err.message } };
    }
  }
});

app.http('c360NotesResidential', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'c360/notes/residential',
  handler: async (request, context) => {
    await authorize(request, 'report.view');
    const q = request.query;
    try {
      const rows = await queryResidentialNotesStructured({
        program: q.get('program') ?? undefined,
        from: q.get('from') ?? undefined,
        to: q.get('to') ?? undefined,
        state: q.get('state') ?? undefined,
        top: q.get('top') ?? undefined
      });
      return { status: 200, jsonBody: { rows, count: rows.length } };
    } catch (err) {
      context.warn(`notes query failed: ${err.message}`);
      return { status: 502, jsonBody: { error: 'c360 unavailable', detail: err.message } };
    }
  }
});
