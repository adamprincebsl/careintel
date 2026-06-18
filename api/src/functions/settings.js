// GET /api/settings          — effective app settings (any authed user; the SPA
//                               gates nav/features on these flags).
// PUT /api/admin/settings     — update feature flags / idle timeout (admin.manage).

import { app } from '@azure/functions';
import { requireAuth } from '../lib/auth.js';
import { authorize } from '../lib/authz.js';
import { repo } from '../lib/cosmos.js';
import { getSettings, buildSettingsDoc } from '../lib/settings.js';

app.http('settingsGet', {
  methods: ['GET'],
  authLevel: 'anonymous', // SWA enforces auth at the edge
  route: 'settings',
  handler: async (request) => {
    requireAuth(request);
    return { status: 200, jsonBody: await getSettings() };
  }
});

app.http('settingsPut', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'admin/settings',
  handler: async (request) => {
    await authorize(request, 'admin.manage');
    const patch = await request.json().catch(() => ({}));
    const settings = repo('appSettings');
    try {
      const existing = await settings.get('app', 'app');
      const doc = buildSettingsDoc({ patch, existing, now: new Date().toISOString() });
      const saved = await settings.upsert(doc);
      return { status: 200, jsonBody: saved };
    } catch (err) {
      return { status: 400, jsonBody: { error: err.message } };
    }
  }
});
