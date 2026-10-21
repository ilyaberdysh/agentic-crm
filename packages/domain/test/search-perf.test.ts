// Search performance check (BACKLOG 5.01: p95 < 150 ms on a 100k-record workspace). Opt-in, it seeds 100k records:
//   AGENTIC_CRM_SEARCH_PERF=1 AGENTIC_CRM_TEST_DB_PREFIX=agentic_crm_test_s5srv_ pnpm --filter @agentic-crm/domain exec vitest run test/search-perf.test.ts
// Records are bulk-inserted with SQL (50k companies with name, domain, description, location, LinkedIn handle; 50k
// people with name, email, phone, description) — the write path would take minutes — and indexed with the same
// search_index_refresh() the write path calls. Latency is measured end to end through domain.search.records (one
// workspace transaction per query, list memberships included) for a mix of query shapes, after one warm-up round.
import { sql } from '@agentic-crm/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, database, domain, type TestWorkspace } from './support/harness.ts';

const ENABLED = process.env.AGENTIC_CRM_SEARCH_PERF === '1';
const COMPANIES = Number(process.env.AGENTIC_CRM_SEARCH_PERF_COMPANIES ?? 50_000);
const PEOPLE = Number(process.env.AGENTIC_CRM_SEARCH_PERF_PEOPLE ?? 50_000);
const ROUNDS = Number(process.env.AGENTIC_CRM_SEARCH_PERF_ROUNDS ?? 20);

const FIRST = [
  'John',
  'Mary',
  'Ivan',
  'Olga',
  'Ada',
  'Grace',
  'Alan',
  'Linus',
  'Sofia',
  'Pavel',
  'Anna',
  'Tom',
  'Elena',
  'Max',
  'Nina',
  'Oscar',
  'Rita',
  'Sam',
  'Vera',
  'Yuri',
];
const LAST = [
  'Smith',
  'Petrov',
  'Lovelace',
  'Hopper',
  'Turing',
  'Torvalds',
  'Ivanova',
  'Garcia',
  'Müller',
  'Novak',
  'Kim',
  'Chen',
  'Brown',
  'Wilson',
  'Sokolov',
  'Fischer',
  'Rossi',
  'Dubois',
  'Larsen',
  'Kowalski',
];
const ADJ = [
  'Blue',
  'Red',
  'Bright',
  'Silent',
  'Rapid',
  'Golden',
  'North',
  'Quantum',
  'Green',
  'Iron',
  'Lunar',
  'Prime',
  'Clear',
  'Deep',
  'Solar',
  'Urban',
  'Wild',
  'Crystal',
  'Open',
  'Smart',
];
const NOUN = [
  'River',
  'Peak',
  'Forge',
  'Harbor',
  'Pixel',
  'Signal',
  'Orbit',
  'Field',
  'Bridge',
  'Stone',
  'Cloud',
  'Leaf',
  'Wave',
  'Spark',
  'Grid',
  'Path',
  'Tower',
  'Labs',
  'Works',
  'Systems',
];
const SUFFIX = ['Labs', 'Inc', 'Group', 'Partners', 'Analytics', 'Robotics', 'Capital', 'Health', 'Media', 'Studio'];
const WORDS = [
  'analytics',
  'platform',
  'payments',
  'logistics',
  'marketplace',
  'security',
  'biotech',
  'hardware',
  'education',
  'insurance',
  'travel',
  'energy',
  'retail',
  'gaming',
  'climate',
  'mobility',
  'fintech',
  'legal',
  'recruiting',
  'design',
];
const CITIES = ['London', 'Berlin', 'Austin', 'Moscow', 'Paris', 'Lisbon', 'Tallinn', 'Warsaw', 'Dubai', 'Tokyo'];

let ws: TestWorkspace;

async function attrIds(slug: string): Promise<Record<string, string>> {
  const { rows } = await sql<{ api_slug: string; id: string }>`
    SELECT a.api_slug, a.id FROM attribute_definitions a JOIN entity_definitions d ON d.id = a.entity_definition_id
    WHERE d.workspace_id = ${ws.workspaceId}::uuid AND d.api_slug = ${slug}`.execute(database.kysely);
  return Object.fromEntries(rows.map((r) => [r.api_slug, r.id]));
}

