// Fill and download the Michigan BCAL-4607 incident/accident report for a
// single incident. Michigan-located incidents only.
//   GET /api/c360/incidents/{id}/pdf/bcal4607
// PHI (client name/address on the form): gated note.viewPhi + fail-closed audit.

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { logAccess } from '../lib/audit.js';
import { getIncidentBcal4607Data } from '../lib/incidentViews.js';
import { fillBcal4607 } from '../lib/pdfFill.js';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };
const isMichigan = (s) => { const v = String(s || '').trim().toLowerCase(); return v === 'mi' || v === 'michigan'; };

app.http('incidentBcal4607', {
  methods: ['GET'], authLevel: 'anonymous', route: 'c360/incidents/{id}/pdf/bcal4607',
  handler: async (request, context) => {
    const { principal } = await authorize(request, 'note.viewPhi');
    const id = request.params.id;
    let data;
    try { data = await getIncidentBcal4607Data(id); }
    catch (err) { context.warn(`bcal4607 data failed: ${err.message}`); return { status: 502, headers: NO_STORE, jsonBody: { error: 'c360 unavailable', detail: err.message } }; }
    if (!data) return { status: 404, headers: NO_STORE, jsonBody: { error: 'incident not found' } };
    if (!isMichigan(data.facilityState)) return { status: 409, headers: NO_STORE, jsonBody: { error: 'BCAL-4607 applies to Michigan-located incidents only' } };

    let pdf;
    try { pdf = await fillBcal4607(data); }
    catch (err) { context.error(`bcal4607 fill failed: ${err.message}`); return { status: 500, headers: NO_STORE, jsonBody: { error: 'unable to generate PDF', detail: err.message } }; }

    try { await logAccess({ actor: principal, action: 'download-bcal4607', clientId: id, outcome: 'granted' }); }
    catch (err) { context.error(`bcal4607 access log failed: ${err.message}`); return { status: 503, headers: NO_STORE, jsonBody: { error: 'unable to record access; not served' } }; }

    return {
      status: 200,
      headers: { ...NO_STORE, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="BCAL-4607-incident-${id}.pdf"` },
      body: Buffer.from(pdf)
    };
  }
});
