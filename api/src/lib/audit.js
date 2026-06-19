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
 * Log an access to client/PHI data to the durable `accessLog` (HIPAA §164.312(b)
 * audit controls). Unlike writeAudit, this does NOT swallow errors — callers on
 * a "granted" path should treat a logging failure as fail-closed (don't serve
 * the data if the access can't be recorded). Records the client id + outcome,
 * never the name or other PHI.
 *
 * @param {object} p
 * @param {object} p.actor      { userId } from the principal
 * @param {string} p.action     e.g. 'view-initials' | 'dw-link-followed'
 * @param {string} p.clientId
 * @param {string} p.outcome    'granted' | 'denied-scope' | 'not-found' | ...
 */
export async function logAccess({ actor, action, clientId, outcome }) {
  const at = new Date().toISOString();
  await repo('accessLog').upsert({
    id: `${actor?.userId || '?'}_${clientId}_${action}_${at}`,
    pk: 'accessLog',
    userOid: actor?.userId || null,
    action,
    clientId: String(clientId),
    outcome,
    at
  });
}

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
