// `pnpm seed`: brings the database up to date, then seeds the demo workspace.
//
// The demo data itself is written by apps/api's seed CLI (apps/api/src/seed/demo.ts): team accounts are Better Auth
// identities (apps/api) and every data write must go through the domain services (I1), which depend on this
// package — so this entry only migrates and hands over, without a package dependency cycle.
//   DATABASE_URL   target database (default: the local dev database `agentic_crm`)
//   SEED_USERS     "email:Name,email:Name" team accounts (default: ilya@mymeet.ai, team@mymeet.ai)
import { spawnSync } from 'node:child_process';
import { config } from '@agentic-crm/config';
import { migrateUp } from './migrate.ts';

const migrated = await migrateUp(config.databaseUrl);
console.log(
  `migrations applied: ${migrated.applied.length ? migrated.applied.join(', ') : 'none'} (${migrated.skipped.length} already applied)`,
);

const run = spawnSync('pnpm', ['--filter', '@agentic-crm/api', 'exec', 'tsx', 'src/cli/seed.ts'], {
  stdio: 'inherit',
  env: process.env,
});
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
