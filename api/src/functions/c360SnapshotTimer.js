// Timer: nightly c360 snapshot job (plan step C2).
//
// Materializes each rollup in c360Rollups.js into the `c360Snapshots` container
// as DE-IDENTIFIED aggregates (small cells suppressed). Dashboards + the
// assistant read these instead of hammering Fabric per request.
//
// Runs at 06:00 UTC daily. Requires alwaysOn (set in Bicep) to fire reliably.
// Mock-safe: if the dictionary isn't loaded yet, or c360 is unreachable, it logs
// and skips rather than failing the host — so deploying before C1 is harmless.
//
// Locally, the timer is disabled via AzureWebJobs.c360SnapshotTimer.Disabled in
// local.settings.json (add it) so it doesn't fire against the emulator.

import { app } from '@azure/functions';
import { repo } from '../lib/cosmos.js';
import { runRollup } from '../lib/c360Aggregate.js';
import { ROLLUPS } from '../lib/c360Rollups.js';

app.timer('c360SnapshotTimer', {
  schedule: '0 0 6 * * *',
  handler: async (_timer, context) => {
    const asOf = new Date().toISOString();
    const snapshots = repo('c360Snapshots');
    let ok = 0, failed = 0;

    for (const def of ROLLUPS) {
      try {
        const doc = await runRollup(def, asOf);
        await snapshots.upsert(doc);
        ok++;
        context.log(`[c360Snapshot] ${def.key}: ${doc.rowCount} rows (${doc.suppressedCells} cells suppressed)`);
      } catch (err) {
        failed++;
        context.warn(`[c360Snapshot] ${def.key} skipped: ${err.message}`);
      }
    }
    context.log(`[c360Snapshot] done — ${ok} ok, ${failed} skipped, asOf ${asOf}`);
  }
});
