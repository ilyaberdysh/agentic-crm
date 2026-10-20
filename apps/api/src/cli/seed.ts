// Seeds the demo workspace (see src/seed/demo.ts). Run through `pnpm seed` (packages/db/src/seed.ts applies the
// migrations first), or directly: `pnpm --filter @agentic-crm/api exec tsx src/cli/seed.ts`.
//   SEED_USERS="ilya@mymeet.ai:Ilya,anna@mymeet.ai:Anna"   team accounts (default: ilya@ and team@mymeet.ai)
//   SEED_WORKSPACE_SLUG=mymeet                               workspace handle
// Passwords of newly created accounts are generated and printed once; existing accounts keep theirs.
import { createDb } from '@agentic-crm/db';
import { createDomain } from '@agentic-crm/domain';
import { createAuth } from '../auth/auth';
import { loadConfig } from '../config';
import { createKysely, createPool } from '../db';
import { parseSeedUsers, seedDemo } from '../seed/demo';

const config = loadConfig({ logLevel: 'warn' });
const pool = createPool(config.databaseUrl, 2);
const database = createDb({ connectionString: config.databaseUrl, max: 4, applicationName: 'agentic-crm-seed' });
try {
  const users = parseSeedUsers(process.env.SEED_USERS);
  const result = await seedDemo(
    { domain: createDomain({ database }), auth: createAuth({ db: createKysely(pool), config }) },
    { users, workspaceSlug: process.env.SEED_WORKSPACE_SLUG?.trim() || 'mymeet' },
  );
  const where = new URL(config.databaseUrl);
  console.log(
    `Seeded workspace "${result.workspace.slug}" (${result.workspace.id}) in database ${where.pathname.slice(1)}`,
  );
  console.log(
    `  ${result.counts.companies} companies, ${result.counts.people} people, ${result.counts.projects} projects, ` +
      `${result.counts.deals} deals (${result.counts.created} records created by this run)`,
  );
  console.log('Accounts:');
  for (const user of result.users) {
    console.log(
      user.password
        ? `  ${user.email}  password: ${user.password}`
        : `  ${user.email}  already existed, password unchanged (reset: pnpm --filter @agentic-crm/api user:create ${user.email} --reset-password)`,
    );
  }
  if (result.users.some((u) => u.password)) {
    console.log('Share passwords privately; they are stored hashed and cannot be shown again.');
  }
  console.log(`Sign in at ${config.webOrigin} and open /${result.workspace.slug}.`);
  console.log(
    `Agent demo (${result.agenticDemo.reviewerEmail}): ${config.webOrigin}/${result.workspace.slug}/company/${result.agenticDemo.entityInstanceId}/${result.agenticDemo.agentTabSlug}`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await database.destroy();
  await pool.end();
}
