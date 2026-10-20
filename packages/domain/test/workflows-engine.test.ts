// Workflow engine (BACKLOG 8.06, 8.08, 8.09, 8.11; acceptance 2, 3 and 5): change-feed triggers start one run per
// record and take the right path; a workflow's own writes are attributed to it and do not retrigger it; cascades stop
// at depth 5; failed runs retry from the failed block; delays continue later; schedules fire; caps hold.
import { cfg } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { afterEach, describe, expect, it } from 'vitest';
import { newId } from '../src/index.ts';
import { addMember } from './collab-fixtures.ts';
import { database } from './support/harness.ts';
import {
  attrOp,
  buildWorkflow,
  clock,
  createOpp,
  domain,
  drain,
  field,
  http,
  httpCalls,
  runsOf,
  settle,
  workspaceWith,
} from './workflows-fixtures.ts';

afterEach(() => {
  clock.now = new Date();
  httpCalls.length = 0;
  http.respond = async () => ({ status: 200, body: '{"ok":true}' });
});

async function valuesOf(ws: { ctx: Parameters<typeof domain.records.get>[0] }, objectId: string, recordId: string) {
  return (await domain.records.get(ws.ctx, { entityDefinitionId: objectId, entityInstanceId: recordId })).values;
}

describe('acceptance 2: Record created → If amount > 10 → Create task', () => {
  it('runs once per created record and takes the right path', async () => {
    const { ws, opp } = await workspaceWith();
    const triggerId = newId();
    const amountVar = cfg.variable(triggerId, 'done', [field('entity_instance'), attrOp(opp.objectId, opp.amount)]);
    const recordVar = cfg.variable(triggerId, 'done', [field('entity_instance')]);
    const { workflowId, ids } = await buildWorkflow(
      ws,
      [
        { id: triggerId, slug: 'on-record-created', config: { object: cfg.object_(opp.objectId) } },
        { slug: 'branch', config: { predicate: cfg.condition(amountVar, 'greater-than', cfg.number(10)) } },
        {
          slug: 'create-task',
          config: {
            content: cfg.text('Follow up on a deal of ', amountVar),
            references: { type: 'array', items: [recordVar] },
            assignees: { type: 'array', items: [{ type: 'actor', actorId: ws.memberId }] },
          },
        },
      ],
      [
        [0, 'done', 1],
        [1, 'true', 2],
      ],
    );
    const published = await domain.workflows.publish(ws.ctx, { workflowId });
    expect(published.workflow).toMatchObject({ status: 'live', hasUnpublishedChanges: false });

    const big = await createOpp(ws, opp, { [opp.amount]: 25 });
    const small = await createOpp(ws, opp, { [opp.amount]: 5 });
    const runs = await settle(ws, workflowId, 2);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.status === 'completed')).toBe(true);
    expect(runs.map((r) => r.sequenceNumber).sort()).toEqual([1, 2]);

    const details = await Promise.all(runs.map((r) => domain.workflows.runs.get(ws.ctx, { runId: r.id })));
    const byRecord = new Map(
      details.map((d) => {
        const trigger = d.executions.find((e) => e.blockId === ids[0]);
        return [(trigger?.outputs?.entity_instance as { entityInstanceId: string }).entityInstanceId, d];
      }),
    );
    // Exactly one run per record.
    expect([...byRecord.keys()].sort()).toEqual([big, small].sort());

    const bigRun = byRecord.get(big);
    const ifExec = bigRun?.executions.find((e) => e.blockId === ids[1]);
    expect(ifExec).toMatchObject({ status: 'completed', outcome: 'true' });
    const taskExec = bigRun?.executions.find((e) => e.blockId === ids[2]);
    expect(taskExec).toMatchObject({ status: 'completed', outcome: 'done', cost: { amount: 1, isFinal: true } });
    expect(bigRun?.takenPaths).toEqual(
      expect.arrayContaining([
        { sourceBlockId: ids[0], outcome: 'done', targetBlockId: ids[1] },
        { sourceBlockId: ids[1], outcome: 'true', targetBlockId: ids[2] },
      ]),
    );
    expect(bigRun?.run.creditsUsed).toBe(1);

    const smallRun = byRecord.get(small);
    expect(smallRun?.executions.find((e) => e.blockId === ids[1])).toMatchObject({ outcome: 'false' });
    expect(smallRun?.executions.some((e) => e.blockId === ids[2])).toBe(false);
    expect(smallRun?.takenPaths).toEqual([{ sourceBlockId: ids[0], outcome: 'done', targetBlockId: ids[1] }]);

    const taskId = (taskExec?.outputs?.created_task as { taskId: string }).taskId;
    const task = await domain.tasks.get(ws.ctx, taskId);
    expect(task.content.text).toBe('Follow up on a deal of 25');
    expect(task.linkedRecords).toEqual([{ entityDefinitionId: opp.objectId, entityInstanceId: big }]);
    expect(task.assigneeMemberIds).toEqual([ws.memberId]);
    expect(task.createdBy).toEqual({ type: 'workflow', id: workflowId });

    // Paused workflows start no runs.
    await domain.workflows.disable(ws.ctx, { workflowId });
    await createOpp(ws, opp, { [opp.amount]: 99 });
    await drain(ws);
    expect(await runsOf(ws, workflowId)).toHaveLength(2);
  });
});

