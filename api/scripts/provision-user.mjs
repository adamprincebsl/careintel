// Provision (or update) a BCI user directly in Cosmos.
//
// Bootstraps the FIRST admin — the /api/admin/users endpoint requires
// admin.manage, which nobody has until this seeds it. Also handy for local dev
// (provision the mock principal so the client-detail path is testable).
//
// Usage:
//   # first prod admin (run with deploy creds / az login that can write Cosmos):
//   node scripts/provision-user.mjs --oid=<EntraObjectId> --email=adam.prince@beaconspecialized.org \
//        --name="Adam Prince" --roles=CI_Admin --scope=*
//
//   # local dev (the MOCK_PRINCIPAL oid is 'local-dev'):
//   node scripts/provision-user.mjs --oid=local-dev --email=dev@example.com \
//        --roles=CI_Admin --scope=* --dry-run
//
//   # scoped analyst (sees only these programs/states for client PII):
//   node scripts/provision-user.mjs --oid=<oid> --roles=CI_Analyst \
//        --permissions=client.viewPii --programs=12345,12346 --states=MI,OH
//
// Flags:
//   --oid=          required — Entra object id (doc id)
//   --email= --name=
//   --roles=        comma-separated system roles (CI_Admin|CI_Analyst|CI_Viewer)
//   --permissions=  comma-separated extra permission grants
//   --scope=*       full client scope; OR use --programs= / --states=
//   --programs= --states=   comma-separated scope lists
//   --dry-run       print the doc, don't write (no Cosmos needed)

import { buildUserDoc } from '../src/lib/userModel.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  if (a === '--dry-run') return ['dry-run', true];
  const eq = a.indexOf('=');
  return eq > -1 ? [a.slice(2, eq), a.slice(eq + 1)] : [a.slice(2), true];
}));

if (!args.oid) { console.error('--oid is required'); process.exit(1); }

const list = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []);
const clientScope = args.scope === '*'
  ? '*'
  : { programIds: list(args.programs), states: list(args.states) };

const doc = buildUserDoc({
  oid: args.oid,
  name: args.name,
  email: args.email,
  roles: list(args.roles),
  permissions: list(args.permissions),
  clientScope,
  now: new Date().toISOString()
});

console.error(`[provision-user] ${doc.oid}: roles=[${doc.roles}] perms=[${doc.permissions}] ` +
  `scope=${doc.clientScope === '*' ? '*' : `programs:${doc.clientScope.programIds.length}/states:${doc.clientScope.states.length}`} ` +
  `provisioned=${doc.provisioned}`);

if (args['dry-run']) {
  console.log(JSON.stringify(doc, null, 2));
  console.error('[provision-user] dry-run — nothing written.');
  process.exit(0);
}

const { repo } = await import('../src/lib/cosmos.js');
await repo('users').upsert(doc);
console.error('[provision-user] written to Cosmos `users`.');
