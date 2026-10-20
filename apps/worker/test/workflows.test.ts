// The worker's workflow loops (BACKLOG 8.06, 8.08; B.28): a record created by a member starts a run through the
// trigger fan-out and the `workflow.run` job without anyone driving the engine by hand; a Delay parks the run and the
// delayed job continues it.
import { randomUUID } from 'node:crypto';
import { config } from '@agentic-crm/config';
import { memberContext, S3Storage, type ServiceContext } from '@agentic-crm/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/log.ts';
import { startWorker, type Worker } from '../src/worker.ts';
import { databaseUrl, TEST_DATABASE } from './env.ts';

// Config tree helpers (internal-api §4), inlined: the worker does not depend on @agentic-crm/contracts.
const cfg = {
  object: (entries: Record<string, unknown>) => ({ type: 'object', entries }),
  object_: (entityDefinitionId: string) => ({ type: 'agentic-crm-object', entityDefinitionId }),
  number: (value: number) => ({ type: 'number', value }),
  text: (plaintext: string) => ({ type: 'rich-text', blocks: [{ plaintext, variables: [] }] }),
  variable: (blockId: string, outcome: string, operations: unknown[]) => ({
    type: 'variable',
    matchers: [{ id: `${blockId}:${outcome}`, blockId, outcome, operations }],
  }),
};

const storage = new S3Storage({ ...config.s3, bucket: TEST_DATABASE.replace(/_/g, '-') });
const log = createLogger('error', 'worker-workflows-test', () => {});

let worker: Worker;
let db: pg.Pool;
let ctx: ServiceContext;

async function until<T>(probe: () => Promise<T> | T, done: (v: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 100));
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
    workflowIntervalMs: 100,
  });
  db = new pg.Pool({ connectionString: databaseUrl(), max: 2 });
  const userId = randomUUID();
  const email = `flow-${userId.slice(0, 8)}@example.com`;
  await db.query(`INSERT INTO users (id, name, email, email_verified) VALUES ($1, 'Wendy Flow', $2, true)`, [
    userId,
    email,
  ]);
  const ws = await worker.domain.workspaces.create(
    { userId, emailAddress: email, firstName: 'Wendy', lastName: 'Flow' },
    { name: 'Workflows', slug: `wf-${userId.slice(0, 8)}` },
  );
  ctx = memberContext(ws.id, ws.membership.id);
});

afterAll(async () => {
  await worker?.stop();
  await db?.end();
});

async function build(
  blocks: { id: string; slug: string; config?: Record<string, unknown> }[],
  paths: [string, string, string][],
) {
  const workflowId = randomUUID();
  await worker.domain.workflows.create(ctx, { id: workflowId, title: 'Worker test' });
  for (const b of blocks) {
    await worker.domain.workflows.blocks.put(ctx, {
      workflowId,
      blockId: b.id,
      slug: b.slug,
      config: cfg.object((b.config ?? {}) as never) as never,
    });
  }
  for (const [source, outcome, target] of paths) {
    await worker.domain.workflows.blocks.connect(ctx, {
      workflowId,
      sourceBlockId: source,
      outcome,
      targetBlockId: target,
    });
  }
  await worker.domain.workflows.publish(ctx, { workflowId });
  return workflowId;
}

describe('workflow loops', () => {
  it('a record created by a member runs the workflow through the fan-out and the run job', async () => {
    const companies = await worker.domain.schema.getObject(ctx, 'companies');
    const trigger = randomUUID();
    const task = randomUUID();
    const workflowId = await build(
      [
        { id: trigger, slug: 'on-record-created', config: { object: cfg.object_(companies.id) } },
        {
          id: task,
          slug: 'create-task',
          config: {
            content: cfg.text('Research the new company'),
            references: {
              type: 'array',
              items: [cfg.variable(trigger, 'done', [{ type: 'field', name: 'entity_instance' }])],
            },
          },
        },
      ],
      [[trigger, 'done', task]],
    );
    const recordId = randomUUID();
    await worker.domain.records.create(ctx, {
      entityDefinitionId: companies.id,
      entityInstanceId: recordId,
      values: {},
    });
    const runs = await until(
      async () => (await worker.domain.workflows.runs.list(ctx, { workflowId })).runs,
      (r) => r.length === 1 && r[0]?.status === 'completed',
    );
    const detail = await worker.domain.workflows.runs.get(ctx, { runId: runs[0]?.id as string });
    const taskId = (detail.executions.find((e) => e.blockId === task)?.outputs?.created_task as { taskId: string })
      .taskId;
    const created = await worker.domain.tasks.get(ctx, taskId);
    expect(created.linkedRecords).toEqual([{ entityDefinitionId: companies.id, entityInstanceId: recordId }]);
    expect(created.createdBy).toEqual({ type: 'workflow', id: workflowId });
  });

  it('a Delay parks the run; the delayed job continues it', async () => {
    const trigger = randomUUID();
    const delay = randomUUID();
    const formula = randomUUID();
    const workflowId = await build(
      [
        { id: trigger, slug: 'on-manual-run' },
        { id: delay, slug: 'delay', config: { duration: { type: 'duration', value: cfg.number(2), unit: 'seconds' } } },
        { id: formula, slug: 'formula', config: { formula: cfg.text('40 + 2') } },
      ],
      [
        [trigger, 'done', delay],
        [delay, 'done', formula],
      ],
    );
    const { runs } = await worker.domain.workflows.trigger.manual(ctx, { workflowId });
    const runId = runs[0]?.runId as string;
    const parked = await until(
      () => worker.domain.workflows.runs.get(ctx, { runId }),
      (d) => d.executions.some((e) => e.blockId === delay && e.status === 'delayed'),
    );
    expect(parked.run.status).toBe('executing');
    const done = await until(
      () => worker.domain.workflows.runs.get(ctx, { runId }),
      (d) => d.run.status === 'completed',
    );
    expect(done.executions.find((e) => e.blockId === formula)?.outputs).toEqual({ result: 42 });
  });
});
