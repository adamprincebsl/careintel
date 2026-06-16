// Read-ONLY access to the cap app's Cosmos account — the system of record for
// all care/compliance data that Beacon Care Intelligence reports on.
//
// The cap app (beacon-capapp / "Beacon Quality Manager") owns the live data:
// CAPs, Source Events, Action Items, Risks, Mitigations, Controls, Audits,
// Locations, and Entities. This module opens a SEPARATE CosmosClient pointed
// at the cap account (CAP_COSMOS_ENDPOINT / CAP_COSMOS_DATABASE) and reads it
// read-only. We NEVER write here — all of BCI's own persistence goes through
// cosmos.js to this app's own account.
//
// Auth: DefaultAzureCredential — the BCI Function App's managed identity is
// granted "Cosmos DB Built-in Data Reader" (role 00000000-...-0001) on the cap
// account. The Bicep tries to assign it; if the deployer lacks rights on the
// cap account, run scripts/grant-cap-read.sh after the MI exists. No keys.
//
// Mirrors the read-only pattern proven in beacon-dispatch (capRouting.js),
// generalized from "routing" to the full reporting surface.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

let _client = null;
let _db = null;

function db() {
  if (_db) return _db;
  const endpoint = process.env.CAP_COSMOS_ENDPOINT;
  const database = process.env.CAP_COSMOS_DATABASE || 'capapp';
  if (!endpoint) throw new Error('CAP_COSMOS_ENDPOINT not set');

  if (!_client) {
    const localKey = process.env.COSMOS_KEY_LOCAL_ONLY;
    _client = localKey
      ? new CosmosClient({ endpoint, key: localKey })
      : new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  }
  _db = _client.database(database);
  return _db;
}

// The cap app containers BCI reads from. Partition keys documented here for
// reference only — read queries are cross-partition unless we pass one.
//   caps          /_partition (='caps')   risks          /_partition (='risks')
//   sourceEvents  /state                   riskMitigations /riskId
//   actionItems   /capId                   controls       /_partition (='controls')
//   evidence      /capId                   riskControlLinks /riskId
//   comments      /capId                   riskCapLinks   /riskId
//   locations     /state                   auditLog       /entityRef
//   entities      /_partition

/**
 * Run a read-only SQL query against a cap-app container.
 * @param {string} container  cap app container name (e.g. 'caps', 'risks')
 * @param {string} query      SQL text
 * @param {Array}  [parameters]
 * @returns {Promise<object[]>}
 */
export async function query(container, query, parameters = []) {
  const { resources } = await db().container(container).items
    .query({ query, parameters })
    .fetchAll();
  return resources;
}

/** Convenience: SELECT * FROM a container (use sparingly — prefer projected queries). */
export async function listAll(container) {
  return query(container, 'SELECT * FROM c');
}

/** All CAPs (optionally filtered by status). */
export async function listCaps({ status } = {}) {
  if (status) {
    return query('caps', 'SELECT * FROM c WHERE c.status = @s', [{ name: '@s', value: status }]);
  }
  return query('caps', 'SELECT * FROM c');
}

/** All risks with their current scores — the basis for risk reporting + signals. */
export async function listRisks() {
  return query('risks', 'SELECT * FROM c');
}

/** Programs/locations (5-level hierarchy: State → Market → Area → District → Program). */
export async function listLocations() {
  return query('locations',
    'SELECT c.id, c.programName, c.state, c.stateName, c.market, c.area, c.district, c.sageId FROM c');
}

/** Point-load one cap document by id + partition key. */
export async function getDoc(container, id, partitionKey) {
  try {
    const { resource } = await db().container(container).item(id, partitionKey).read();
    return resource || null;
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}
