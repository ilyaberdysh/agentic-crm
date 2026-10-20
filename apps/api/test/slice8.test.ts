// Slice 8 procedures over HTTP (BACKLOG §8): the editor's autosave path (create → blocks.put / connect → publish),
// publish errors with the checklist, the catalogue, a manual run and its run viewer data, the "Webhook received" hook
// URL, and the workflow resource kind in permissions.*.
import { randomUUID } from 'node:crypto';
import { cfg } from '@agentic-crm/contracts';
import type { inferRouterOutputs } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppRouter } from '../src/trpc/router';
import {
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  trpcCall,
  trpcError,
} from './support/harness';

type Out = inferRouterOutputs<AppRouter>;

let h: Harness;
let admin: TestUser;
let workspaceId: string;
const slug = `s8-${Date.now().toString(36)}`;
const call = <T>(path: string, input?: unknown) => trpcCall<T>(h, path, input, { user: admin, slug });

beforeAll(async () => {
  h = await startHarness();
  admin = await signUp(h, 'Willa Flow');
  workspaceId = (await createWorkspaceWithMembers(h, slug, [{ user: admin, admin: true }])).workspaceId;
});

afterAll(async () => {
  await h?.close();
});

describe('workflows over tRPC', () => {
  it('builds, publishes and runs a workflow; the run viewer shows the path taken', async () => {
    const catalog = await call<Out['workflows']['catalog']>('workflows.catalog');
    expect(catalog.triggers).toHaveLength(16);

    const workflowId = randomUUID();
    const created = await call<Out['workflows']['create']>('workflows.create', { id: workflowId });
    expect(created.workflow).toMatchObject({ isTransient: true, displayTitle: 'Untitled Workflow' });
    expect(created.seq).not.toBeNull();

    const trigger = randomUUID();
    const formula = randomUUID();
    await call('workflows.blocks.put', {
      workflowId,
      blockId: trigger,
      slug: 'on-manual-run',
      position: { x: 0, y: 0 },
    });
    // Publishing a workflow without steps fails with the checklist.
    const invalid = await trpcError(call('workflows.publish', { workflowId }));
    expect(invalid.status).toBe(400);
    expect(invalid.body.additional_information).toMatchObject({ code: 'WORKFLOW_INVALID' });

    const put = await call<Out['workflows']['blocks']['put']>('workflows.blocks.put', {
      workflowId,
      blockId: formula,
      slug: 'formula',
      position: { x: 270, y: 0 },
      config: cfg.object({ formula: cfg.text('6 * 7') }),
    });
    expect(put.block).toMatchObject({ title: 'Formula', outcomes: [{ slug: 'done', outputs: [{ key: 'result' }] }] });
    expect(put.block.issues).toEqual([
      { path: [], code: 'not-connected', message: 'This step is not connected to a trigger' },
    ]);
    await call('workflows.blocks.connect', {
      workflowId,
      sourceBlockId: trigger,
      outcome: 'done',
      targetBlockId: formula,
    });
    const published = await call<Out['workflows']['publish']>('workflows.publish', { workflowId });
    expect(published.workflow).toMatchObject({ status: 'live', isTransient: false });

    const listed = await call<Out['workflows']['list']>('workflows.list', {});
    expect(listed.workflows.map((w) => w.id)).toContain(workflowId);

    const triggered = await call<Out['workflows']['trigger']['manual']>('workflows.trigger.manual', { workflowId });
    expect(triggered.runs).toHaveLength(1);
    await h.domain.workflows.engine.drain({ workspaceId });
    const runs = await call<Out['workflows']['runs']['list']>('workflows.runs.list', { workflowId });
    expect(runs.runs[0]).toMatchObject({ status: 'completed', sequenceNumber: 1 });
    expect(runs.overview).toMatchObject({ last7DaysRuns: 1, last7DaysCompleted: 1 });
    const run = await call<Out['workflows']['runs']['get']>('workflows.runs.get', { runId: runs.runs[0]?.id });
    expect(run.takenPaths).toEqual([{ sourceBlockId: trigger, outcome: 'done', targetBlockId: formula }]);
    expect(run.executions.find((e) => e.blockId === formula)?.outputs).toEqual({ result: 42 });

    const variables = await call<Out['workflows']['variables']>('workflows.variables', {
      workflowId,
      blockId: formula,
    });
    expect(variables.blocks.map((b) => b.title)).toEqual(['Manual run']);

    const grants = await call<Out['permissions']['list']>('permissions.list', {
      resourceKind: 'workflow',
      resourceId: workflowId,
    });
    expect(grants.grants[0]).toMatchObject({ target: { type: 'workspace' }, level: 'full-access' });
  });

  it('the hook URL starts a run of a live "Webhook received" workflow with the raw body', async () => {
    const workflowId = randomUUID();
    await call('workflows.create', { id: workflowId, title: 'Inbound' });
    const trigger = randomUUID();
    const parse = randomUUID();
    await call('workflows.blocks.put', { workflowId, blockId: trigger, slug: 'on-inbound-webhook' });
    await call('workflows.blocks.put', {
      workflowId,
      blockId: parse,
      slug: 'parse-json',
      config: cfg.object({
        input: cfg.variable(trigger, 'done', [{ type: 'field', name: 'request_body' }]),
        schema: cfg.string(JSON.stringify({ type: 'object', properties: { email: { type: 'string' } } })),
      }),
    });
    await call('workflows.blocks.connect', {
      workflowId,
      sourceBlockId: trigger,
      outcome: 'done',
      targetBlockId: parse,
    });
    const url = `${h.baseUrl}/hooks/w/${workspaceId}/${workflowId}`;
    const notLive = await fetch(url, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(notLive.status).toBe(409);
    await call('workflows.publish', { workflowId });
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ email: 'ada@example.com' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(202);
    const { run_id: runId } = (await response.json()) as { run_id: string };
    await h.domain.workflows.engine.drain({ workspaceId });
    const run = await call<Out['workflows']['runs']['get']>('workflows.runs.get', { runId });
    expect(run.run.status).toBe('completed');
    expect(run.executions.find((e) => e.blockId === parse)?.outputs).toEqual({ email: 'ada@example.com' });
    const unknown = await fetch(`${h.baseUrl}/hooks/w/${workspaceId}/${randomUUID()}`, { method: 'POST', body: 'x' });
    expect(unknown.status).toBe(404);
  });
});
