// Thin fetch wrappers for the BCI API. All calls go through the SWA proxy
// (/api/*), which injects the authenticated principal header for the Functions
// backend. In local dev the Vite proxy forwards to the Functions runtime and
// the backend's MOCK_PRINCIPAL stands in for the SWA principal.

async function handle(res) {
  if (res.status === 401) {
    // Session expired / not signed in — bounce to the Entra login.
    window.location.href = '/.auth/login/aad?post_login_redirect_uri=' + encodeURIComponent(window.location.pathname);
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} ${body}`.trim());
  }
  return res.json();
}

export function getJson(path) {
  return fetch(path).then(handle);
}

export function postJson(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(handle);
}

export function putJson(path, body) {
  return fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(handle);
}

// Convenience endpoints
export const api = {
  me: () => getJson('/api/users/me'),
  metricsOverview: () => getJson('/api/metrics/overview'),
  ask: (question) => postJson('/api/assistant/ask', { question }),
  // Client display — initials only, live, never cached client-side.
  client: (id) => getJson(`/api/clients/${encodeURIComponent(id)}`),
  // Approved link-back to the full record in the DW (audited; returns a URL).
  clientDwLink: (id) => postJson(`/api/clients/${encodeURIComponent(id)}/dw-link`, {}),
  // Admin user provisioning
  listUsers: () => getJson('/api/admin/users'),
  saveUser: (oid, body) => putJson(`/api/admin/users/${encodeURIComponent(oid)}`, body),
  // c360 de-identified rollups
  c360Metrics: (key) => getJson('/api/c360/metrics' + (key ? `?key=${encodeURIComponent(key)}` : '')),
  // Residential Notes reporting
  resOptions: () => getJson('/api/c360/residential/options'),
  resMetrics: (qs) => getJson('/api/c360/residential/metrics' + (qs ? `?${qs}` : '')),
  resNotes: (qs) => getJson('/api/c360/residential/notes' + (qs ? `?${qs}` : '')),
  resNote: (id) => getJson(`/api/c360/residential/note/${encodeURIComponent(id)}`),
  resNoteFull: (id) => getJson(`/api/c360/residential/note/${encodeURIComponent(id)}/full`),
  carePlan: (clientId) => getJson(`/api/c360/residential/client/${encodeURIComponent(clientId)}/care-plan`),
  // Incidents
  incOptions: () => getJson('/api/c360/incidents/options'),
  incMetrics: (qs) => getJson('/api/c360/incidents/metrics' + (qs ? `?${qs}` : '')),
  incList: (qs) => getJson('/api/c360/incidents/list' + (qs ? `?${qs}` : '')),
  incFull: (id) => getJson(`/api/c360/incidents/${encodeURIComponent(id)}/full`),
  clientDoc: (id) => getJson(`/api/c360/client/${encodeURIComponent(id)}/documentation`),
  // App settings / feature flags
  settings: () => getJson('/api/settings'),
  saveSettings: (patch) => putJson('/api/admin/settings', patch),
  // Admin/config audit
  auditLog: () => getJson('/api/admin/audit'),
  // c360 Explorer (read-only query console)
  exploreTables: () => getJson('/api/c360/explore/tables'),
  exploreColumns: (table) => getJson(`/api/c360/explore/columns?table=${encodeURIComponent(table)}`),
  exploreQuery: (sql, maxRows) => postJson('/api/c360/explore/query', { sql, maxRows }),
  // Custom roles
  listRoles: () => getJson('/api/admin/roles'),
  saveRole: (name, body) => putJson(`/api/admin/roles/${encodeURIComponent(name)}`, body),
  deleteRole: (name) => fetch(`/api/admin/roles/${encodeURIComponent(name)}`, { method: 'DELETE' }).then((r) => {
    if (!r.ok) return r.text().then((t) => { throw new Error(t || r.statusText); });
    return r.json();
  })
};
