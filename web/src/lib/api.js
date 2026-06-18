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
  // Identified client detail (PHI) — live pass-through, never cached client-side.
  client: (id) => getJson(`/api/clients/${encodeURIComponent(id)}`),
  // Admin user provisioning
  listUsers: () => getJson('/api/admin/users'),
  saveUser: (oid, body) => putJson(`/api/admin/users/${encodeURIComponent(oid)}`, body),
  // c360 de-identified rollups
  c360Metrics: (key) => getJson('/api/c360/metrics' + (key ? `?key=${encodeURIComponent(key)}` : '')),
  // App settings / feature flags
  settings: () => getJson('/api/settings'),
  saveSettings: (patch) => putJson('/api/admin/settings', patch)
};