describe('acceptance 3: actor attribution and no self-retrigger', () => {
  it("a workflow's writes carry the workflow actor and do not start it again", async () => {
    const { ws, opp } = await workspaceWith();
    const t = newId();
    const record = cfg.variable(t, 'done', [field('entity_instance')]);
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-record-updated', config: { object: cfg.object_(opp.objectId) } },
        {
          slug: 'update-record',
          config: {
            object: cfg.object_(opp.objectId),
            record,
            configured_attributes: cfg.object({ [opp.score]: cfg.object({ value: cfg.value(100) }) }),
          },
        },
      ],
      [[0, 'done', 1]],
    );
    await domain.workflows.publish(ws.ctx, { workflowId });
    const id = await createOpp(ws, opp, { [opp.amount]: 1 });
    await domain.records.update(ws.ctx, {
      entityDefinitionId: opp.objectId,
      entityInstanceId: id,
      values: { [opp.amount]: [{ value: 2 }] },
    });
    const runs = await settle(ws, workflowId, 1);
    // Give the fan-out another pass: the workflow's own update must not start a second run.
    await drain(ws);
    expect(await runsOf(ws, workflowId)).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'completed', cascadeDepth: 1 });
    const values = await valuesOf(ws, opp.objectId, id);
    expect(values[opp.score]?.[0]).toMatchObject({ value: 100, createdBy: { type: 'workflow', id: workflowId } });
    expect(values[opp.amount]?.[0]?.createdBy).toEqual({ type: 'workspace-member', id: ws.memberId });
  });

  it('cascades between workflows stop at depth 5 with a loop failure', async () => {
    const { ws, opp } = await workspaceWith();
    // W1: Amount changed → Score = Amount + 1;  W2: Score changed → Amount = Score + 1.
    const build = async (from: string, to: string, title: string) => {
      const t = newId();
      const f = newId();
      const value = cfg.variable(t, 'done', [field('entity_instance'), attrOp(opp.objectId, from)]);
      return buildWorkflow(
        ws,
        [
          {
            id: t,
            slug: 'on-attribute-invalidated',
            config: {
              object: cfg.object_(opp.objectId),
              attribute: {
                type: 'agentic-crm-attribute',
                entityDefinitionId: opp.objectId,
                attributeDefinitionId: from,
              },
            },
          },
          { id: f, slug: 'formula', config: { formula: cfg.text(value, ' + 1') } },
          {
            slug: 'update-record',
            config: {
              object: cfg.object_(opp.objectId),
              record: cfg.variable(t, 'done', [field('entity_instance')]),
              configured_attributes: cfg.object({
                [to]: cfg.object({ value: cfg.variable(f, 'done', [field('result')]) }),
              }),
            },
          },
        ],
        [
          [0, 'done', 1],
          [1, 'done', 2],
        ],
        title,
      );
    };
    const w1 = await build(opp.amount, opp.score, 'Ping');
    const w2 = await build(opp.score, opp.amount, 'Pong');
    await domain.workflows.publish(ws.ctx, { workflowId: w1.workflowId });
    await domain.workflows.publish(ws.ctx, { workflowId: w2.workflowId });
    const id = await createOpp(ws, opp, { [opp.amount]: 1 });
    const all = async () => [...(await runsOf(ws, w1.workflowId)), ...(await runsOf(ws, w2.workflowId))];
    await drain(ws, async () => {
      const runs = await all();
      return runs.some((r) => r.failureReason === 'cascade-depth-exceeded');
    });
    const runs = (await all()).sort((a, b) => a.cascadeDepth - b.cascadeDepth);
    expect(runs.map((r) => r.cascadeDepth)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(runs.slice(0, 5).every((r) => r.status === 'completed')).toBe(true);
    expect(runs[5]).toMatchObject({ status: 'failed', failureReason: 'cascade-depth-exceeded' });
    // Values after five hops: amount 1 → score 2 → amount 3 → score 4 → amount 5 → score 6.
    const values = await valuesOf(ws, opp.objectId, id);
    expect(values[opp.score]?.[0]?.value).toBe(6);
  });
});

