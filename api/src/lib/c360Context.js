// c360 semantic context — the "data dictionary" (plan step C1).
//
// A versioned, PHI-free description of the c360 warehouse that the AI reasons
// over instead of raw schema: table grains + descriptions, per-column PHI
// classification, the join graph, a business glossary, and metric definitions.
// It drives reliable tool design (C3) and de-identification (so the aggregation
// step knows which columns are identifiers).
//
// Storage: this app's own Cosmos `c360Schema` container (pk='c360Schema').
//   - one doc per version: id = `c360-dict-v{N}`
//   - one pointer doc:     id = `c360-dict-current`, { version }
//
// `buildDictionary` is PURE (no Cosmos / no clock) so it's unit-testable; the
// loader script supplies version + generatedAt and persists the result.

import { repo } from './cosmos.js';

export const C360_DICT_PK = 'c360Schema';
export const COLUMN_CLASSES = ['PHI', 'quasi-identifier', 'safe', 'unclassified'];

/**
 * Merge a raw schema dump (from scripts/dump-c360-schema.mjs) with hand-authored
 * annotations into a dictionary document. Pure — pass version + generatedAt in.
 *
 * @param {object} p
 * @param {object} p.dump          { warehouse, endpoint, schemas: { <schema>: { <table>: {type,primaryKey,rowCount,columns[]} } } }
 * @param {object} [p.annotations] { tables: { "<schema>.<table>": {description,grain,phi,columns:{<col>:{description,classification,isIdentifier}}} }, joins[], glossary[], metrics[] }
 * @param {number} p.version
 * @param {string} p.generatedAt   ISO timestamp
 * @returns {object} dictionary doc ready to upsert
 */
export function buildDictionary({ dump, annotations = {}, version, generatedAt }) {
  if (!dump || !dump.schemas) throw new Error('dump.schemas is required');
  if (!Number.isInteger(version)) throw new Error('version (integer) is required');

  const tableAnno = annotations.tables || {};
  const tables = [];

  for (const [schema, tbls] of Object.entries(dump.schemas)) {
    for (const [name, meta] of Object.entries(tbls)) {
      const key = `${schema}.${name}`;
      const a = tableAnno[key] || {};
      const colAnno = a.columns || {};
      tables.push({
        key,
        schema,
        name,
        type: meta.type || 'BASE TABLE',
        primaryKey: meta.primaryKey || null,
        rowCount: meta.rowCount ?? null,
        description: a.description || '',
        grain: a.grain || '',                  // "one row per ..."
        phi: a.phi || 'unknown',               // none | contains | mixed | unknown
        columns: (meta.columns || []).map((c) => ({
          name: c.name,
          type: c.type,
          len: c.len ?? null,
          nullable: !!c.nullable,
          description: colAnno[c.name]?.description || '',
          classification: COLUMN_CLASSES.includes(colAnno[c.name]?.classification)
            ? colAnno[c.name].classification
            : 'unclassified',
          isIdentifier: !!colAnno[c.name]?.isIdentifier
        }))
      });
    }
  }
  tables.sort((x, y) => x.key.localeCompare(y.key));

  // Coverage stats so reviewers can see how much is still 'unclassified'.
  const allCols = tables.flatMap((t) => t.columns);
  const classified = allCols.filter((c) => c.classification !== 'unclassified').length;

  return {
    id: `c360-dict-v${version}`,
    pk: C360_DICT_PK,
    kind: 'dictionary',
    version,
    source: { endpoint: dump.endpoint || null, warehouse: dump.warehouse || null },
    generatedAt,
    tableCount: tables.length,
    columnCount: allCols.length,
    coverage: { classifiedColumns: classified, totalColumns: allCols.length },
    tables,
    joins: annotations.joins || [],        // [{ from:'dbo.A.col', to:'dbo.B.col', kind:'many-to-one', note }]
    glossary: annotations.glossary || [],  // [{ term, definition, relatedTables:[] }]
    metrics: annotations.metrics || []     // [{ name, definition, sqlHint, tables:[] }]
  };
}

// ---- Read helpers (Cosmos-backed) -----------------------------------------

/** Current dictionary version number, or 0 if none loaded yet. */
export async function getCurrentVersion() {
  const ptr = await repo('c360Schema').get('c360-dict-current', C360_DICT_PK);
  return ptr?.version || 0;
}

/** The current dictionary doc, or null if none loaded. */
export async function getCurrentDictionary() {
  const version = await getCurrentVersion();
  if (!version) return null;
  return repo('c360Schema').get(`c360-dict-v${version}`, C360_DICT_PK);
}

/** Look up one table's metadata in the current dictionary (by "schema.table"). */
export async function getTableMeta(key) {
  const dict = await getCurrentDictionary();
  return dict?.tables.find((t) => t.key.toLowerCase() === String(key).toLowerCase()) || null;
}
