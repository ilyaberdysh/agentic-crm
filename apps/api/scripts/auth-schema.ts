// Prints the SQL Better Auth would run to bring DATABASE_URL in line with our auth configuration.
// Against an empty database it prints the full schema (the source of packages/db/migrations/0010_auth.sql);
// against a migrated database it should print nothing — use it to detect drift after a Better Auth upgrade.
//   DATABASE_URL=postgres://…/scratch pnpm --filter @agentic-crm/api auth:schema
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from '../src/auth/auth';
import { loadConfig } from '../src/config';
import { createKysely, createPool } from '../src/db';

const config = loadConfig();
const pool = createPool(config.databaseUrl, 2);
try {
  const auth = createAuth({ db: createKysely(pool), config });
  const { toBeCreated, toBeAdded, compileMigrations } = await getMigrations(auth.options);
  if (toBeCreated.length === 0 && toBeAdded.length === 0) {
    console.log('-- auth schema is up to date');
  } else {
    console.log(await compileMigrations());
  }
} finally {
  await pool.end();
}