describe('acceptance 5: retry from the failed block', () => {
  it('a failed run retries from the failed block in a new attempt; failures notify once a day per reason', async () => {
    const { ws } = await workspaceWith();
    const t = newId();
    const { workflowId, ids } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-manual-run' },
        { slug: 'formula', config: { formula: cfg.text('2 * 21') } },
        {
          slug: 'send-http-request',
          config: {
            method: cfg.string('POST'),
            url: cfg.text('https://example.com/hook'),
            body: { type: 'json', value: { a: 1 } },
          },
        },
        { slug: 'formula', config: { formula: cfg.text('1 + 1') } },
      ],
      [
        [0, 'done', 1],
        [1, 'done', 2],
        [2, 'done', 3],
      ],
    );
    await domain.workflows.publish(ws.ctx, { workflowId });
    http.respond = async () => {
      throw new Error('connection refused');
    };
    const { runs } = await domain.workflows.trigger.manual(ws.ctx, { workflowId });
    const runId = runs[0]?.runId as string;
    await settle(ws, workflowId, 1);
    let detail = await domain.workflows.runs.get(ws.ctx, { runId });
    expect(detail.run).toMatchObject({ status: 'failed', failureReason: 'execution-error', attemptCount: 1 });
    const failed = detail.executions.find((e) => e.blockId === ids[2]);
    expect(failed).toMatchObject({
      status: 'failed',
      failureReason: 'execution-error',
      errorMessage: 'Request failed: connection refused',
      cost: { amount: 0, isFinal: true },
    });
    expect(detail.executions.find((e) => e.blockId === ids[1])).toMatchObject({ outputs: { result: 42 } });
    expect(detail.run.creditsUsed).toBe(0);

    // The creator is subscribed to failures by default: one notification.
    const inbox = async () =>
      (await domain.notifications.list(ws.ctx, { topic: 'workflow-messages' })).items.filter(
        (g) => g.type === 'workflow-run-failed',
      );
    // The creator is the acting member; notifications to oneself come from the workflow actor, so they arrive.
    expect(await inbox()).toHaveLength(1);

    // A second failure with the same reason the same day does not notify again.
    const again = await domain.workflows.trigger.manual(ws.ctx, { workflowId });
    await settle(ws, workflowId, 2);
    expect((await domain.workflows.runs.get(ws.ctx, { runId: again.runs[0]?.runId as string })).run.status).toBe(
      'failed',
    );
    expect(await inbox()).toHaveLength(1);

    http.respond = async () => ({ status: 201, body: '{"id":7}' });
    const retried = await domain.workflows.runs.retry(ws.ctx, { runId, fromBlockExecutionId: failed?.id as string });
    expect(retried).toMatchObject({ status: 'queued', attemptCount: 2 });
    await settle(ws, workflowId, 2);
    detail = await domain.workflows.runs.get(ws.ctx, { runId });
    expect(detail.run).toMatchObject({ status: 'completed', attemptCount: 2, failureReason: null });
    expect(detail.frames.map((f) => [f.type, f.attempt])).toEqual([
      ['root', 1],
      ['retry', 2],
    ]);
    const http2 = detail.executions.filter((e) => e.blockId === ids[2]);
    expect(http2.map((e) => [e.status, e.attempt])).toEqual([
      ['failed', 1],
      ['completed', 2],
    ]);
    expect(http2[1]?.outputs).toEqual({ response_status: 201, response_body: '{"id":7}', response_ok: true });
    // The formula before the failed block ran once; the one after ran in the retry.
    expect(detail.executions.filter((e) => e.blockId === ids[1])).toHaveLength(1);
    expect(detail.executions.filter((e) => e.blockId === ids[3]).map((e) => e.attempt)).toEqual([2]);
    expect(detail.run.creditsUsed).toBe(1);
    expect(httpCalls.at(-1)).toMatchObject({ method: 'POST', url: 'https://example.com/hook', body: '{"a":1}' });

    // Rerun = a new attempt from the trigger; retry with the live workflow = a new linked run.
    await domain.workflows.runs.rerun(ws.ctx, { runId });
    await settle(ws, workflowId, 2);
    expect((await domain.workflows.runs.get(ws.ctx, { runId })).run).toMatchObject({
      status: 'completed',
      attemptCount: 3,
    });
    const linked = await domain.workflows.runs.rerun(ws.ctx, { runId, live: true });
    expect(linked.retriedFrom).toEqual({ runId, sequenceNumber: 1 });
    await settle(ws, workflowId, 3);
    expect((await domain.workflows.runs.get(ws.ctx, { runId })).run.retriedTo.map((r) => r.runId)).toEqual([linked.id]);
    const usage = await domain.workflows.usage(ws.ctx, {});
    expect(usage.totalCredits).toBe(3);
    expect(usage.byWorkflow).toEqual([{ workflowId, title: 'Test workflow', credits: 3 }]);
  });
});

