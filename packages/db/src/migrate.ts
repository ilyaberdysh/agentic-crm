// Forward-only SQL migration runner: applies packages/db/migrations/NNNN_<name>.sql in filename order.
// Applied files are recorded in schema_migrations(name, checksum). Every file not yet recorded is applied, even if
// its number is lower than an applied one (parallel number ranges per area, see CLAUDE.md), each in its own
// transaction, under an advisory lock so concurrent runners on one database serialise.
//
// CLI: tsx src/migrate.ts up|reset   (DATABASE_URL or the local default from @agentic-crm/config)
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '@agentic-crm/config';
import pg from 'pg';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const LOCK_KEY = 72_620_191; // arbitrary constant for pg_advisory_lock

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export interface MigrationInspection {
  missing: string[];
  changed: string[];
}

async function listFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
}

/** Read-only check that every committed migration is applied with its original checksum. */
export async function inspectMigrations(connectionString: string = config.databaseUrl): Promise<MigrationInspection> {
  return withClient(connectionString, async (client) => {
    const table = await client.query<{ name: string | null }>("SELECT to_regclass('public.schema_migrations') AS name");
    if (!table.rows[0]?.name) {
      return { missing: await listFiles(), changed: [] };
    }

    const done = new Map<string, string>(
      (await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')).rows.map(
        (row) => [row.name, row.checksum],
      ),
    );
    const missing: string[] = [];
    const changed: string[] = [];
    for (const file of await listFiles()) {
      const body = await readFile(`${MIGRATIONS_DIR}${file}`, 'utf8');
      const expected = createHash('sha256').update(body).digest('hex');
      const recorded = done.get(file);
      if (recorded === undefined) missing.push(file);
      else if (recorded !== expected) changed.push(file);
    }
    return { missing, changed };
  });
}

async function withClient<T>(connectionString: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString, options: '-c TimeZone=UTC' });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Applies every migration file that is not recorded yet. */
export async function migrateUp(connectionString: string = config.databaseUrl): Promise<MigrationResult> {
  return withClient(connectionString, async (client) => {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
      const done = new Map<string, string>(
        (
          await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')
        ).rows.map((r) => [r.name, r.checksum]),
      );
      const result: MigrationResult = { applied: [], skipped: [] };
      for (const file of await listFiles()) {
        const body = await readFile(`${MIGRATIONS_DIR}${file}`, 'utf8');
        const checksum = createHash('sha256').update(body).digest('hex');
        const recorded = done.get(file);
        if (recorded !== undefined) {
          if (recorded !== checksum) {
            throw new Error(
              `Migration ${file} changed after it was applied (migrations are forward-only). Add a new migration, or run reset on a dev database.`,
            );
          }
          result.skipped.push(file);
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(body);
          await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
        }
        result.applied.push(file);
      }
      return result;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  });
}

/** Drops everything (schemas public and proj) and re-applies all migrations. Development and tests only. */
export async function migrateReset(connectionString: string = config.databaseUrl): Promise<MigrationResult> {
  await withClient(connectionString, async (client) => {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await client.query('DROP SCHEMA IF EXISTS proj CASCADE');
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  });
  return migrateUp(connectionString);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const command = process.argv[2] ?? 'up';
  const run = command === 'reset' ? migrateReset : command === 'up' ? migrateUp : null;
  if (!run) {
    console.error(`usage: migrate.ts up|reset (got "${command}")`);
    process.exit(2);
  }
  run()
    .then((r) => {
      console.log(
        `migrations applied: ${r.applied.length ? r.applied.join(', ') : 'none'} (${r.skipped.length} already applied)`,
      );
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
