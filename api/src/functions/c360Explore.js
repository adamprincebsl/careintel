// c360 Explorer endpoints (read-only query console — build-out tool).
//
//   GET  /api/c360/explore/tables             — schema browser (tables/views)
//   GET  /api/c360/explore/columns?table=     — columns of a table
//   POST /api/c360/explore/query  { sql }      — run a guarded read-only query
//
// All gated `c360.query`. The query endpoint is FAIL-CLOSED on audit: if the
// query can't be recorded to auditLog, results are not returned. Responses are
// no-store (may contain PHI).

import { app } from '@azure/functions';
import { authorize } from '../lib/authz.js';
import { repo } from '../lib/cosmos.js';
import { c360Query } from '../lib/fabricC360.js';
import { runExplore } from '../lib/c360Explore.js';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };
const SYS = "('sys','INFORMATION_SCHEMA','queryinsights')";

app.http('c360ExploreTables', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'c360/explore/tables',
  handler: async (request, context) => {
    await authorize(request, 'c360.query');
    try {
      const rows = await c360Query(`SELECT TABLE_SCHEMA s, TABLE_NAME n, TABLE_TYPE t
        FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA NOT IN ${SYS} ORDER BY 1,2`);
      return { status: 200, jsonBody: { tables: rows } };
    } catch (err) {
      context.warn(`explore/tables failed: ${err.message}`);
      return { status: 502, jsonBody: { error: 'c360 unavailable', detail: err.message } };
    }
  }
});

app.http('c360ExploreColumns', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'c360/explore/columns',
  handler: async (request, context) => {
    await authorize(request, 'c360.query');
    const table = request.query.get('table');
    if (!table) return { status: 400, jsonBody: { error: 'table is required' } };
    try {
      const rows = await c360Query(`SELECT COLUMN_NAME name, DATA_TYPE type, CHARACTER_MAXIMUM_LENGTH len, IS_NULLABLE nullable
        FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t ORDER BY ORDINAL_POSITION`, { t: table });
      return { status: 200, jsonBody: { table, columns: rows } };
    } catch (err) {
      context.warn(`explore/columns failed: ${err.message}`);
      return { status: 502, jsonBody: { error: 'c360 unavailable', detail: err.message } };
    }
  }
});

app.http('c360ExploreQuery', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'c360/explore/query',
  handler: async (request, context) => {
    const { principal } = await authorize(request, 'c360.query');
    const body = await request.json().catch(() => ({}));
    const sql = (body.sql || '').toString();

    let result;
    try {
      result = await runExplore(sql, body.maxRows);
    } catch (err) {
      // Validation errors are 400; DB errors are 502.
      const isValidation = /allowed|single statement|empty query/i.test(err.message);
      return { status: isValidation ? 400 : 502, headers: NO_STORE, jsonBody: { error: err.message } };
    }

    // Fail-closed audit: record the query before returning results.
    try {
      await repo('auditLog').upsert({
        id: `c360.query_${principal.userId}_${new Date().toISOString()}`,
        pk: 'auditLog',
        action: 'c360.query',
        actorOid: principal.userId,
        actorName: principal.name,
        summary: sql.slice(0, 500),
        after: { rowCount: result.rowCount, truncated: result.truncated },
        at: new Date().toISOString()
      });
    } catch (err) {
      context.error(`c360.query audit failed — not returning results: ${err.message}`);
      return { status: 503, headers: NO_STORE, jsonBody: { error: 'unable to record query; results withheld' } };
    }

    return { status: 200, headers: NO_STORE, jsonBody: result };
  }
});
