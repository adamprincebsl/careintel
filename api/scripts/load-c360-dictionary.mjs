// Load the c360 data dictionary into Cosmos (plan step C1).
//
// Merges a raw schema dump (from dump-c360-schema.mjs) with hand-authored
// annotations, versions it, and upserts to the `c360Schema` container — then
// bumps the `c360-dict-current` pointer.
//
// PHI-free: the dictionary is metadata + descriptions only.
//
// Usage:
//   # 1. produce the dump from a connected machine:
//   node scripts/dump-c360-schema.mjs > c360-schema.json
//
//   # 2. author annotations (start from docs/c360-annotations.example.json):
//   #    descriptions, PHI classification, joins, glossary, metrics
//
//   # 3a. preview the merged dictionary WITHOUT writing (no Cosmos needed):
//   node scripts/load-c360-dictionary.mjs --dump=c360-schema.json \
//        --annotations=c360-annotations.json --dry-run
//
//   # 3b. load into Cosmos (needs COSMOS_ENDPOINT + creds, like the app):
//   node scripts/load-c360-dictionary.mjs --dump=c360-schema.json \
//        --annotations=c360-annotations.json
//
// Flags:
//   --dump=FILE          required — JSON from dump-c360-schema.mjs
//   --annotations=FILE   optional — hand-authored annotations JSON
//   --version=N          optional — force version (default: current + 1)
//   --dry-run            print the merged doc, don't write

import { readFile } from 'node:fs/promises';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  if (a === '--dry-run') return ['dry-run', true];
  const eq = a.indexOf('=');
  return eq > -1 ? [a.slice(2, eq), a.slice(eq + 1)] : [a.slice(2), true];
}));

if (!args.dump) {
  console.error('--dump=FILE is required (output of dump-c360-schema.mjs)');
  process.exit(1);
}

const { buildDictionary } = await import('../src/lib/c360Context.js');

const dump = JSON.parse(await readFile(args.dump, 'utf-8'));
const annotations = args.annotations ? JSON.parse(await readFile(args.annotations, 'utf-8')) : {};
const generatedAt = new Date().toISOString();

async function resolveVersion() {
  if (args.version) return parseInt(args.version, 10);
  if (args['dry-run']) return 1;
  const { getCurrentVersion } = await import('../src/lib/c360Context.js');
  return (await getCurrentVersion()) + 1;
}

const version = await resolveVersion();
const doc = buildDictionary({ dump, annotations, version, generatedAt });

console.error(`[load-c360-dictionary] v${version}: ${doc.tableCount} tables, ` +
  `${doc.coverage.classifiedColumns}/${doc.coverage.totalColumns} columns classified, ` +
  `${doc.joins.length} joins, ${doc.glossary.length} glossary, ${doc.metrics.length} metrics`);

if (args['dry-run']) {
  console.log(JSON.stringify(doc, null, 2));
  console.error('[load-c360-dictionary] dry-run — nothing written.');
  process.exit(0);
}

const { repo } = await import('../src/lib/cosmos.js');
const { C360_DICT_PK } = await import('../src/lib/c360Context.js');
const c = repo('c360Schema');
await c.upsert(doc);
await c.upsert({ id: 'c360-dict-current', pk: C360_DICT_PK, version, updatedAt: generatedAt });
console.error(`[load-c360-dictionary] loaded v${version} and set as current.`);
