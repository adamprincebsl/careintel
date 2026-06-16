// GET /api/c360/schema — return the current c360 data dictionary (PHI-free
// metadata: tables, columns, classifications, joins, glossary, metrics).
//
// Gated on `report.view` — it's reference metadata the reporting UI and the
// assistant's tool layer consume. Returns 404-shaped { dictionary: null } when
// none has been loaded yet (run scripts/load-c360-dictionary.mjs).

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { getCurrentDictionary } from '../lib/c360Context.js';

app.http('c360Schema', {
  methods: ['GET'],
  authLevel: 'anonymous', // SWA enforces auth at the edge; authorize re-checks
  route: 'c360/schema',
  handler: async (request) => {
    await authorize(request, 'report.view');
    const dictionary = await getCurrentDictionary();
    return { status: 200, jsonBody: { dictionary } };
  }
});