describe('delays, schedules, loops and caps', () => {
  it('Delay parks the run and continues when the time has come; Delay until and Adjust time', async () => {
    const { ws } = await workspaceWith();
    const t = newId();
    const adjust = newId();
    const { workflowId, ids } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-manual-run' },
        {
          slug: 'delay',
          config: { duration: { type: 'duration', value: cfg.number(2), unit: 'hours' } },
        },
        {
          id: adjust,
          slug: 'adjust-timestamp',
          config: {
            timestamp: cfg.variable(t, 'done', [field('at')]),
            offset: { type: 'duration', value: cfg.number(3), unit: 'days' },
          },
        },
        { slug: 'delay-until', config: { timestamp: cfg.variable(adjust, 'done', [field('adjusted_timestamp')]) } },
        { slug: 'formula', config: { formula: cfg.text('1') } },
      ],
      [
        [0, 'done', 1],
        [1, 'done', 2],
        [2, 'done', 3],
        [3, 'done', 4],
      ],
    );
    await domain.workflows.publish(ws.ctx, { workflowId });
    const start = new Date();
    clock.now = start;
    const { runs } = await domain.workflows.trigger.manual(ws.ctx, { workflowId });
    const runId = runs[0]?.runId as string;
    await drain(ws);
    let detail = await domain.workflows.runs.get(ws.ctx, { runId });
    expect(detail.run.status).toBe('executing');
    const delayed = detail.executions.find((e) => e.blockId === ids[1]);
    expect(delayed?.status).toBe('delayed');
    expect(Date.parse(delayed?.resumeAt as string)).toBe(start.getTime() + 2 * 3600_000);

    clock.now = new Date(start.getTime() + 3 * 3600_000);
    await drain(ws);
    detail = await domain.workflows.runs.get(ws.ctx, { runId });
    const at = detail.executions.find((e) => e.blockId === ids[0])?.outputs?.at as string;
    const adjusted = detail.executions.find((e) => e.blockId === adjust)?.outputs?.adjusted_timestamp as string;
    expect(Date.parse(adjusted) - Date.parse(at)).toBe(3 * 86_400_000);
    expect(detail.executions.find((e) => e.blockId === ids[3])?.status).toBe('delayed');

    clock.now = new Date(start.getTime() + 4 * 86_400_000);
    await drain(ws);
    detail = await domain.workflows.runs.get(ws.ctx, { runId });
    expect(detail.run.status).toBe('completed');
    expect(detail.executions.find((e) => e.blockId === ids[4])?.status).toBe('completed');
  });

  it('inputs missing from the config take the catalogue defaults (Delay 60 seconds, Aggregate sum)', async () => {
    const { ws } = await workspaceWith();
    const parse = newId();
    const agg = newId();
    const delay = newId();
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { slug: 'on-manual-run' },
        {
          id: parse,
          slug: 'parse-json',
          config: {
            input: { type: 'json', value: [1, 2, 3.5] },
            schema: cfg.string(JSON.stringify({ type: 'array', items: { type: 'number' } })),
          },
        },
        { id: agg, slug: 'aggregate-values', config: { values: cfg.variable(parse, 'done', [field('value')]) } },
        { id: delay, slug: 'delay' },
      ],
      [
        [0, 'done', 1],
        [1, 'done', 2],
        [2, 'done', 3],
      ],
    );
    await domain.workflows.publish(ws.ctx, { workflowId });
    const start = new Date();
    clock.now = start;
    const { runs } = await domain.workflows.trigger.manual(ws.ctx, { workflowId });
    await drain(ws);
    const detail = await domain.workflows.runs.get(ws.ctx, { runId: runs[0]?.runId as string });
    expect(detail.executions.find((e) => e.blockId === agg)).toMatchObject({
      outputs: { total: 6.5 },
      inputs: { aggregation_type: 'sum' },
    });
    const parked = detail.executions.find((e) => e.blockId === delay);
    expect(Date.parse(parked?.resumeAt as string)).toBe(start.getTime() + 60_000);
  });

  it('a delayed run can be canceled', async () => {
    const { ws } = await workspaceWith();
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { slug: 'on-manual-run' },
        { slug: 'delay', config: { duration: { type: 'duration', value: cfg.number(1), unit: 'days' } } },
      ],
      [[0, 'done', 1]],
    );
    await domain.workflows.publish(ws.ctx, { workflowId });
    const { runs } = await domain.workflows.trigger.manual(ws.ctx, { workflowId });
    await drain(ws);
    const canceled = await domain.workflows.runs.cancel(ws.ctx, { runId: runs[0]?.runId as string });
    expect(canceled).toMatchObject({ status: 'canceled', canceledBy: { type: 'workspace-member', id: ws.memberId } });
    const detail = await domain.workflows.runs.get(ws.ctx, { runId: canceled.id });
    expect(detail.executions.map((e) => e.status)).toEqual(['completed', 'canceled']);
  });

  it('a recurring schedule starts runs at its cron times in its time zone', async () => {
    const { ws } = await workspaceWith();
    const { workflowId } = await buildWorkflow(
      ws,
      [
        {
          slug: 'on-recurring-schedule',
          config: {
            mode: cfg.string('daily'),
            time_of_day: cfg.string('09:30'),
            timezone: cfg.string('Europe/Berlin'),
          },
        },
        { slug: 'formula', config: { formula: cfg.text('6 * 7') } },
      ],
      [[0, 'done', 1]],
    );
    await domain.workflows.publish(ws.ctx, { workflowId });
    const { rows } = await sql<{ next_run_at: string; cron: string }>`
      SELECT next_run_at, cron FROM workflow_schedules WHERE workflow_id = ${workflowId}`.execute(database.kysely);
    expect(rows[0]?.cron).toBe('30 9 * * *');
    const next = new Date(rows[0]?.next_run_at as string);
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(next);
    expect(local).toBe('09:30');
    const tick = await domain.workflows.engine.tick({ now: new Date(next.getTime() + 1000) });
    expect(tick.scheduled).toBeGreaterThanOrEqual(1);
    const runs = await settle(ws, workflowId, 1);
    expect(runs[0]).toMatchObject({ status: 'completed', triggerSlug: 'on-recurring-schedule' });
    const { rows: after } = await sql<{ next_run_at: string; last_run_at: string }>`
      SELECT next_run_at, last_run_at FROM workflow_schedules WHERE workflow_id = ${workflowId}`.execute(
      database.kysely,
    );
    expect(Date.parse(after[0]?.next_run_at as string) - next.getTime()).toBe(86_400_000);
    // Disabling removes the schedule.
    await domain.workflows.disable(ws.ctx, { workflowId });
    const { rows: none } = await sql`SELECT 1 FROM workflow_schedules WHERE workflow_id = ${workflowId}`.execute(
      database.kysely,
    );
    expect(none).toHaveLength(0);
  });

  it('Loop runs its body per item of Find records, then continues after the loop', async () => {
    const { ws, opp } = await workspaceWith();
    const ids = [];
    for (const amount of [3, 30, 300]) ids.push(await createOpp(ws, opp, { [opp.amount]: amount }));
    const t = newId();
    const find = newId();
    const loop = newId();
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-manual-run' },
        {
          id: find,
          slug: 'find-records',
          config: {
            entity: cfg.object_(opp.objectId),
            limit: cfg.number(10),
            filter: {
              type: 'filter',
              predicate: {
                path: [{ entityDefinitionId: opp.objectId, attributeDefinitionId: opp.amount }],
                mode: 'must',
                constraints: [{ field: 'value', operator: 'gte', value: 10 }],
              },
            },
          },
        },
        { id: loop, slug: 'for-each', config: { iterable: cfg.variable(find, 'done', [field('records')]) } },
        {
          slug: 'update-record',
          config: {
            object: cfg.object_(opp.objectId),
            record: cfg.variable(loop, 'next', [field('item')]),
            configured_attributes: cfg.object({
              [opp.note]: cfg.object({ value: cfg.text('visited #', cfg.variable(loop, 'next', [field('count')])) }),
            }),
          },
        },
        { slug: 'formula', config: { formula: cfg.text(cfg.variable(find, 'done', [field('match_count')]), ' * 10') } },
      ],
      [
        [0, 'done', 1],
        [1, 'done', 2],
        [2, 'next', 3],
        [2, 'done', 4],
      ],
    );
    expect((await domain.workflows.validate(ws.ctx, { workflowId })).messages).toEqual([]);
    await domain.workflows.publish(ws.ctx, { workflowId });
    await domain.workflows.trigger.manual(ws.ctx, { workflowId });
    const [run] = await settle(ws, workflowId, 1);
    expect(run?.status).toBe('completed');
    const detail = await domain.workflows.runs.get(ws.ctx, { runId: run?.id as string });
    const loopExecs = detail.executions.filter((e) => e.blockId === loop);
    expect(loopExecs.map((e) => e.outcome)).toEqual(['next', 'next', 'done']);
    expect(detail.frames.filter((f) => f.type === 'loop-iteration').map((f) => f.iteration)).toEqual([0, 1]);
    expect(detail.executions.at(-1)?.outputs).toEqual({ result: 20 });
    const notes = await Promise.all(
      ids.map(async (id) => (await valuesOf(ws, opp.objectId, id))[opp.note]?.[0]?.value ?? null),
    );
    expect(notes[0]).toBeNull();
    expect(notes.slice(1).sort()).toEqual(['visited #1', 'visited #2']);
  });

  it('fails a run that exceeds 1,000 block executions', async () => {
    const { ws } = await workspaceWith();
    const parse = newId();
    const loop = newId();
    const items = Array.from({ length: 600 }, (_, i) => i);
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { slug: 'on-manual-run' },
        {
          id: parse,
          slug: 'parse-json',
          config: {
            input: { type: 'json', value: items },
            schema: cfg.string(JSON.stringify({ type: 'array', items: { type: 'number' } })),
          },
        },
        { id: loop, slug: 'for-each', config: { iterable: cfg.variable(parse, 'done', [field('value')]) } },
        { slug: 'formula', config: { formula: cfg.text(cfg.variable(loop, 'next', [field('item')]), ' + 1') } },
      ],
      [
        [0, 'done', 1],
        [1, 'done', 2],
        [2, 'next', 3],
      ],
    );
    await domain.workflows.publish(ws.ctx, { workflowId });
    await domain.workflows.trigger.manual(ws.ctx, { workflowId });
    const [run] = await settle(ws, workflowId, 1, 60_000);
    expect(run).toMatchObject({ status: 'failed', failureReason: 'exceeded-max-executions' });
    expect(run?.errorMessage).toBe('Workflow runs are limited to 1000 block executions');
    expect(run?.executionCount).toBeLessThanOrEqual(1001);
  }, 120_000);
});

