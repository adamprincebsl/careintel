// Admin / config action audit (Phase 6 item 4) — durable `auditLog` container.
//
// Logs WHO changed WHAT config (user provisioning, settings) with a before/
// after diff, so compliance can answer "who granted this access / flipped this
// flag, and when". This is config audit, NOT PHI access (that's accessLog) — the
// data here is roles/permissions/flags/emails, never client PHI.
//
// Best-effort: a write failure is logged but never blocks the underlying admin
// action (the action already succeeded by the time we audit it).

import { repo } from './cosmos.js';

/**
 * @param {object} p
 * @param {object} p.actor      { userId, name } from the principal
 * @param {string} p.action     e.g. 'user.provision' | 'settings.update'
 * @param {string} [p.targetId] the entity changed (oid, 'app', …)
 * @param {object} [p.before]   prior doc (or null)
 * @param {object} [p.after]    new doc
 * @param {string} [p.summary]  short human description
 * @param {object} [p.logger]   context (for warn on failure)
 */
export async function writeAudit({ actor, action, targetId = '-', before = null, after = null, summary = '', logger = console }) {
  try {
    const at = new Date().toISOString();
    await repo('auditLog').upsert({
      id: `${action}_${targetId}_${at}`,
      pk: 'auditLog',
      action,
      targetId: String(targetId),
      actorOid: actor?.userId || null,
      actorName: actor?.name || null,
      summary,
      before,
      after,
      at
    });
  } catch (err) {
    (logger.warn || logger.error || console.error).call(logger, `[audit] failed to log ${action}: ${err.message}`);
  }
}
