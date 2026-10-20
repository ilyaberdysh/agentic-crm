// Reporting performance (BACKLOG 9.04: "run against a seeded 100k-record dataset with history and document p95 per
// query type"). Opt-in, it seeds 100k deals:
//   AGENTIC_CRMPORTS_PERF=1 pnpm --filter @agentic-crm/domain exec vitest run test/reports-perf.test.ts
// Data (bulk SQL, deterministic): 100k deals created over two years, each with 1–4 status values progressing
// Lead → Qualified → Proposal → Won/Lost (≈ 250k status rows), an amount (30 % changed once), priority, 0–2 tags,
// close date, signed-at timestamp, owner and a company (2,000 companies). The projection is rebuilt from the EAV and
// the tables analysed. Every query goes end to end through domain.reporting.dataset (one workspace transaction,
// permission checks, labels, freshness), after two warm-up runs. Results: research/architecture/decisions/slice9-server.md.
import type { DatasetInput } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { type DealsFixture, dealsFixture } from './reports-fixtures.ts';
import { database, domain, newId } from './support/harness.ts';

const ENABLED = process.env.AGENTIC_CRMPORTS_PERF === '1';
const DEALS = Number(process.env.AGENTIC_CRMPORTS_PERF_DEALS ?? 100_000);
const COMPANIES = 2_000;
const ROUNDS = Number(process.env.AGENTIC_CRMPORTS_PERF_ROUNDS ?? 20);

let f: DealsFixture;

type Exec = (text: string) => Promise<void>;

async function seed(): Promise<void> {
  // One transaction: the temp tables live in its connection.
  await database.kysely.transaction().execute(async (trx) => {
    const exec: Exec = async (text) => {
      await sql.raw(text).execute(trx);
    };
    await seedRows(exec);
  });
  await domain.schema.rebuildProjection(f.ctx, f.companies);
  await domain.schema.rebuildProjection(f.ctx, f.deals);
  // A steady-state database: visibility maps set (index-only scans) and statistics current.
  await sql.raw('VACUUM ANALYZE attribute_values').execute(database.kysely);
  await sql.raw('VACUUM ANALYZE entity_instances').execute(database.kysely);
  const { rows } = await sql<{
    table: string;
  }>`SELECT projection_table AS table FROM entity_definitions WHERE id = ${f.deals}::uuid`.execute(database.kysely);
  await sql.raw(`VACUUM ANALYZE proj."${rows[0]?.table}"`).execute(database.kysely);
}

