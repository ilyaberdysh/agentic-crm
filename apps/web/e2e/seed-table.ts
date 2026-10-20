// Table e2e data (table.spec.ts, table-parity.spec.ts): custom objects with many rows, seeded through the domain
// services by seed-big.ts. Idempotent (stable ids), so every spec that needs them can call it.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_DATABASE } from './env.ts';

const here = dirname(fileURLToPath(import.meta.url));

const OBJECTS = [
  ['big_records', '1933', 'Big record', 'Big records'],
  ['bulk_records', '30', 'Bulk record', 'Bulk records'],
] as const;

export function seedTableObjects(): void {
  for (const [slug, count, singular, plural] of OBJECTS) {
    const run = spawnSync(
      'pnpm',
      [
        '--filter',
        '@agentic-crm/api',
        'exec',
        'tsx',
        join(here, 'seed-big.ts'),
        ...['--db', E2E_DATABASE, '--slug', slug, '--count', count, '--singular', singular, '--plural', plural],
      ],
      { env: process.env, encoding: 'utf8' },
    );
    if (run.status !== 0) {
      console.error(run.stdout, run.stderr);
      throw new Error(`[e2e] seeding ${slug} failed`);
    }
  }
}
