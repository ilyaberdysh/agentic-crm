// Workflow AI blocks with the fake LLM (BACKLOG 10.08): Classify record, Summarize record, Classify text and Custom
// agent (tools, structured output) run in the engine, report token-based credits on their executions and the run,
// and fail with insufficient-credits when the workspace pool is used up.
import { cfg } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import { createDomain, FakeLlm, lastToolResults, newId, RecordingJobQueue } from '../src/index.ts';
import { database, storage } from './support/harness.ts';
import { buildWorkflow, createOpp, field, workspaceWith } from './workflows-fixtures.ts';

const fake = new FakeLlm();
const ai = createDomain({ database, storage, jobs: new RecordingJobQueue(), llm: fake });

async function settle(workspaceId: string, workflowId: string, n: number) {
  const done = async () => {
    const { runs } = await ai.workflows.runs.list(
      { workspaceId, actor: { type: 'system', id: 'test' } },
      { workflowId },
    );
    return runs.length >= n && runs.every((r) => r.status !== 'queued' && r.status !== 'executing');
  };
  await ai.workflows.engine.drain({ workspaceId, until: done, timeoutMs: 45_000 });
  return (await ai.workflows.runs.list({ workspaceId, actor: { type: 'system', id: 'test' } }, { workflowId })).runs;
}

describe('workflow AI blocks', () => {
  it('classify, summarize and run a custom agent with tools and structured output', async () => {
    const { ws, opp } = await workspaceWith();
    fake.when((r) => r.purpose === 'workflow-summarize', { text: 'A promising lead worth 25.' });
    fake.when((r) => r.purpose === 'workflow-classify' && JSON.stringify(r.messages).includes('A promising lead'), {
      json: { tags: ['Warm'] },
    });
    fake.when((r) => r.purpose === 'workflow-agent' && lastToolResults(r).length === 0, {
      toolCalls: [{ name: 'list-records', input: { object: opp.objectId } }],
    });
    fake.when(
      (r) => r.purpose === 'workflow-agent' && lastToolResults(r).length > 0,
      (r) => {
        const listed = JSON.parse(String(lastToolResults(r)[0]?.content)) as { total: number };
        return { json: { score: listed.total * 7, reason: 'one opportunity' } };
      },
    );

    const t = newId();
    const classifyRecord = newId();
    const summarize = newId();
    const classifyText = newId();
    const agent = newId();
    const record = cfg.variable(t, 'done', [field('entity_instance')]);
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-record-created', config: { object: cfg.object_(opp.objectId) } },
        {
          id: classifyRecord,
          slug: 'classify-entity',
          config: { input: record, tags: { type: 'array', items: [cfg.string('Hot'), cfg.string('Cold')] } },
        },
        {
          id: summarize,
          slug: 'summarize-entity',
          config: { entity_instance: record, instructions: cfg.text('One sentence.') },
        },
        {
          id: classifyText,
          slug: 'classify-text',
          config: {
            input: cfg.text(cfg.variable(summarize, 'done', [field('summary')])),
            tags: { type: 'array', items: [cfg.string('Cold'), cfg.string('Warm')] },
            allow_multiple_tags: cfg.boolean(false),
          },
        },
        {
          id: agent,
          slug: 'run-custom-ai-agent',
          config: {
            instructions: cfg.text('Score this pipeline'),
            output_mode: cfg.string('structured'),
            structured_output_schema: cfg.string(
              JSON.stringify({
                type: 'object',
                properties: { score: { type: 'number' }, reason: { type: 'string' } },
                required: ['score', 'reason'],
                additionalProperties: false,
              }),
            ),
            tools: cfg.object({ tool_groups: { type: 'array', items: [cfg.string('particle')] } }),
          },
        },
      ],
      [
        [0, 'done', 1],
        [1, 'done', 2],
        [2, 'done', 3],
        [3, 'done', 4],
      ],
    );
    const published = await ai.workflows.publish(ws.ctx, { workflowId });
    expect(published.workflow.status).toBe('live');
    await createOpp(ws, opp, { [opp.amount]: 25 });
    const runs = await settle(ws.workspaceId, workflowId, 1);
    expect(runs[0]?.status).toBe('completed');
    const detail = await ai.workflows.runs.get(ws.ctx, { runId: runs[0]?.id as string });
    const exec = (blockId: string) => detail.executions.find((e) => e.blockId === blockId);
    expect(exec(classifyRecord)?.outputs).toEqual({ classification: 'Hot' });
    expect(exec(summarize)?.outputs).toEqual({ summary: 'A promising lead worth 25.' });
    expect(exec(classifyText)?.outputs).toEqual({ classification: 'Warm' });
    expect(exec(agent)?.outputs).toMatchObject({ score: 7, reason: 'one opportunity' });
    for (const id of [classifyRecord, summarize, classifyText, agent]) {
      expect(exec(id)?.cost).toMatchObject({ isFinal: true });
      expect(exec(id)?.cost?.amount).toBeGreaterThanOrEqual(1);
    }
    expect(detail.run.creditsUsed).toBeGreaterThanOrEqual(4);
    // The agent got the record tools only (no writes) and the classification prompt lists the tags.
    const agentCall = fake.callsFor('workflow-agent')[0];
    // Every model call is bounded (the block runs inside the step transaction).
    for (const call of fake.calls) expect(call.signal).toBeInstanceOf(AbortSignal);
    expect(agentCall?.tools?.map((tool) => ('name' in tool ? tool.name : ''))).toEqual([
      'search-records',
      'list-records',
      'get-records',
      'list-attributes',
    ]);
    const usage = await ai.credits.usage(ws.ctx);
    expect(usage.bySource.find((s) => s.source === 'workflow-block-execution')?.credits).toBe(detail.run.creditsUsed);
    expect(usage.workspace.used).toBe(detail.run.creditsUsed);
  });

  it('fails with insufficient-credits when the workspace pool is used up', async () => {
    const { ws, opp } = await workspaceWith();
    await sql`UPDATE workspaces SET settings = jsonb_set(settings, '{capabilities}',
      '{"quotas":{"workflow_credits_per_month_hard":0}}'::jsonb) WHERE id = ${ws.workspaceId}`.execute(database.kysely);
    const t = newId();
    const { workflowId } = await buildWorkflow(
      ws,
      [
        { id: t, slug: 'on-record-created', config: { object: cfg.object_(opp.objectId) } },
        {
          slug: 'summarize-entity',
          config: {
            entity_instance: cfg.variable(t, 'done', [field('entity_instance')]),
            instructions: cfg.text('Briefly'),
          },
        },
      ],
      [[0, 'done', 1]],
    );
    await ai.workflows.publish(ws.ctx, { workflowId });
    const calls = fake.calls.length;
    await createOpp(ws, opp, { [opp.amount]: 1 });
    const runs = await settle(ws.workspaceId, workflowId, 1);
    expect(runs[0]).toMatchObject({ status: 'failed', failureReason: 'insufficient-credits' });
    expect(fake.calls.length).toBe(calls);
  });
});