async function seedRows(exec: Exec): Promise<void> {
  const ws = `'${f.workspaceId}'::uuid`;
  const deals = `'${f.deals}'::uuid`;
  const companies = `'${f.companies}'::uuid`;
  const a = (k: keyof DealsFixture['attrs']) => `'${f.attrs[k]}'::uuid`;
  const companyName = (await domain.schema.getAttribute(f.ctx, 'companies', 'name')).id;
  const s = f.stages;
  const o = f.options;
  await exec('SET LOCAL synchronous_commit = off');
  // Companies.
  await exec(`
    CREATE TEMP TABLE perf_companies AS
      SELECT uuidv7() AS id, n FROM generate_series(1, ${COMPANIES}) n;
    INSERT INTO entity_instances (id, workspace_id, entity_definition_id, created_at, created_by_type)
      SELECT id, ${ws}, ${companies}, now() - interval '3 years', 3 FROM perf_companies;
    INSERT INTO attribute_values (id, workspace_id, entity_definition_id, instance_id, attribute_id, active_from,
        created_by_type, v_text, sort_key)
      SELECT uuidv7(), ${ws}, ${companies}, id, '${companyName}'::uuid, now() - interval '3 years', 3,
        'Company ' || n, norm_key('Company ' || n) FROM perf_companies;`);
  // Deals: created over the last two years.
  await exec(`
    CREATE TEMP TABLE perf_deals AS
      SELECT uuidv7() AS id, n, now() - (interval '730 days') * ((hashint4(n) & 1023) / 1024.0) AS created_at,
        abs(hashint4(n * 7)) AS h FROM generate_series(1, ${DEALS}) n;
    INSERT INTO entity_instances (id, workspace_id, entity_definition_id, created_at, created_by_type)
      SELECT id, ${ws}, ${deals}, created_at, 3 FROM perf_deals;`);
  const value = (attr: keyof DealsFixture['attrs'], cols: string, select: string, where = 'TRUE') => `
    INSERT INTO attribute_values (id, workspace_id, entity_definition_id, instance_id, attribute_id, active_from,
        created_by_type, ${cols})
      SELECT uuidv7(), ${ws}, ${deals}, d.id, ${a(attr)}, d.created_at, 3, ${select} FROM perf_deals d WHERE ${where};`;
  await exec(value('name', 'v_text, sort_key', `'Deal ' || d.n, norm_key('Deal ' || d.n)`));
  await exec(
    value(
      'priority',
      'v_ref',
      `CASE WHEN d.h % 3 = 0 THEN '${o.high}'::uuid ELSE '${o.low}'::uuid END`,
      'd.h % 10 < 7',
    ),
  );
  await exec(value('tags', 'v_ref, sort_order', `'${o.alpha}'::uuid, 'a'`, 'd.h % 4 IN (1, 3)'));
  await exec(value('tags', 'v_ref, sort_order', `'${o.beta}'::uuid, 'b'`, 'd.h % 4 IN (2, 3)'));
  await exec(value('close', 'v_date', `(d.created_at + interval '1 day' * (d.h % 120))::date`, 'd.h % 5 <> 0'));
  await exec(value('signed', 'v_ts', `d.created_at + interval '1 hour' * (d.h % 2000)`, 'd.h % 2 = 0'));
  await exec(value('owner', 'v_ref, v_text', `'${f.memberId}'::uuid, 'workspace-member'`, 'd.h % 5 <> 1'));
  await exec(`
    INSERT INTO attribute_values (id, workspace_id, entity_definition_id, instance_id, attribute_id, active_from,
        created_by_type, v_ref, v_ref_def)
      SELECT uuidv7(), ${ws}, ${deals}, d.id, ${a('company')}, d.created_at, 3, c.id, ${companies}
      FROM perf_deals d JOIN perf_companies c ON c.n = 1 + d.h % ${COMPANIES};`);
  // Amount: 30 % changed once, 20 days after creation (if that is in the past).
  await exec(`
    INSERT INTO attribute_values (id, workspace_id, entity_definition_id, instance_id, attribute_id, active_from,
        active_until, created_by_type, v_num)
      SELECT uuidv7(), ${ws}, ${deals}, d.id, ${a('amount')}, d.created_at,
        CASE WHEN d.h % 10 < 3 AND d.created_at + interval '20 days' < now() THEN d.created_at + interval '20 days' END,
        3, 1000 + (d.h % 100) * 100
      FROM perf_deals d;
    INSERT INTO attribute_values (id, workspace_id, entity_definition_id, instance_id, attribute_id, active_from,
        created_by_type, v_num)
      SELECT uuidv7(), ${ws}, ${deals}, d.id, ${a('amount')}, d.created_at + interval '20 days', 3,
        2000 + (d.h % 100) * 150
      FROM perf_deals d WHERE d.h % 10 < 3 AND d.created_at + interval '20 days' < now();`);
  // Status history: steps 0..k at created_at + j × (3..32 days); the last past step is current.
  await exec(`
    CREATE TEMP TABLE perf_steps AS
      SELECT d.id, j, CASE j WHEN 0 THEN '${s.lead}'::uuid WHEN 1 THEN '${s.qualified}'::uuid
                             WHEN 2 THEN '${s.proposal}'::uuid
                             ELSE CASE WHEN d.h % 2 = 0 THEN '${s.won}'::uuid ELSE '${s.lost}'::uuid END END AS stage,
        d.created_at + interval '1 day' * j * (3 + d.h % 30) AS t
      FROM perf_deals d CROSS JOIN LATERAL generate_series(0, d.h % 4) AS j
      WHERE d.created_at + interval '1 day' * j * (3 + d.h % 30) < now();
    INSERT INTO attribute_values (id, workspace_id, entity_definition_id, instance_id, attribute_id, active_from,
        active_until, created_by_type, v_ref)
      SELECT uuidv7(), ${ws}, ${deals}, id, ${a('stage')}, t, lead(t) OVER (PARTITION BY id ORDER BY j), 3, stage
      FROM perf_steps;`);
}

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)] as number;
}

