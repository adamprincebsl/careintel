// Cosmos DB client + tiny repository helper for THIS app's own database
// (cosmos-beacon-care-intelligence / care-intelligence). This is where Beacon
// Care Intelligence persists its own data — saved reports, chat sessions,
// cached AI insights, and predictive signals. The system-of-record care data
// (CAPs, Risks, Audits, Locations) is NOT here — it's read read-only from the
// cap app's account via capData.js.
//
// Auth precedence:
//   1. COSMOS_KEY_LOCAL_ONLY  — for the local emulator only (skip in prod).
//   2. DefaultAzureCredential — managed identity in Azure, az/dev creds locally.
//
// In Azure, the Function App's system-assigned managed identity is granted
// "Cosmos DB Built-in Data Contributor" on this account by Bicep. No keys,
// no connection strings, no rotation.
//
// Repository surface (per container):
//   repo.get(id, partitionKey)             -> doc | null
//   repo.list({ query, parameters })       -> [docs]
//   repo.upsert(doc)                       -> doc        (creates or replaces)
//   repo.replace(doc, etag)                -> doc        (optimistic concurrency)
//   repo.delete(id, partitionKey)          -> void
//
// Documents always carry a `pk` field for the partition key (path /pk),
// unless a container overrides its partition key path in Bicep.

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

let _client = null;

export function getCosmosClient() {
  if (_client) return _client;

  const endpoint = process.env.COSMOS_ENDPOINT;
  if (!endpoint) throw new Error('COSMOS_ENDPOINT not set');

  const localKey = process.env.COSMOS_KEY_LOCAL_ONLY;
  if (localKey) {
    _client = new CosmosClient({ endpoint, key: localKey });
    return _client;
  }

  _client = new CosmosClient({
    endpoint,
    aadCredentials: new DefaultAzureCredential()
  });
  return _client;
}

export function getDatabase(name) {
  const dbName = name || process.env.COSMOS_DATABASE;
  if (!dbName) throw new Error('COSMOS_DATABASE not set');
  return getCosmosClient().database(dbName);
}

export function getContainer(containerName, dbName) {
  const name = containerName || process.env.COSMOS_CONTAINER_DEFAULT;
  if (!name) throw new Error('container name not provided and COSMOS_CONTAINER_DEFAULT not set');
  return getDatabase(dbName).container(name);
}

export function repo(containerName, dbName) {
  const container = getContainer(containerName, dbName);

  return {
    container,

    async get(id, partitionKey) {
      try {
        const { resource } = await container.item(id, partitionKey).read();
        return resource || null;
      } catch (err) {
        if (err.code === 404) return null;
        throw err;
      }
    },

    async list({ query, parameters } = {}) {
      const spec = query
        ? { query, parameters: parameters || [] }
        : { query: 'SELECT * FROM c' };
      const { resources } = await container.items.query(spec).fetchAll();
      return resources;
    },

    async upsert(doc) {
      const { resource } = await container.items.upsert(doc);
      return resource;
    },

    async replace(doc, etag) {
      const opts = etag ? { accessCondition: { type: 'IfMatch', condition: etag } } : {};
      const { resource } = await container.item(doc.id, doc.pk).replace(doc, opts);
      return resource;
    },

    async delete(id, partitionKey) {
      try {
        await container.item(id, partitionKey).delete();
      } catch (err) {
        if (err.code === 404) return;
        throw err;
      }
    }
  };
}
