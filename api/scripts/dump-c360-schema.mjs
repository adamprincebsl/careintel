// Dump the full schema of the c360 Fabric warehouse (core-prod-db) to stdout.
//
// Lists every schema, table, and column with its type + PK + (optional) row
// counts. This is the bootstrap for the `c360Schema` data dictionary (plan
// step C1): run it once from a connected machine, then annotate the output
// with descriptions / glossary / join graph and load it into Cosmos.
//
// PHI-SAFE: emits METADATA ONLY (table/column names, types, row counts via the
// sys.partitions DMV — no table scans, no client rows).
//
// Auth: DefaultAzureCredential — your local `az login`. You need at least
// Viewer on the Fabric workspace (workspace owners already have it).
//
// NOTE: the Fabric "Redirect" connection policy reroutes to a backend node, so
// this only completes from a network with line-of-sight to the Fabric backend
// (your corp network or Azure) — not from a restricted sandbox. See
// docs/C360_INTELLIGENCE_PLAN.md §4.1.
//
// Usage (endpoint/warehouse default to the confirmed c360 values):
//   node api/scripts/dump-c360-schema.mjs                 # JSON, no counts
//   node api/scripts/dump-c360-schema.mjs --text          # human-readable
//   node api/scripts/dump-c360-schema.mjs --counts         # include row counts
//   node api/scripts/dump-c360-schema.mjs --table=dbo.Client --text
//   FABRIC_C360_SQL_ENDPOINT=... FABRIC_C360_WAREHOUSE_NAME=... node api/scripts/dump-c360-schema.mjs

import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a) => {
    if (a === '--text') { acc.push(['text', true]); return acc; }
    if (a === '--counts') { acc.push(['counts', true]); return acc; }
    if (a.startsWith('--') && a.includes('=')) {
      const eq = a.indexOf('=');
      acc.push([a.slice(2, eq), a.slice(eq + 1)]);
    }
    return acc;
  }, [])
);
const TEXT = !!args.text;
const ONE_TABLE = args.table || null; // e.g. "dbo.Client"

const endpoint  = process.env.FABRIC_C360_SQL_ENDPOINT
  || '4trxo4y44m3e7byjyu2g7pz6le-xdpozjn34hau3cztgs66ay2wlm.datawarehouse.fabric.microsoft.com';
const warehouse = process.env.FABRIC_C360_WAREHOUSE_NAME || 'core-prod-db';

const SYS_SCHEMAS = "'sys','INFORMATION_SCHEMA','db_owner','db_accessadmin','db_securityadmin','db_ddladmin','db_backupoperator','db_datareader','db_datawriter','db_denydatareader','db_denydatawriter'";

console.error(`[dump-c360-schema] connecting to ${endpoint} / ${warehouse}…`);
const credential = new DefaultAzureCredential();
const tokenResp = await credential.getToken('https://database.windows.net/.default');
if (!tokenResp?.token) {
  console.error('Failed to acquire access token. Are you `az login`d?');
  process.exit(1);
}

let pool;
try {
  pool = await new sql.ConnectionPool({
    server: endpoint,
    database: warehouse,
    port: 1433,
    options: { encrypt: true, trustServerCertificate: false },
    authentication: { type: 'azure-active-directory-access-token', options: { token: tokenResp.token } },
    connectionTimeout: 30_000,
    requestTimeout: 60_000
  }).connect();
} catch (e) {
  console.error(`[dump-c360-schema] connection failed: ${e.message}`);
  if (/ETIMEDOUT|ESOCKET|pbidedicated/.test(String(e.message) + String(e.originalError?.message))) {
    console.error('  → Looks like the Fabric backend is unreachable from this network. Run from your');
    console.error('    corp network (where SSMS works) or from Azure. See C360_INTELLIGENCE_PLAN.md §4.1.');
  }
  process.exit(1);
}
console.error('[dump-c360-schema] connected.');

const tables = (await pool.request().query(`
  SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA NOT IN (${SYS_SCHEMAS})
  ORDER BY TABLE_SCHEMA, TABLE_NAME`)).recordset;

