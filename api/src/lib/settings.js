// App settings (single doc id='app' in the `appSettings` container).
//
// Feature flags let an admin turn modules on/off without a deploy; idle timeout
// drives client-side auto-signout. Mirrors the cap app's appSettings pattern.
// getSettings() always returns a fully-defaulted object, so callers never have
// to null-check individual flags.

import { repo } from './cosmos.js';

export const DEFAULT_SETTINGS = {
  features: {
    assistant: true,        // NL assistant
    c360: true,             // c360 reporting
    signals: false,         // predictive signals (C5 — off until built)
    draftedReports: false   // AI-drafted reports (Phase 4 — off until built)
  },
  idleTimeoutMinutes: 15
};

/** Effective settings = defaults merged with the stored doc. */
export async function getSettings() {
  const doc = await repo('appSettings').get('app', 'app');
  return {
    features: { ...DEFAULT_SETTINGS.features, ...(doc?.features || {}) },
    idleTimeoutMinutes: doc?.idleTimeoutMinutes ?? DEFAULT_SETTINGS.idleTimeoutMinutes
  };
}

/** Build the settings doc from a partial patch merged onto existing/defaults. */
export function buildSettingsDoc({ patch = {}, existing = null, now }) {
  const base = existing || { id: 'app', pk: 'app' };
  const features = { ...DEFAULT_SETTINGS.features, ...(base.features || {}) };
  if (patch.features) {
    for (const [k, v] of Object.entries(patch.features)) {
      if (k in DEFAULT_SETTINGS.features) features[k] = !!v; // only known flags, coerced to bool
    }
  }
  let idle = base.idleTimeoutMinutes ?? DEFAULT_SETTINGS.idleTimeoutMinutes;
  if (patch.idleTimeoutMinutes !== undefined) {
    const n = Number(patch.idleTimeoutMinutes);
    if (!Number.isFinite(n) || n < 0) throw new Error('idleTimeoutMinutes must be a number ≥ 0');
    idle = n;
  }
  return { id: 'app', pk: 'app', features, idleTimeoutMinutes: idle, updatedAt: now };
}