async function seed(): Promise<void> {
  const db = database.kysely;
  const [companies, people] = await Promise.all(
    ['companies', 'people'].map((slug) => domain.schema.getObject(ws.ctx, slug)),
  );
  const c = await attrIds('companies');
  const p = await attrIds('people');
  const pick = (arr: string[], expr: string) =>
    `(ARRAY[${arr.map((w) => `'${w}'`).join(',')}])[1 + (${expr}) % ${arr.length}]`;
  const t0 = Date.now();
  // Companies: name "<Adj> <Noun> <Suffix>", domain "<adj><noun><n>.com", description, location, LinkedIn.
  await sql
    .raw(`
    INSERT INTO entity_instances (id, workspace_id, entity_definition_id, created_at, created_by_type)
    SELECT uuidv7(), '${ws.workspaceId}', '${companies?.id}', now() - (g || ' minutes')::interval, 3
    FROM generate_series(1, ${COMPANIES}) g`)
    .execute(db);
  await sql
    .raw(`
    WITH i AS (
      SELECT id, row_number() OVER (ORDER BY id) AS n FROM entity_instances WHERE entity_definition_id = '${companies?.id}'
    ), named AS (
      SELECT id, n, ${pick(ADJ, 'n')} AS adj, ${pick(NOUN, 'n / 20')} AS noun, ${pick(SUFFIX, 'n / 400')} AS suffix,
        ${pick(WORDS, 'n * 7')} AS w1, ${pick(WORDS, 'n * 13 + 3')} AS w2, ${pick(CITIES, 'n * 3')} AS city
      FROM i
    )
    INSERT INTO attribute_values (id, workspace_id, entity_definition_id, instance_id, attribute_id, active_from,
      created_by_type, v_text, v_json, sort_key, sort_order)
    SELECT uuidv7(), '${ws.workspaceId}', '${companies?.id}', id, a.attr, now(), 3, a.t, a.j, left(norm_key(coalesce(a.k, a.t)), 128), a.so
    FROM named, LATERAL (VALUES
      ('${c.name}'::uuid, adj || ' ' || noun || ' ' || suffix, NULL::jsonb, NULL::text, NULL::text),
      ('${c.domains}'::uuid, lower(adj || noun) || n || '.com', jsonb_build_object('rootDomain', lower(adj || noun) || n || '.com'), NULL, 'a0'),
      ('${c.description}'::uuid, 'We build ' || w1 || ' and ' || w2 || ' software for ' || city || ' teams', NULL, NULL, NULL),
      ('${c.primary_location}'::uuid, NULL, jsonb_build_object('locality', city, 'countryCode', 'GB'), city, NULL),
      ('${c.linkedin}'::uuid, 'https://www.linkedin.com/company/' || lower(adj || '-' || noun) || '-' || n, NULL, NULL, NULL)
    ) AS a(attr, t, j, k, so)`)
    .execute(db);
  // People: name "<First> <Last>", email "first.last<n>@<company domain>", phone "+1 555 <7 digits>", description.
  await sql
    .raw(`
    INSERT INTO entity_instances (id, workspace_id, entity_definition_id, created_at, created_by_type)
    SELECT uuidv7(), '${ws.workspaceId}', '${people?.id}', now() - (g || ' minutes')::interval, 3
    FROM generate_series(1, ${PEOPLE}) g`)
    .execute(db);
  await sql
    .raw(`
    WITH i AS (
      SELECT id, row_number() OVER (ORDER BY id) AS n FROM entity_instances WHERE entity_definition_id = '${people?.id}'
    ), named AS (
      SELECT id, n, ${pick(FIRST, 'n')} AS f, ${pick(LAST, 'n / 20')} AS l, ${pick(WORDS, 'n * 11')} AS w
      FROM i
    )
    INSERT INTO attribute_values (id, workspace_id, entity_definition_id, instance_id, attribute_id, active_from,
      created_by_type, v_text, v_json, sort_key, sort_order)
    SELECT uuidv7(), '${ws.workspaceId}', '${people?.id}', id, a.attr, now(), 3, a.t, a.j, left(norm_key(a.t), 128), a.so
    FROM named, LATERAL (VALUES
      ('${p.name}'::uuid, f || ' ' || l, jsonb_build_object('firstName', f, 'lastName', l), NULL::text),
      ('${p.email_addresses}'::uuid, lower(norm_key(f) || '.' || norm_key(l)) || n || '@example' || (n % 500) || '.com', NULL, 'a0'),
      ('${p.phone_numbers}'::uuid, '+1555' || lpad((1000000 + n)::text, 7, '0'), jsonb_build_object('countryCode', 'US'), 'a0'),
      ('${p.description}'::uuid, 'Works on ' || w || ' at a company in ' || ${pick(CITIES, 'n * 7')}, NULL, NULL)
    ) AS a(attr, t, j, so)`)
    .execute(db);
  const loaded = Date.now();
  // Index in batches with the write path's function.
  const ids = (
    await sql<{
      id: string;
    }>`SELECT id FROM entity_instances WHERE workspace_id = ${ws.workspaceId}::uuid ORDER BY id`.execute(db)
  ).rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 5000) {
    await sql`SELECT search_index_refresh(${ids.slice(i, i + 5000)}::uuid[], NULL)`.execute(db);
  }
  await sql`ANALYZE search_index`.execute(db);
  await sql`ANALYZE attribute_values`.execute(db);
  console.log(`seeded ${ids.length} records: load ${loaded - t0} ms, index ${Date.now() - loaded} ms`);
}