describe('triggers and steps', () => {
  it('record action runs per record; list entry triggers; task and note triggers; draft workflows cannot run', async () => {
    const { ws, opp } = await workspaceWith();
    const t = newId();
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-record-action', config: { object: cfg.object_(opp.objectId) } },
        {
          slug: 'create-note',
          config: {
            title: cfg.text(
              'Note for ',
              cfg.variable(t, 'done', [field('entity_instance'), attrOp(opp.objectId, opp.amount)]),
            ),
            content: cfg.text(
              'Triggered by ',
              cfg.variable(t, 'done', [field('actor'), { type: 'property', name: 'name' }]),
            ),
            record: cfg.variable(t, 'done', [field('entity_instance')]),
          },
        },
      ],
      [[0, 'done', 1]],
    );
    const a = await createOpp(ws, opp, { [opp.amount]: 7 });
    const b = await createOpp(ws, opp, { [opp.amount]: 8 });
    await expect(
      domain.workflows.trigger.manual(ws.ctx, {
        workflowId,
        recordRefs: [{ entityDefinitionId: opp.objectId, entityInstanceId: a }],
      }),
    ).rejects.toMatchObject({
      code: 'WORKFLOW_STATE_CONFLICT',
      message: 'Publish changes to manually trigger this workflow',
    });
    await domain.workflows.publish(ws.ctx, { workflowId });
    const listed = await domain.workflows.list(ws.ctx, {
      actionFor: { kind: 'record', entityDefinitionId: opp.objectId },
    });
    expect(listed.workflows.map((w) => w.id)).toEqual([workflowId]);
    const started = await domain.workflows.trigger.manual(ws.ctx, {
      workflowId,
      recordRefs: [
        { entityDefinitionId: opp.objectId, entityInstanceId: a },
        { entityDefinitionId: opp.objectId, entityInstanceId: b },
      ],
    });
    expect(started.runs).toHaveLength(2);
    const runs = await settle(ws, workflowId, 2);
    expect(runs.every((r) => r.status === 'completed' && r.createdBy?.id === ws.memberId)).toBe(true);
    const notes = await domain.notes.list(ws.ctx, {
      record: { entityDefinitionId: opp.objectId, entityInstanceId: a },
    });
    expect(notes.notes.map((n) => n.title)).toEqual(['Note for 7']);
    expect(notes.notes[0]?.createdBy).toEqual({ type: 'workflow', id: workflowId });

    // Task created → round robin assigns the task's linked record owner; note created fires for notes of the object.
    const bob = await addMember(ws, 'Bob');
    const tt = newId();
    const rr = newId();
    const tasks = await buildWorkflow(
      ws,
      [
        { id: tt, slug: 'on-task-created' },
        {
          id: rr,
          slug: 'round-robin',
          config: {
            users: {
              type: 'array',
              items: [
                { type: 'actor', actorId: ws.memberId },
                { type: 'actor', actorId: bob.memberId },
              ],
            },
          },
        },
        {
          slug: 'update-task',
          config: {
            task: cfg.variable(tt, 'done', [field('task')]),
            updated_fields: { type: 'array', items: [cfg.string('assignees')] },
            assignees: { type: 'array', items: [cfg.variable(rr, 'done', [field('selected_user')])] },
          },
        },
      ],
      [
        [0, 'done', 1],
        [1, 'done', 2],
      ],
      'Assign tasks',
    );
    await domain.workflows.publish(ws.ctx, { workflowId: tasks.workflowId });
    const t1 = newId();
    const t2 = newId();
    await domain.tasks.create(ws.ctx, { id: t1, content: { text: 'One', mentions: [] } });
    await domain.tasks.create(ws.ctx, { id: t2, content: { text: 'Two', mentions: [] } });
    await settle(ws, tasks.workflowId, 2);
    const assigned = [
      (await domain.tasks.get(ws.ctx, t1)).assigneeMemberIds,
      (await domain.tasks.get(ws.ctx, t2)).assigneeMemberIds,
    ];
    expect(assigned.flat().sort()).toEqual([ws.memberId, bob.memberId].sort());

    const nt = newId();
    const notesWf = await buildWorkflow(
      ws,
      [
        { id: nt, slug: 'on-note-created', config: { object: cfg.object_(opp.objectId) } },
        {
          slug: 'guard',
          config: {
            predicate: cfg.condition(
              cfg.variable(nt, 'done', [field('note'), { type: 'property', name: 'title' }]),
              'contains',
              cfg.string('urgent'),
            ),
          },
        },
        {
          slug: 'send-notification',
          config: {
            users: { type: 'array', items: [{ type: 'actor', actorId: bob.memberId }] },
            title: cfg.text('Urgent note'),
          },
        },
      ],
      [
        [0, 'done', 1],
        [1, 'done', 2],
      ],
      'Urgent notes',
    );
    await domain.workflows.publish(ws.ctx, { workflowId: notesWf.workflowId });
    await domain.notes.create(ws.ctx, {
      id: newId(),
      title: 'Calm',
      parentRecords: [{ entityDefinitionId: opp.objectId, entityInstanceId: a }],
    });
    await domain.notes.create(ws.ctx, {
      id: newId(),
      title: 'URGENT call',
      parentRecords: [{ entityDefinitionId: opp.objectId, entityInstanceId: a }],
    });
    const noteRuns = await settle(ws, notesWf.workflowId, 2);
    expect(noteRuns.every((r) => r.status === 'completed')).toBe(true);
    const bobInbox = await domain.notifications.list(bob.ctx, { topic: 'workflow-messages' });
    expect(bobInbox.items.filter((g) => g.type === 'workflow-message')).toHaveLength(1);
  });

  it('list entry created / updated triggers; add, update and delete list entries; switch', async () => {
    const { ws, opp } = await workspaceWith();
    const list = await domain.lists.create(ws.ctx, {
      id: newId(),
      name: 'Pipeline',
      apiSlug: `pipe_${Math.random().toString(36).slice(2, 8)}`,
      parentEntityDefinitionIds: [opp.objectId],
    });
    const listId = list.list.id;
    const status = await domain.schema.createAttribute(ws.ctx, {
      id: newId(),
      entityDefinitionId: listId,
      title: 'Priority',
      type: 'text',
    });
    // Record created → Switch on amount: big → add to list with priority "high"; default → nothing.
    const t = newId();
    const amountVar = cfg.variable(t, 'done', [field('entity_instance'), attrOp(opp.objectId, opp.amount)]);
    const add = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-record-created', config: { object: cfg.object_(opp.objectId) } },
        {
          slug: 'switch',
          config: {
            cases: {
              type: 'array',
              items: [
                cfg.object({
                  id: cfg.string('big'),
                  label: cfg.string('Big'),
                  predicate: cfg.condition(amountVar, 'greater-than-or-equal-to', cfg.number(100)),
                }),
                cfg.object({
                  id: cfg.string('mid'),
                  label: cfg.string('Mid'),
                  predicate: cfg.condition(amountVar, 'greater-than-or-equal-to', cfg.number(10)),
                }),
              ],
            },
          },
        },
        {
          slug: 'create-list-entry',
          config: {
            list: cfg.list(listId),
            record: cfg.variable(t, 'done', [field('entity_instance')]),
            configured_attributes: cfg.object({ [status.id]: cfg.object({ value: cfg.value('high') }) }),
          },
        },
      ],
      [
        [0, 'done', 1],
        [1, 'big', 2],
      ],
      'Add big deals',
    );
    const lt = newId();
    const onEntry = await buildWorkflow(
      ws,
      [
        { id: lt, slug: 'on-list-entry-created', config: { list: cfg.list(listId) } },
        {
          slug: 'update-list-entry',
          config: {
            list: cfg.list(listId),
            entry: cfg.variable(lt, 'done', [field('entity_instance')]),
            configured_attributes: cfg.object({ [status.id]: cfg.object({ value: cfg.text('high (checked)') }) }),
          },
        },
      ],
      [[0, 'done', 1]],
      'Check entries',
    );
    const ut = newId();
    const onUpdate = await buildWorkflow(
      ws,
      [
        {
          id: ut,
          slug: 'on-list-entry-updated',
          config: {
            list: cfg.list(listId),
            attribute: { type: 'agentic-crm-attribute', entityDefinitionId: listId, attributeDefinitionId: status.id },
          },
        },
        {
          slug: 'delete-list-entry',
          config: { list: cfg.list(listId), entry: cfg.variable(ut, 'done', [field('entity_instance')]) },
        },
      ],
      [[0, 'done', 1]],
      'Remove checked',
    );
    for (const w of [add, onEntry, onUpdate]) await domain.workflows.publish(ws.ctx, { workflowId: w.workflowId });
    await createOpp(ws, opp, { [opp.amount]: 500 });
    await createOpp(ws, opp, { [opp.amount]: 50 });
    await settle(ws, add.workflowId, 2);
    await settle(ws, onEntry.workflowId, 1);
    const [deleted] = await settle(ws, onUpdate.workflowId, 1);
    expect(deleted?.status).toBe('completed');
    const switchOutcomes = await Promise.all(
      (await runsOf(ws, add.workflowId)).map(async (r) => {
        const d = await domain.workflows.runs.get(ws.ctx, { runId: r.id });
        return d.executions.find((e) => e.slug === 'switch')?.outcome;
      }),
    );
    expect(switchOutcomes.sort()).toEqual(['big', 'mid']);
    // The entry was added, updated by the second workflow and removed by the third.
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM entity_instances WHERE entity_definition_id = ${listId} AND archived_at IS NULL`.execute(
      database.kysely,
    );
    expect(rows[0]?.n).toBe('0');
  });

  it('create, complete and find tasks; broadcast messages and celebrations reach their audience', async () => {
    const { ws } = await workspaceWith();
    const bob = await addMember(ws, 'Bob');
    const create = newId();
    const find = newId();
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { slug: 'on-manual-run' },
        { id: create, slug: 'create-task', config: { content: cfg.text('Ship it') } },
        { slug: 'complete-task', config: { task: cfg.variable(create, 'done', [field('created_task')]) } },
        {
          id: find,
          slug: 'find-tasks',
          config: { limit: cfg.number(10), filter: cfg.object({ is_completed: cfg.boolean(true) }) },
        },
        {
          slug: 'send-workspace-toast',
          config: {
            variant: cfg.string('success'),
            target_type: cfg.string('specific-users'),
            targeted_users: { type: 'array', items: [{ type: 'actor', actorId: bob.memberId }] },
            title: cfg.text('Completed tasks: ', cfg.variable(find, 'done', [field('match_count')])),
          },
        },
        { slug: 'send-workspace-celebration', config: { type: cfg.string('fireworks') } },
      ],
      [
        [0, 'done', 1],
        [1, 'done', 2],
        [2, 'done', 3],
        [3, 'done', 4],
        [4, 'done', 5],
      ],
    );
    await domain.workflows.publish(ws.ctx, { workflowId });
    const since = new Date(Date.now() - 1000).toISOString();
    await domain.workflows.trigger.manual(ws.ctx, { workflowId });
    const [run] = await settle(ws, workflowId, 1);
    expect(run).toMatchObject({ status: 'completed', creditsUsed: 2 });
    const detail = await domain.workflows.runs.get(ws.ctx, { runId: run?.id as string });
    const taskId = (detail.executions.find((e) => e.blockId === create)?.outputs?.created_task as { taskId: string })
      .taskId;
    expect((await domain.tasks.get(ws.ctx, taskId)).isCompleted).toBe(true);
    expect(detail.executions.find((e) => e.blockId === find)?.outputs).toEqual({
      match_count: 1,
      tasks: [{ taskId }],
    });
    const forBob = await domain.workflows.broadcasts(bob.ctx, { since });
    expect(forBob.broadcasts.map((b) => [b.kind, b.payload])).toEqual([
      ['toast', { variant: 'success', title: 'Completed tasks: 1', description: null, durationSeconds: 5 }],
      ['celebration', { type: 'fireworks' }],
    ]);
    const forAda = await domain.workflows.broadcasts(ws.ctx, { since });
    expect(forAda.broadcasts.map((b) => b.kind)).toEqual(['celebration']);
  });

  it('assert-record matches on a unique attribute; aggregate, random number, parse JSON', async () => {
    const { ws, opp } = await workspaceWith();
    const key = await domain.schema.createAttribute(ws.ctx, {
      id: newId(),
      entityDefinitionId: opp.objectId,
      title: 'Key',
      type: 'text',
      isUnique: true,
    });
    const existing = await createOpp(ws, opp, { [key.id]: 'K-1', [opp.amount]: 1 });
    const t = newId();
    const http1 = newId();
    const parse = newId();
    const agg = newId();
    const { workflowId, ids } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-manual-run' },
        {
          id: http1,
          slug: 'send-http-request',
          config: { method: cfg.string('GET'), url: cfg.text('https://example.com/data') },
        },
        {
          id: parse,
          slug: 'parse-json',
          config: {
            input: cfg.variable(http1, 'done', [field('response_body')]),
            schema: cfg.string(
              JSON.stringify({
                type: 'object',
                properties: { key: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } },
              }),
            ),
          },
        },
        {
          id: agg,
          slug: 'aggregate-values',
          config: { values: cfg.variable(parse, 'done', [field('values')]), aggregation_type: cfg.string('max') },
        },
        {
          slug: 'assert-record',
          config: {
            object: cfg.object_(opp.objectId),
            matching_attribute: {
              type: 'agentic-crm-attribute',
              entityDefinitionId: opp.objectId,
              attributeDefinitionId: key.id,
            },
            configured_attributes: cfg.object({
              [key.id]: cfg.object({ value: cfg.variable(parse, 'done', [field('key')]) }),
              [opp.amount]: cfg.object({ value: cfg.variable(agg, 'done', [field('total')]) }),
            }),
          },
        },
        { slug: 'generate-random-number', config: { min: cfg.number(1), max: cfg.number(6) } },
      ],
      [
        [0, 'done', 1],
        [1, 'done', 2],
        [2, 'done', 3],
        [3, 'done', 4],
        [4, 'done', 5],
      ],
    );
    expect((await domain.workflows.validate(ws.ctx, { workflowId })).messages).toEqual([]);
    await domain.workflows.publish(ws.ctx, { workflowId });
    http.respond = async () => ({ status: 200, body: JSON.stringify({ key: 'K-1', values: [3, 9, 4] }) });
    await domain.workflows.trigger.manual(ws.ctx, { workflowId });
    await settle(ws, workflowId, 1);
    http.respond = async () => ({ status: 200, body: JSON.stringify({ key: 'K-2', values: [] }) });
    await domain.workflows.trigger.manual(ws.ctx, { workflowId });
    const runs = await settle(ws, workflowId, 2);
    expect(runs.map((r) => r.status)).toEqual(['completed', 'completed']);
    expect((await valuesOf(ws, opp.objectId, existing))[opp.amount]?.[0]?.value).toBe(9);
    const second = await domain.workflows.runs.get(ws.ctx, { runId: runs[0]?.id as string });
    const created = second.executions.find((e) => e.blockId === ids[4])?.outputs?.record as {
      entityInstanceId: string;
    };
    expect(created.entityInstanceId).not.toBe(existing);
    const random = second.executions.find((e) => e.blockId === ids[5])?.outputs?.random_number as number;
    expect(random >= 1 && random <= 6 && Number.isInteger(random)).toBe(true);
  });
});
