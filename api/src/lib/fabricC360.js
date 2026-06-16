// Read-ONLY connection to the c360 Microsoft Fabric warehouse (`core-prod-db`).
//
// c360 is the client-360 data in Fabric, in the same workspace as the cap app's
// BSL_Silver_Warehouse. We read it read-only over the standard SQL Server TDS
// protocol (port 1433) using an Entra access token — the Function App's
// system-assigned managed identity in Azure, or the developer's `az login`
// session locally. Both resolve through DefaultAzureCredential.
//
// Cloned from beacon-capapp/api/src/lib/fabric.js (the proven pattern) and
// pointed at the c360 warehouse via its own env vars so the two sources never
// get crossed:
//   FABRIC_C360_SQL_ENDPOINT    - host (…-xdpozjn34hau3cztgs66ay2wlm.datawarehouse.fabric.microsoft.com)
//   FABRIC_C360_WAREHOUSE_NAME  - warehouse / initial catalog (core-prod-db)
//
// The MI must be granted at minimum Viewer on the Fabric workspace (manual,
// one-time — Fabric grants aren't expressible in Bicep). See
// docs/C360_INTELLIGENCE_PLAN.md §6 and the cap app's docs/FABRIC_SETUP.md.
//
// HARD RULE: read-only. No writes, ever. PHI from c360 may reach Azure OpenAI
// under the BAA, but is aggregated/de-identified before anything lands in
// Cosmos. This module never persists — callers do, through cosmos.js.

import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';

let _pool = null;
let _poolPromise = null;

const ENDPOINT  = () => process.env.FABRIC_C360_SQL_ENDPOINT;
const WAREHOUSE = () => process.env.FABRIC_C360_WAREHOUSE_NAME;

async function createPool() {
  const endpoint  = ENDPOINT();
  const warehouse = WAREHOUSE();
  if (!endpoint)  throw new Error('FABRIC_C360_SQL_ENDPOINT not set');
  if (!warehouse) throw new Error('FABRIC_C360_WAREHOUSE_NAME not set');

  // Fabric SQL uses the Azure SQL audience (https://database.windows.net).
  const credential = new DefaultAzureCredential();
  const tokenResponse = await credential.getToken('https://database.windows.net/.default');
  if (!tokenResponse?.token) throw new Error('Failed to acquire c360 access token from Entra');

  const config = {
    server:   endpoint,
    database: warehouse,
    port:     1433,
    options:  { encrypt: true, trustServerCertificate: false },
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token: tokenResponse.token }
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
    connectionTimeout: 30_000,
    requestTimeout: 60_000
  };

  const pool = await new sql.ConnectionPool(config).connect();
  pool.on('error', (err) => {
    console.error('[c360] pool error:', err.message);
    _pool = null;
    _poolPromise = null;
  });
  return pool;
}

export async function getC360Pool() {
  if (_pool?.connected) return _pool;
  if (_poolPromise) return _poolPromise;
  _poolPromise = createPool().then((p) => { _pool = p; _poolPromise = null; return p; })
    .catch((e) => { _poolPromise = null; throw e; });
  return _poolPromise;
}

/**
 * Run a read-only parameterized query against c360. Returns the recordset
 * (array of objects), or [] for empty results.
 *
 *   const rows = await c360Query(
 *     'SELECT TOP (@n) name FROM sys.tables ORDER BY name', { n: 10 });
 */
export async function c360Query(query, params = {}) {
  const pool = await getC360Pool();
  const request = pool.request();
  for (const [k, v] of Object.entries(params)) request.input(k, v);
  const result = await request.query(query);
  return result.recordset || [];
}

/** Force a fresh pool (e.g. after a credential refresh, or in tests). */
export async function resetC360Pool() {
  if (_pool) { try { await _pool.close(); } catch { /* ignore */ } }
  _pool = null;
  _poolPromise = null;
}
