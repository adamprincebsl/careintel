// c360 aggregation + de-identification (plan step C2).
//
// The ONLY sanctioned path for c360 data to enter Cosmos: read raw rows from
// Fabric, aggregate them here, and persist DE-IDENTIFIED rollups to the
// `c360Snapshots` container. This module enforces the PHI boundary
// (C360_INTELLIGENCE_PLAN.md §2):
//
//   1. assertSafeColumns  — a rollup may only group/measure on columns the
//      dictionary classifies 'safe' (never PHI / quasi-identifier / isIdentifier).
//   2. suppressSmallCells — drop aggregate rows whose count < minCell so a small
//      group can't re-identify an individual (HIPAA-style small-cell suppression).
//   3. buildSnapshotDoc   — wrap the suppressed rows in a snapshot document.
//
// The guardrail functions are PURE (no Cosmos/SQL/clock) so they're unit-tested.
// runRollup() wires them to the live warehouse + dictionary.

import { c360Query } from './fabricC360.js';
import { getTableMeta } from './c360Context.js';

export const DEFAULT_MIN_CELL = 11; // HIPAA Safe Harbor-style small-cell floor

/**
 * Throw if any of `columns` is not classified 'safe' in the dictionary table
 * meta (i.e. it's PHI, quasi-identifier, an identifier, or unclassified).
 * @param {string[]} columns  column names a rollup groups/measures on
 * @param {object}   tableMeta  a dictionary table entry (from getTableMeta)
 */
export function assertSafeColumns(columns, tableMeta) {
  if (!tableMeta) throw new Error('No dictionary entry for table — load the c360 dictionary first (C1).');
  const byName = new Map((tableMeta.columns || []).map((c) => [c.name.toLowerCase(), c]));
  const offenders = [];
  for (const col of columns) {
    const m = byName.get(String(col).toLowerCase());
    if (!m) { offenders.push(`${col} (unknown)`); continue; }
    if (m.isIdentifier || m.classification !== 'safe') {
      offenders.push(`${col} (${m.isIdentifier ? 'identifier/' : ''}${m.classification})`);
    }
  }
  if (offenders.length) {
    throw new Error(`Refusing to aggregate on non-safe columns: ${offenders.join(', ')}`);
  }
}

/**
 * Drop aggregate rows whose count is below minCell. Returns
 * { rows, suppressed } so the caller can record how many were withheld.
 * @param {object[]} rows
 * @param {string}   countField  field holding the group count
 * @param {number}   [minCell]
 */
export function suppressSmallCells(rows, countField, minCell = DEFAULT_MIN_CELL) {
  const kept = [];
  let suppressed = 0;
  for (const r of rows) {
    const n = Number(r[countField]);
    if (Number.isFinite(n) && n > 0 && n < minCell) { suppressed++; continue; }
    kept.push(r);
  }
  return { rows: kept, suppressed };
}

/**
 * Build a snapshot document for the `c360Snapshots` container.
 * @param {object} p
 * @param {string} p.rollupKey
 * @param {object[]} p.rows         already-aggregated rows
 * @param {string}   p.countField
 * @param {object}   [p.grain]
 * @param {string}   p.asOf         ISO timestamp
 * @param {number}   [p.minCell]
 */
export function buildSnapshotDoc({ rollupKey, rows, countField, grain = {}, asOf, minCell = DEFAULT_MIN_CELL }) {
  const { rows: safeRows, suppressed } = suppressSmallCells(rows, countField, minCell);
  return {
    id: `${rollupKey}-${asOf}`,
    pk: rollupKey,
    rollupKey,
    asOf,
    grain,
    minCell,
    suppressedCells: suppressed,
    rowCount: safeRows.length,
    rows: safeRows
  };
}

/**
 * Execute a rollup definition against c360 and return a de-identified snapshot.
 *
 * A rollup def is vetted, parameterized, and declares the exact columns it
 * touches so we can assert they're all 'safe' before running:
 *   { key, table, groupColumns:[], countField:'n', sql, grain }
 *
 * @param {object} def
 * @param {string} asOf  ISO timestamp (passed in for determinism/testability)
 */
export async function runRollup(def, asOf) {
  const tableMeta = await getTableMeta(def.table);
  assertSafeColumns([...(def.groupColumns || [])], tableMeta);
  const rows = await c360Query(def.sql, def.params || {});
  return buildSnapshotDoc({
    rollupKey: def.key,
    rows,
    countField: def.countField || 'n',
    grain: def.grain || {},
    asOf,
    minCell: def.minCell || DEFAULT_MIN_CELL
  });
}
