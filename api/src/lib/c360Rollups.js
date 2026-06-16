// c360 rollup definitions (plan step C2) — the catalog of de-identified
// aggregates the nightly snapshot job materializes into `c360Snapshots`.
//
// ⚠️ ILLUSTRATIVE — these match docs/c360-annotations.example.json, NOT the
// real c360 schema. Once the dictionary is loaded (C1), replace the table/
// column/SQL with the real ones. Every def must:
//   • group/measure ONLY on columns the dictionary classifies 'safe'
//     (runRollup() asserts this and refuses otherwise);
//   • return a `countField` so small cells can be suppressed;
//   • never select a PHI / identifier column.
//
// Keep SQL parameterized and read-only (SELECT only).

export const ROLLUPS = [
  {
    key: 'census_by_program',
    table: 'dbo.Client',
    groupColumns: ['ProgramId', 'State'],
    countField: 'n',
    grain: { dimension: 'program', measure: 'active client count' },
    sql: `
      SELECT ProgramId, State, COUNT(*) AS n
      FROM dbo.Client
      WHERE DischargeDate IS NULL
      GROUP BY ProgramId, State`
  },
  {
    key: 'admissions_by_month_state',
    table: 'dbo.Client',
    groupColumns: ['State'],
    countField: 'n',
    grain: { dimension: 'state × month', measure: 'admissions' },
    sql: `
      SELECT State, DATEFROMPARTS(YEAR(AdmissionDate), MONTH(AdmissionDate), 1) AS month, COUNT(*) AS n
      FROM dbo.Client
      WHERE AdmissionDate IS NOT NULL
      GROUP BY State, DATEFROMPARTS(YEAR(AdmissionDate), MONTH(AdmissionDate), 1)`
  }
];
