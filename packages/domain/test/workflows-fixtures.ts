// Shared fixtures of the workflow tests: a domain with a recording job queue, a movable workflow clock and a recorded
// HTTP transport; an "Opportunities" object with Amount / Score / Stage; and a builder that puts blocks and paths
// into a draft.
import { type BlockConfig, type ConfigExpr, cfg, type VariableOperation } from '@agentic-crm/contracts';
import { createDomain, type HttpRequest, newId, RecordingJobQueue } from '../src/index.ts';
import { createWorkspace, database, storage, type TestWorkspace } from './support/harness.ts';

export const clock = { now: new Date() };
export const jobs = new RecordingJobQueue();
export const httpCalls: HttpRequest[] = [];
export const http = {
  respond: async (_r: HttpRequest): Promise<{ status: number; body: string }> => ({ status: 200, body: '{"ok":true}' }),
};

export const domain = createDomain({
  database,
  storage,
  jobs,
  workflowClock: () => clock.now,
  workflowHttp: async (request) => {
    httpCalls.push(request);
    return http.respond(request);
  },
});

export interface Opportunities {
  objectId: string;
  amount: string;
  score: string;
  stage: string;
  note: string;
  won: string;
  lead: string;
}

export async function opportunities(ws: TestWorkspace): Promise<Opportunities> {
  const object = await domain.schema.createObject(ws.ctx, {
    id: newId(),
    apiSlug: `opps_${Math.random().toString(36).slice(2, 8)}`,
    singularNoun: 'Opportunity',
    pluralNoun: 'Opportunities',
  });
  const attr = async (title: string, type: 'number' | 'select' | 'text', extra: Record<string, unknown> = {}) =>
    (
      await domain.schema.createAttribute(ws.ctx, {
        id: newId(),
        entityDefinitionId: object.id,
        title,
        type,
        ...extra,
      })
    ).id;
  const amount = await attr('Amount', 'number');
  const score = await attr('Score', 'number');
  const stage = await attr('Stage', 'select', { options: [{ title: 'Lead' }, { title: 'Won' }] });
  const note = await attr('Note', 'text');
  const options = await domain.schema.listOptions(ws.ctx, {
    entityDefinitionId: object.id,
    attributeDefinitionId: stage,
  });
  return {
    objectId: object.id,
    amount,
    score,
    stage,
    note,
    won: options.find((o) => o.title === 'Won')?.id as string,
    lead: options.find((o) => o.title === 'Lead')?.id as string,
  };
}

export async function workspaceWith() {
  const ws = await createWorkspace();
  return { ws, opp: await opportunities(ws) };
}

export async function createOpp(ws: TestWorkspace, opp: Opportunities, values: Record<string, unknown>) {
  const id = newId();
  await domain.records.create(ws.ctx, {
    entityDefinitionId: opp.objectId,
    entityInstanceId: id,
    values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [{ value: v }]])),
  });
  return id;
}

export interface BlockSpec {
  id?: string;
  slug: string;
  config?: Record<string, ConfigExpr>;
}

/** Creates a workflow with the given blocks and paths ([source index, outcome, target index]). */
export async function buildWorkflow(
  ws: TestWorkspace,
  blocks: BlockSpec[],
  paths: [number, string, number][],
  title = 'Test workflow',
) {
  const workflowId = newId();
  await domain.workflows.create(ws.ctx, { id: workflowId, title });
  const ids = blocks.map((b) => b.id ?? newId());
  for (const [i, b] of blocks.entries()) {
    await domain.workflows.blocks.put(ws.ctx, {
      workflowId,
      blockId: ids[i] as string,
      slug: b.slug,
      position: { x: i * 270, y: 0 },
      config: cfg.object(b.config ?? {}) as BlockConfig,
    });
  }
  for (const [s, outcome, t] of paths) {
    await domain.workflows.blocks.connect(ws.ctx, {
      workflowId,
      sourceBlockId: ids[s] as string,
      outcome,
      targetBlockId: ids[t] as string,
    });
  }
  return { workflowId, ids };
}

export const field = (name: string): VariableOperation => ({ type: 'field', name });
export const attrOp = (entityDefinitionId: string, attributeDefinitionId: string): VariableOperation => ({
  type: 'attribute',
  entityDefinitionId,
  attributeDefinitionId,
});

/** Runs the trigger fan-out and the workspace's open runs until `until` holds. */
export async function drain(ws: TestWorkspace, until?: () => Promise<boolean>, timeoutMs = 45_000) {
  return domain.workflows.engine.drain({ workspaceId: ws.workspaceId, ...(until ? { until } : {}), timeoutMs });
}

export async function runsOf(ws: TestWorkspace, workflowId: string) {
  return (await domain.workflows.runs.list(ws.ctx, { workflowId })).runs;
}

/** Waits until the workflow has `n` runs that are no longer queued / executing. */
export async function settle(ws: TestWorkspace, workflowId: string, n: number, timeoutMs = 45_000) {
  await drain(
    ws,
    async () => {
      const runs = await runsOf(ws, workflowId);
      return runs.length >= n && runs.every((r) => r.status !== 'queued' && r.status !== 'executing');
    },
    timeoutMs,
  );
  return runsOf(ws, workflowId);
}
