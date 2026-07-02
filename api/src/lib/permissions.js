// Permissions catalog for Beacon Care Intelligence (server-side mirror).
//
// Mirrors the flat dotted-string permission model used across Beacon apps
// (see beacon-capapp api/src/lib/permissions.js). The web SPA carries an
// identical copy at web/src/lib/permissions.js for client-side gating; this
// file is the authority the API enforces.
//
// BCI is read-only against the cap data, so its permissions are about WHO can
// see/run reporting + AI features, not about mutating source records.

export const PERMISSIONS = {
  // Module gate — every BCI role holds this.
  'module.intelligence.access': 'Access Beacon Care Intelligence at all',

  // Reporting
  'report.view': 'View dashboards and reports',
  'report.create': 'Generate / save reports',
  'report.export': 'Export reports to PDF / Excel',

  // AI assistant
  'assistant.use': 'Use the NL chat / Q&A assistant',
  'insight.view': 'See AI narrative insights on reports',

  // Predictive signals
  'signal.view': 'View predictive risk-scoring signals',
  'signal.manage': 'Configure signal thresholds / models',

  // Client identity. The app shows INITIALS ONLY (de-identified), read live from
  // c360 views, never persisted, scoped to the user's locations, and audited.
  // The full identified record is reached only via an approved link-back to the
  // data warehouse (which enforces its own access) — gated separately.
  'client.viewInitials': 'View client initials + program context (de-identified)',
  'client.viewDwLink': 'Follow the approved link-back to the full client record in the data warehouse',
  'note.viewPhi': 'View the full identified clinical note (PHI) for clients in scope',
  'incident.manage': 'Create and update incident workflow tasks (root cause, medical, clinical, operational, follow-up)',

  // c360 build-out tooling — read-only query console (may surface PHI; audited)
  'c360.query': 'Run read-only c360 queries in the Explorer (build-out tool)',

  // Admin
  'admin.manage': 'Manage users, roles, and settings'
};

// Starter system roles. Custom roles can be layered on later (per the cap app
// pattern: roles stored in a Cosmos `roles` container with a permissions[] array).
export const SYSTEM_ROLES = {
  CI_Admin:    Object.keys(PERMISSIONS),
  CI_Analyst:  ['module.intelligence.access', 'report.view', 'report.create', 'report.export', 'assistant.use', 'insight.view', 'signal.view'],
  CI_Viewer:   ['module.intelligence.access', 'report.view', 'insight.view', 'signal.view']
};

/** True if the principal (or resolved user) holds the given permission. */
export function can(permissions, perm) {
  return Array.isArray(permissions) && permissions.includes(perm);
}

export function requirePermission(userPermissions, perm) {
  if (!can(userPermissions, perm)) {
    const err = new Error(`Forbidden — permission "${perm}" required`);
    err.statusCode = 403;
    throw err;
  }
}
