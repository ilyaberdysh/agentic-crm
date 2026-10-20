// Fresh e2e database before the API starts: drop + create `agentic_crm_test_web_e2e`, apply migrations, seed the demo
// workspace with one team account (`pnpm seed` logic, apps/api src/cli/seed.ts) and store its generated password in
// e2e/.auth/<credentialsFile> (gitignored; one file per database so parallel stacks do not overwrite each other) for the tests.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, migrateUp, sql } from '@agentic-crm/db';
import { credentialsFile, databaseUrl, E2E_DATABASE, E2E_USER, WORKSPACE_SLUG } from './env.ts';

const here = dirname(fileURLToPath(import.meta.url));
const url = databaseUrl(E2E_DATABASE);

const admin = createDb({ connectionString: databaseUrl('postgres'), max: 1, applicationName: 'web-e2e-prepare' });
try {
  await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${E2E_DATABASE} AND pid <> pg_backend_pid()`.execute(
    admin.kysely,
  );
  await sql.raw(`DROP DATABASE IF EXISTS ${E2E_DATABASE}`).execute(admin.kysely);
  await sql.raw(`CREATE DATABASE ${E2E_DATABASE}`).execute(admin.kysely);
} finally {
  await admin.destroy();
}

const migrated = await migrateUp(url);
console.log(`[e2e] ${E2E_DATABASE}: ${migrated.applied.length} migrations applied`);

const seed = spawnSync('pnpm', ['--filter', '@agentic-crm/api', 'exec', 'tsx', 'src/cli/seed.ts'], {
  env: {
    ...process.env,
    DATABASE_URL: url,
    SEED_USERS: `${E2E_USER.email}:${E2E_USER.name}`,
    SEED_WORKSPACE_SLUG: WORKSPACE_SLUG,
  },
  encoding: 'utf8',
});
if (seed.status !== 0) {
  console.error(seed.stdout, seed.stderr);
  throw new Error('[e2e] seeding failed');
}
const match = new RegExp(`${E2E_USER.email.replace('.', '\\.')}\\s+password: (\\S+)`).exec(seed.stdout);
if (!match?.[1]) throw new Error(`[e2e] no password in seed output:\n${seed.stdout}`);

mkdirSync(join(here, '.auth'), { recursive: true });
writeFileSync(
  join(here, '.auth', credentialsFile(E2E_DATABASE)),
  `${JSON.stringify({ email: E2E_USER.email, password: match[1] }, null, 2)}\n`,
);
console.log(`[e2e] seeded workspace "${WORKSPACE_SLUG}" with ${E2E_USER.email}`);
