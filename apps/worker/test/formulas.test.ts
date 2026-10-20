// Slice 10 acceptance through the running worker:
//   5. changing a formula's dependency updates the value within 2 s (change_log subscription, no manual pump), and
//      an AI value never stays "thinking" once written (X-24);
//   6. a confirmed AI recalculation runs as jobs and the ledger records the spend.
import { randomUUID } from 'node:crypto';
import { config } from '@agentic-crm/config';
import { FakeLlm, memberContext, S3Storage, type ServiceContext } from '@agentic-crm/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.ts';
import { startWorker, type Worker } from '../src/worker.ts';
import { databaseUrl, TEST_DATABASE } from './env.ts';

const storage = new S3Storage({ ...config.s3, bucket: TEST_DATABASE.replace(/_/g, '-') });
const log = createLogger('error', 'worker-formulas-test', () => {});
const llm = new FakeLlm().when((r) => r.purpose === 'ai-attribute', { text: 'A rocket company.' });

let worker: Worker;
let db: pg.Pool;
let ctx: ServiceContext;
let memberId: string;

async function until<T>(probe: () => Promise<T> | T, done: (v: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  worker = await startWorker({
    databaseUrl: databaseUrl(),
    storage,
    log,
    pollingIntervalSeconds: 0.5,
    healthIntervalMs: 0,
    webhookIntervalMs: 0,
    workflowIntervalMs: 0,
    llm,
  });
  db = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
  const userId = randomUUID();
  const email = `fx-${userId.slice(0, 8)}@example.com`;
  await db.query(`INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Fran Formula', $2, true)`, [
    userId,
    email,
  ]);
  const ws = await worker.domain.workspaces.create(
    { userId, emailAddress: email, firstName: 'Fran', lastName: 'Formula' },
    { name: 'Formulas', slug: `fx-${userId.slice(0, 8)}` },
  );
  memberId = ws.membership.id;
  ctx = memberContext(ws.id, memberId);
});

afterAll(async () => {
  await worker?.stop();
  await db?.end();
});

describe('formula recompute in the worker', () => {
  it('updates a formula value within 2 s of a dependency change (acceptance 5)', async () => {
    const d = worker.domain;
    const object = await d.schema.createObject(ctx, {
      id: randomUUID(),
      apiSlug: 'deals_fx',
      singularNoun: 'Deal',
      pluralNoun: 'Deals',
    });
    const value = await d.schema.createAttribute(ctx, {
      id: randomUUID(),
      entityDefinitionId: object.id,
      title: 'Value',
      type: 'currency',
    });
    const seats = await d.schema.createAttribute(ctx, {
      id: randomUUID(),
      entityDefinitionId: object.id,
      title: 'Seats',
      type: 'number',
    });
    const recordId = randomUUID();
    await d.records.create(ctx, {
      entityDefinitionId: object.id,
      entityInstanceId: recordId,
      values: { [value.id]: [{ value: { currencyValue: 1200 } }], [seats.id]: [{ value: 10 }] },
    });
    const perSeat = await d.schema.createAttribute(ctx, {
      id: randomUUID(),
      entityDefinitionId: object.id,
      title: 'Value per seat',
      type: 'number',
      formulaConfiguration: {
        snapshotId: randomUUID(),
        plaintext: '_ / _',
        annotations: [
          {
            type: 'entity-variable',
            startPosition: 0,
            length: 1,
            path: [{ entityDefinitionId: object.id, attributeDefinitionId: value.id }],
            field: 'raw_value',
          },
          {
            type: 'entity-variable',
            startPosition: 4,
            length: 1,
            path: [{ entityDefinitionId: object.id, attributeDefinitionId: seats.id }],
            field: null,
          },
        ],
      },
    });
    const read = async () =>
      (await d.records.get(ctx, { entityDefinitionId: object.id, entityInstanceId: recordId })).values[perSeat.id]?.[0]
        ?.value ?? null;
    await until(read, (v) => v === 120, 10_000);

    for (const [seatsValue, expected] of [
      [24, 50],
      [40, 30],
    ] as const) {
      const started = Date.now();
      await d.records.update(ctx, {
        entityDefinitionId: object.id,
        entityInstanceId: recordId,
        values: { [seats.id]: [{ value: seatsValue }] },
      });
      await until(read, (v) => v === expected, 5_000);
      expect(Date.now() - started).toBeLessThan(2_000);
    }
    const ann = await d.formulas.annotations(ctx, {
      entityDefinitionId: object.id,
      attributeDefinitionId: perSeat.id,
      entityInstanceIds: [recordId],
    });
    expect(ann[recordId]?.formula?.state).toBe('value');
  });

  it('runs a confirmed AI recalculation as jobs: values written, never left thinking, spend in the ledger (6)', async () => {
    const d = worker.domain;
    const companies = await d.schema.getObject(ctx, 'companies');
    const name = (await d.schema.listAttributes(ctx, { entityDefinitionId: companies.id })).find(
      (a) => a.apiSlug === 'name',
    );
    const summary = await d.schema.createAttribute(ctx, {
      id: randomUUID(),
      entityDefinitionId: companies.id,
      title: 'AI summary',
      type: 'text',
      aiAutofillConfiguration: { type: 'summarize-record' },
    });
    const ids: string[] = [];
    for (const n of ['Acme', 'Globex']) {
      const id = randomUUID();
      await d.records.create(ctx, {
        entityDefinitionId: companies.id,
        entityInstanceId: id,
        values: { [name?.id as string]: [{ value: n }] },
      });
      ids.push(id);
    }
    const target = { type: 'records' as const, entityInstanceIds: ids };
    const estimate = await d.aiAttributes.estimate(ctx, {
      entityDefinitionId: companies.id,
      attributeDefinitionId: summary.id,
      target,
    });
    expect(estimate).toMatchObject({ recordCount: 2, credits: 2 });
    const run = await d.aiAttributes.run(ctx, {
      entityDefinitionId: companies.id,
      attributeDefinitionId: summary.id,
      target,
    });
    const annotations = () =>
      d.aiAttributes.annotations(ctx, {
        entityDefinitionId: companies.id,
        attributeDefinitionId: summary.id,
        entityInstanceIds: ids,
      });
    const done = await until(annotations, (a) => ids.every((id) => a[id]?.aiAutofill?.status === 'complete'), 20_000);
    expect(Object.values(done).every((a) => a.aiAutofill?.thinking === false)).toBe(true);
    for (const id of ids) {
      const rec = await d.records.get(ctx, { entityDefinitionId: companies.id, entityInstanceId: id });
      expect(rec.values[summary.id]?.[0]?.value).toBe('A rocket company.');
    }
    expect(run.credits).toBe(2);
    // The spend is in the credits ledger: 1 credit per value, the workspace pool, attributed to the requester.
    const { rows } = await db.query(
      `SELECT source, credits::int AS credits, member_id, spend, ref_id FROM credit_ledger
       WHERE source = 'ai-attribute' AND ref_id = ANY($1::uuid[]) ORDER BY ref_id`,
      [ids],
    );
    expect(rows.map((r) => [r.source, r.credits, r.member_id, r.spend])).toEqual([
      ['ai-attribute', 1, memberId, 'workspace'],
      ['ai-attribute', 1, memberId, 'workspace'],
    ]);
    const usage = await d.credits.usage(ctx, {});
    expect(usage.bySource.find((s) => s.source === 'ai-attribute')?.credits).toBe(2);
  });
});