const results: { name: string; p50: number; p95: number; rows: number }[] = [];

type Query = DatasetInput extends infer T ? (T extends unknown ? Omit<T, 'entityDefinitionId'> : never) : never;

async function measure(name: string, input: Query) {
  const full = { entityDefinitionId: f.deals, ...input } as DatasetInput;
  let rows = 0;
  for (let i = 0; i < 2; i++) rows = (await domain.reporting.dataset(f.ctx, full)).rows.length;
  const times: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = performance.now();
    await domain.reporting.dataset(f.ctx, full);
    times.push(performance.now() - t0);
  }
  times.sort((x, y) => x - y);
  const r = { name, p50: Math.round(percentile(times, 50)), p95: Math.round(percentile(times, 95)), rows };
  results.push(r);
  console.log(
    `${name.padEnd(58)} p50 ${String(r.p50).padStart(5)} ms  p95 ${String(r.p95).padStart(5)} ms  rows ${rows}`,
  );
  return r;
}

describe.runIf(ENABLED)('reporting at 100k records', () => {
  beforeAll(async () => {
    f = await dealsFixture();
    const t0 = performance.now();
    await seed();
    const counts = await sql<{ instances: string; values: string }>`
      SELECT (SELECT count(*) FROM entity_instances WHERE entity_definition_id = ${f.deals}::uuid) AS instances,
             (SELECT count(*) FROM attribute_values WHERE entity_definition_id = ${f.deals}::uuid) AS values`.execute(
      database.kysely,
    );
    console.log(
      `seeded ${counts.rows[0]?.instances} deals / ${counts.rows[0]?.values} value rows in ${Math.round(performance.now() - t0)} ms`,
    );
  }, 1_800_000);

  it('measures every query type', async () => {
    const stage = { path: f.path('stage') };
    const amount = { type: 'attribute' as const, path: f.path('amount'), aggregation: 'sum' as const };
    const today = new Date().toISOString().slice(0, 10);
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const halfYear = new Date(Date.now() - 182 * 86_400_000).toISOString().slice(0, 10);
    const high = {
      path: f.path('priority'),
      mode: 'must' as const,
      constraints: [{ field: 'select_option_id', operator: 'eq' as const, value: f.options.high }],
    };
    await measure('insight: count (single metric)', { type: 'pivot' });
    await measure('insight: sum(amount) by stage', { type: 'pivot', metric: amount, primaryGrouping: stage });
    await measure('insight: count by stage × priority', {
      type: 'pivot',
      primaryGrouping: stage,
      secondaryGrouping: { path: f.path('priority') },
    });
    await measure('insight: median(amount) by stage, filter priority=High', {
      type: 'pivot',
      filter: high,
      metric: { ...amount, aggregation: 'median' },
      primaryGrouping: stage,
    });
    await measure('insight: count by close date, monthly', {
      type: 'pivot',
      primaryGrouping: { path: f.path('close') },
      timeConfig: { resolution: 'month' },
    });
    await measure('insight: count by signed at, weekly, Europe/Moscow', {
      type: 'pivot',
      primaryGrouping: { path: f.path('signed') },
      timeConfig: { resolution: 'week' },
      timeZone: 'Europe/Moscow',
    });
    await measure('insight: count by tags (multi-select)', {
      type: 'pivot',
      primaryGrouping: { path: f.path('tags') },
    });
    await measure('insight: sum(amount) by company name (path, 2k groups)', {
      type: 'pivot',
      metric: amount,
      primaryGrouping: { path: await f.companyName() },
    });
    await measure('historical: count by stage, monthly, 12M', {
      type: 'pivot',
      variant: 'historical',
      primaryGrouping: stage,
      timeConfig: { resolution: 'month', start: yearAgo, end: today },
    });
    await measure('historical: count by stage, monthly, All (25 buckets)', {
      type: 'pivot',
      variant: 'historical',
      primaryGrouping: stage,
      timeConfig: { resolution: 'month' },
    });
    await measure('historical: sum(amount) historic, monthly, All', {
      type: 'pivot',
      variant: 'historical',
      metric: amount,
      timeConfig: { resolution: 'month' },
    });
    await measure('historical: sum(amount) by stage, weekly, 6M', {
      type: 'pivot',
      variant: 'historical',
      metric: amount,
      primaryGrouping: stage,
      timeConfig: { resolution: 'week', start: halfYear, end: today },
    });
    await measure('historical: max(amount) (unwind), monthly, 12M', {
      type: 'pivot',
      variant: 'historical',
      metric: { ...amount, aggregation: 'max' },
      timeConfig: { resolution: 'month', start: yearAgo, end: today },
    });
    await measure('historical: count by stage + comparison (12M vs prior 12M)', {
      type: 'pivot',
      variant: 'historical',
      primaryGrouping: stage,
      timeConfig: {
        resolution: 'month',
        start: yearAgo,
        end: today,
        comparison: { start: new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10), end: yearAgo },
      },
    });
    await measure('stage changed: count by stage, monthly, All', {
      type: 'pivot',
      variant: 'stage-changed',
      statusAttributePath: f.path('stage'),
      timeConfig: { resolution: 'month' },
    });
    const allStages = [f.stages.lead, f.stages.qualified, f.stages.proposal, f.stages.won];
    await measure('funnel: 4 stages + All records', {
      type: 'funnel',
      statusAttributePath: f.path('stage'),
      stageIds: allStages,
      includeAllRecords: true,
    });
    await measure('funnel metric: sum(amount), 4 stages', {
      type: 'funnel-metric',
      statusAttributePath: f.path('stage'),
      stageIds: allStages,
      metric: amount,
    });
    await measure('time in stage: mean, all stages', { type: 'time-in-stage', statusAttributePath: f.path('stage') });
    await measure('time in stage: median by priority, filter priority=High', {
      type: 'time-in-stage',
      filter: high,
      statusAttributePath: f.path('stage'),
      aggregation: 'median',
      primaryGrouping: { path: f.path('priority') },
    });
    // Write path overhead of report-stale (a report depends on the stage).
    const dashboard = (await domain.dashboards.create(f.ctx, { id: newId() })).dashboard;
    await domain.reports.create(f.ctx, {
      id: newId(),
      cellId: newId(),
      dashboardId: dashboard.id,
      entityDefinitionId: f.deals,
      reportType: 'insights',
      settings: { primaryGrouping: { attributePath: f.path('stage') } },
    });
    const ids = (
      await sql<{
        id: string;
      }>`SELECT id FROM entity_instances WHERE entity_definition_id = ${f.deals}::uuid LIMIT 50`.execute(
        database.kysely,
      )
    ).rows.map((r) => r.id);
    const writes: number[] = [];
    for (const [i, id] of ids.entries()) {
      const t0 = performance.now();
      await domain.values.put(f.ctx, {
        entityDefinitionId: f.deals,
        entityInstanceId: id,
        attributeDefinitionId: f.attrs.stage,
        attributeValueId: newId(),
        value: { pipelineStageId: i % 2 ? f.stages.won : f.stages.qualified },
      });
      writes.push(performance.now() - t0);
    }
    writes.sort((x, y) => x - y);
    console.log(
      `${'write: values.put on a reported attribute (+ report-stale)'.padEnd(58)} p50 ${String(Math.round(percentile(writes, 50))).padStart(5)} ms  p95 ${String(Math.round(percentile(writes, 95))).padStart(5)} ms`,
    );
    console.table(results);
    expect(results.every((r) => r.p95 < 5_000)).toBe(true);
  }, 1_800_000);
});
