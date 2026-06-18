// Client-side mirror of api/src/lib/permissions.js. Used for UI gating only —
// the API is the authority. Keep these two files in sync.

export const PERMISSIONS = {
  'module.intelligence.access': 'Access Beacon Care Intelligence',
  'report.view': 'View dashboards and reports',
  'report.create': 'Generate / save reports',
  'report.export': 'Export reports to PDF / Excel',
  'assistant.use': 'Use the NL chat / Q&A assistant',
  'insight.view': 'See AI narrative insights on reports',
  'signal.view': 'View predictive risk-scoring signals',
  'signal.manage': 'Configure signal thresholds / models',
  'client.viewInitials': 'View client initials + program context (de-identified)',
  'client.viewDwLink': 'Follow the approved link-back to the full client record in the data warehouse',
  'admin.manage': 'Manage users, roles, and settings'
};

export function can(user, perm) {
  return !!user && Array.isArray(user.effectivePermissions) && user.effectivePermissions.includes(perm);
}