const columns = (await pool.request().query(`
  SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION,
         DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA NOT IN (${SYS_SCHEMAS})
  ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`)).recordset;

let pks = [];
try {
  pks = (await pool.request().query(`
    SELECT tc.TABLE_SCHEMA, tc.TABLE_NAME, kcu.COLUMN_NAME
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
    JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'`)).recordset;
} catch (e) { console.error('[warn] PK query failed (Fabric may not expose PKs):', e.message); }

// Fast row-count estimates from the partition-metadata DMV — no table scan, no
// PHI. Default on (it's cheap here, unlike full COUNT(*)).
let rowCounts = {};
if (args.counts !== false) {
  try {
    const rc = (await pool.request().query(`
      SELECT s.name AS sch, t.name AS tbl, SUM(p.rows) AS n
      FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
      GROUP BY s.name, t.name`)).recordset;
    for (const r of rc) rowCounts[`${r.sch}.${r.tbl}`] = r.n;
  } catch (e) { console.error('[warn] row-count DMV failed:', e.message); }
}

const colsByTable = {};
for (const c of columns) (colsByTable[`${c.TABLE_SCHEMA}.${c.TABLE_NAME}`] ||= []).push(c);
const pksByTable = {};
for (const p of pks) (pksByTable[`${p.TABLE_SCHEMA}.${p.TABLE_NAME}`] ||= []).push(p.COLUMN_NAME);

const filtered = ONE_TABLE
  ? tables.filter((t) => `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`.toLowerCase() === ONE_TABLE.toLowerCase())
  : tables;

if (TEXT) {
  console.log(`\nc360 Fabric Warehouse: ${warehouse}`);
  console.log(`Endpoint:              ${endpoint}`);
  console.log(`Tables:                ${filtered.length} of ${tables.length}\n`);
  const bySchema = {};
  for (const t of filtered) (bySchema[t.TABLE_SCHEMA] ||= []).push(t);
  for (const schemaName of Object.keys(bySchema).sort()) {
    console.log(`\n========================================`);
    console.log(`Schema: ${schemaName}  (${bySchema[schemaName].length} tables)`);
    console.log(`========================================`);
    for (const t of bySchema[schemaName]) {
      const key = `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`;
      const pkList = pksByTable[key] ? ` (PK: ${pksByTable[key].join(', ')})` : '';
      const rowN = rowCounts[key] != null ? `  [~${rowCounts[key]} rows]` : '';
      console.log(`\n[${key}]${pkList}${rowN}`);
      for (const c of colsByTable[key] || []) {
        const len = c.CHARACTER_MAXIMUM_LENGTH ? `(${c.CHARACTER_MAXIMUM_LENGTH})`
                  : c.NUMERIC_PRECISION ? `(${c.NUMERIC_PRECISION}${c.NUMERIC_SCALE ? ',' + c.NUMERIC_SCALE : ''})` : '';
        const nullable = c.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
        console.log(`  ${c.COLUMN_NAME.padEnd(36)} ${(c.DATA_TYPE + len).padEnd(22)} ${nullable}`);
      }
    }
  }
} else {
  const out = { warehouse, endpoint, tableCount: filtered.length, schemas: {} };
  for (const t of filtered) {
    const k = `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`;
    (out.schemas[t.TABLE_SCHEMA] ||= {})[t.TABLE_NAME] = {
      type: t.TABLE_TYPE,
      primaryKey: pksByTable[k] || null,
      rowCount: rowCounts[k] ?? null,
      columns: (colsByTable[k] || []).map((c) => ({
        name: c.COLUMN_NAME,
        type: c.DATA_TYPE,
        len: c.CHARACTER_MAXIMUM_LENGTH ?? c.NUMERIC_PRECISION ?? null,
        scale: c.NUMERIC_SCALE,
        nullable: c.IS_NULLABLE === 'YES'
      }))
    };
  }
  console.log(JSON.stringify(out, null, 2));
}

await pool.close();
console.error(`[dump-c360-schema] done. ${filtered.length} tables enumerated.`);
