// Read-only c360 query console backend (build-out tool).
//
// Lets an authorized admin (c360.query) browse schema and run SELECT queries
// against c360 from the deployed app — where the Fabric link is stable — to
// build out the mappings. Guardrails (defense-in-depth; the managed identity is
// already Viewer/read-only on Fabric):
//   - SELECT / WITH only; single statement; no write/DDL/exec keywords; no INTO.
//   - Row cap on returned results.
//   - Caller audits every query (see the function handler).
//
// ⚠️ Results may include PHI — this is an admin-gated, audited tool, with
// no-store responses. It is NOT a general reporting surface.

import { c360Query } from './fabricC360.js';

const FORBIDDEN = /\b(insert|update|delete|merge|drop|alter|create|truncate|exec|execute|grant|revoke|sp_\w+|xp_\w+)\b/i;

/** Validate that `sql` is a single read-only SELECT/CTE. Returns the cleaned SQL or throws. */
export function validateReadOnly(sql) {
  if (!sql || !sql.trim()) throw new Error('empty query');
  const s = sql.trim().replace(/;\s*$/, ''); // allow one trailing semicolon
  if (s.includes(';')) throw new Error('only a single statement is allowed');
  if (!/^(select|with)\b/i.test(s)) throw new Error('only SELECT/WITH queries are allowed');
  if (FORBIDDEN.test(s)) throw new Error('read-only: write / DDL / exec keywords are not allowed');
  if (/\binto\b/i.test(s)) throw new Error('SELECT ... INTO is not allowed');
  return s;
}

/**
 * Run a validated read-only query. Caps returned rows (default 1000) and flags
 * truncation. Throws on validation failure or DB error.
 */
export async function runExplore(sql, maxRows = 1000) {
  const safe = validateReadOnly(sql);
  const cap = Math.min(Math.max(parseInt(maxRows, 10) || 1000, 1), 5000);
  const rows = await c360Query(safe);
  return {
    columns: rows.length ? Object.keys(rows[0]) : [],
    rows: rows.slice(0, cap),
    rowCount: rows.length,
    truncated: rows.length > cap,
    cap
  };
}