const QUERIES: Record<string, string[]> = {
  'empty (default set)': [''],
  '1 char': ['a', 's', 'm'],
  '2 chars': ['jo', 'bl', 'pe'],
  'prefix 3–5': ['blu', 'river', 'lovel', 'quant'],
  'full name': ['John Smith', 'Blue River Labs', 'Ivan Petrov'],
  'any word order': ['smith john', 'labs river'],
  email: ['john.smith', 'mary.lovelace41@example41.com'],
  domain: ['bluepeak', 'redforge41.com'],
  phone: ['+1 555 100 0042', '5551000'],
  'description / location': ['analytics', 'tallinn'],
  typo: ['jonh smiht', 'lovelcae'],
  'no match': ['zzqxv', 'qwertyuiop'],
};

describe.skipIf(!ENABLED)('search performance (100k records)', () => {
  beforeAll(async () => {
    ws = await createWorkspace('Search perf');
    await seed();
  }, 900_000);

  it('answers every query shape with p95 < 150 ms', async () => {
    const all: number[] = [];
    const report: string[] = [];
    const time = async (query: string) => {
      const t = performance.now();
      const out = await domain.search.records(ws.ctx, { query, requestSeq: 1 });
      return { ms: performance.now() - t, hits: out.hits.length };
    };
    for (const list of Object.values(QUERIES)) for (const q of list) await time(q); // warm-up
    for (const [shape, list] of Object.entries(QUERIES)) {
      const samples: number[] = [];
      let hits = 0;
      for (let r = 0; r < ROUNDS; r++) {
        for (const q of list) {
          const res = await time(q);
          samples.push(res.ms);
          hits = Math.max(hits, res.hits);
        }
      }
      samples.sort((a, b) => a - b);
      const pct = (p: number) => samples[Math.min(samples.length - 1, Math.floor(p * samples.length))] as number;
      report.push(
        `| ${shape} | ${samples.length} | ${pct(0.5).toFixed(1)} | ${pct(0.95).toFixed(1)} | ${(samples.at(-1) as number).toFixed(1)} | ${hits} |`,
      );
      all.push(...samples);
    }
    all.sort((a, b) => a - b);
    const p95 = all[Math.floor(0.95 * all.length)] as number;
    const p50 = all[Math.floor(0.5 * all.length)] as number;
    console.log(
      ['| Query shape | n | p50 ms | p95 ms | max ms | hits |', '|---|---|---|---|---|---|', ...report].join('\n'),
    );
    console.log(`overall: n=${all.length} p50=${p50.toFixed(1)} ms p95=${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(150);
  }, 900_000);
});
