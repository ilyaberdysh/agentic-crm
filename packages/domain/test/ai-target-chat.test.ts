import { randomBytes } from 'node:crypto';
import { type AiStreamEvent, aiTargetModelChoice } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnconfiguredLlm } from '../src/ai/llm.ts';
import { createDomain } from '../src/index.ts';
import { addMember, collabFixture } from './collab-fixtures.ts';
import { createWorkspace, database, expectCode, newId, storage } from './support/harness.ts';

const encryptionKey = randomBytes(32);
const ai = createDomain({ database, storage, llm: new UnconfiguredLlm(), modelEncryptionKey: encryptionKey });
const key = 'saved-model-private-key';
const usage = {
  inputTokens: 17,
  outputTokens: 8,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  serverToolRequests: {},
  cost: { status: 'unknown' as const, reason: 'unknown_model_price' as const },
};
const reply = (text: string) =>
  new Response(
    JSON.stringify({
      id: 'byo-chat',
      model: 'byo-custom-model',
      choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 17, completion_tokens: 8 },
    }),
    { headers: { 'content-type': 'application/json' } },
  );

afterEach(() => vi.restoreAllMocks());

async function cloud(ownerKind: 'member' | 'workspace' = 'member') {
  const fx = await collabFixture();
  const connection = await ai.agentic.providerConnections.create(fx.ctx, {
    id: newId(),
    ownerKind,
    provider: 'openai',
    apiKey: key,
  });
  const target = await ai.agentic.models.targets.create(fx.ctx, {
    id: newId(),
    name: 'My saved model',
    kind: 'cloud-api',
    ownerKind,
    provider: 'openai',
    model: 'byo-custom-model',
    connectionId: connection.id,
    connectionVersion: connection.version,
  });
  return { ...fx, connection, target, model: aiTargetModelChoice(target.id, target.version) };
}

async function local() {
  const fx = await collabFixture();
  const enrollment = await ai.agentic.runners.createEnrollment(fx.ctx);
  const enrolled = await ai.agentic.runners.enroll(fx.sys, {
    token: enrollment.token,
    id: newId(),
    name: 'My local models',
  });
  const target = await ai.agentic.models.targets.create(fx.ctx, {
    id: newId(),
    name: 'My local model',
    kind: 'runner-local',
    ownerKind: 'member',
    provider: 'openai-compatible',
    model: 'local-model',
    runnerId: enrolled.id,
    endpoint: 'http://127.0.0.1:11434/v1',
    features: { text: true, clientTools: false, structuredOutput: 'none', streaming: false },
  });
  return { ...fx, enrolled, target, model: aiTargetModelChoice(target.id, target.version) };
}

describe('Ask Agentic with saved API and local targets', () => {
  it('answers from real CRM context and history without a server key or prepaid credits', async () => {
    const fx = await cloud();
    const http = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => reply(`Acme answer ${key}`));
    await sql`UPDATE workspaces SET settings = jsonb_set(settings, '{capabilities}',
      '{"quotas":{"workspace_membership_credits_per_month_hard":0,"workflow_credits_per_month_hard":0}}'::jsonb)
      WHERE id = ${fx.workspaceId}`.execute(database.kysely);
    const models = await ai.ai.models.list(fx.ctx);
    expect(models.configured).toBe(true);
    expect(models.models.find((m) => m.id === fx.model)).toMatchObject({
      label: 'My saved model · API',
      isUnavailable: false,
    });
    expect(models.models.filter((m) => m.isAuto).every((m) => m.isUnavailable)).toBe(true);
    const turnId = newId();
    const events: AiStreamEvent[] = [];
    const stop = ai.ai.hub.subscribeTurn(turnId, ({ event }) => events.push(event));
    const first = await ai.ai.turns.send(fx.ctx, {
      threadId: newId(),
      turnId,
      model: fx.model,
      content: 'Summarize Acme',
      context: { records: [fx.record] },
    });
    await ai.ai.turns.settled(turnId);
    stop();
    const turn = await ai.ai.turns.get(fx.ctx, turnId);
    expect(turn).toMatchObject({ status: 'completed', model: fx.model, creditCost: null, contextTokens: 17 });
    expect(turn.steps[0]?.parts).toMatchObject([{ type: 'text', content: 'Acme answer [redacted]' }]);
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'completed' });
    expect(events.some((event) => event.type === 'part' && event.part.type === 'text')).toBe(true);
    const [url, init] = http.mock.calls[0]!;
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    expect(init?.redirect).toBe('error');
    const body = JSON.parse(String(init?.body));
    expect(body.messages.find((m: { role: string }) => m.role === 'user').content).toContain('"name":"Acme"');
    expect(body.tools).toBeUndefined();
    expect(body.model).toBe('byo-custom-model');
    expect(body.max_completion_tokens ?? body.max_tokens).toBe(4096);
    const invocations = await database.kysely
      .selectFrom('model_invocations')
      .selectAll()
      .where('workspace_id', '=', fx.workspaceId)
      .execute();
    expect(invocations).toMatchObject([
      { outcome: 'completed', cost_status: 'unknown', micro_usd: null, input_tokens: 17 },
    ]);
    expect(
      await database.kysely
        .selectFrom('credit_ledger')
        .select('id')
        .where('workspace_id', '=', fx.workspaceId)
        .execute(),
    ).toEqual([]);
    expect(await ai.ai.turns.suggestions(fx.ctx, turnId)).toEqual({ turnId, suggestions: [] });
    const second = await ai.ai.turns.send(fx.ctx, {
      threadId: first.threadId,
      model: fx.model,
      content: '@Acme explain that answer',
      annotations: [
        {
          type: 'entity-instance',
          start: 0,
          length: 5,
          entityDefinitionId: fx.record.entityDefinitionId,
          entityInstanceId: fx.record.entityInstanceId,
        },
      ],
    });
    await ai.ai.turns.settled(second.turnId);
    const secondMessages = JSON.parse(String(http.mock.calls[1]![1]?.body))
      .messages.map((message: { content: string }) => message.content)
      .join('\n');
    expect(secondMessages).toContain('Acme answer [redacted]');
    expect(secondMessages).toContain('"name":"Acme"');
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('enforces private target and workspace scope before creating a turn', async () => {
    const fx = await cloud();
    const other = await addMember(fx, 'Other');
    const another = await createWorkspace();
    expect((await ai.ai.models.list(other.ctx)).models.some((m) => m.id === fx.model)).toBe(false);
    for (const ctx of [other.ctx, another.ctx]) {
      await expectCode(
        ai.ai.turns.send(ctx, { threadId: newId(), model: fx.model, content: 'Try the private target' }),
        'NOT_FOUND',
        404,
      );
    }
    expect(
      await database.kysely.selectFrom('ai_turns').select('id').where('workspace_id', '=', fx.workspaceId).execute(),
    ).toEqual([]);
  });

  it('allows members to use workspace targets and rejects changed credentials or disabled targets', async () => {
    const fx = await cloud('workspace');
    const other = await addMember(fx, 'Other');
    const http = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => reply('Shared answer'));
    const sent = await ai.ai.turns.send(other.ctx, { threadId: newId(), model: fx.model, content: 'Shared target' });
    await ai.ai.turns.settled(sent.turnId);
    expect((await ai.ai.turns.get(other.ctx, sent.turnId)).status).toBe('completed');
    await ai.agentic.providerConnections.rotate(fx.ctx, {
      id: fx.connection.id,
      expectedVersion: 1,
      apiKey: 'replacement-key',
    });
    await expectCode(ai.ai.turns.retry(other.ctx, { turnId: sent.turnId }), 'VERSION_CONFLICT', 409);
    await ai.agentic.models.targets.disable(fx.ctx, { id: fx.target.id, expectedVersion: 1 });
    await expectCode(
      ai.ai.turns.send(other.ctx, { threadId: newId(), model: fx.model, content: 'Stale choice' }),
      'VERSION_CONFLICT',
      409,
    );
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('persists a safe failed turn when the provider fails, without falling back or charging credits', async () => {
    const fx = await cloud();
    const http = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(key, { status: 500 }));
    const sent = await ai.ai.turns.send(fx.ctx, { threadId: newId(), model: fx.model, content: 'Failure test' });
    await ai.ai.turns.settled(sent.turnId);
    const turn = await ai.ai.turns.get(fx.ctx, sent.turnId);
    expect(turn).toMatchObject({ status: 'failed', failureReason: 'provider-error', creditCost: null });
    expect(JSON.stringify(turn)).not.toContain(key);
    expect(http).toHaveBeenCalledTimes(1);
    expect(
      (
        await database.kysely
          .selectFrom('model_invocations')
          .selectAll()
          .where('workspace_id', '=', fx.workspaceId)
          .execute()
      )[0],
    ).toMatchObject({ outcome: 'failed', micro_usd: null, cost_status: 'unknown' });
  });

  it('waits for the enrolled local runner and returns its answer through the same chat', async () => {
    const fx = await local();
    const http = vi.spyOn(globalThis, 'fetch');
    const sent = await ai.ai.turns.send(fx.ctx, {
      threadId: newId(),
      model: fx.model,
      content: 'Local Acme summary',
      context: { records: [fx.record] },
    });
    let dispatch: Awaited<ReturnType<typeof ai.agentic.models.claimRunnerInvocations>>[number] | undefined;
    await vi.waitFor(async () => {
      dispatch = (await ai.agentic.models.claimRunnerInvocations(fx.enrolled.bearerToken))[0];
      expect(dispatch).toBeDefined();
    });
    expect(JSON.stringify(dispatch!.request)).toContain('Acme');
    expect(dispatch!.request.tools).toBeUndefined();
    expect(dispatch!.endpoint).toBe('http://127.0.0.1:11434/v1');
    await ai.agentic.models.completeRunnerInvocation(
      {
        invocationId: dispatch!.invocationId,
        leaseGeneration: dispatch!.leaseGeneration,
        outcome: 'completed',
        text: 'Local Acme answer',
        usage,
      },
      fx.enrolled.bearerToken,
    );
    await ai.ai.turns.settled(sent.turnId);
    const turn = await ai.ai.turns.get(fx.ctx, sent.turnId);
    expect(turn).toMatchObject({ status: 'completed', creditCost: null });
    expect(turn.steps[0]?.parts).toMatchObject([{ type: 'text', content: 'Local Acme answer' }]);
    expect(http).not.toHaveBeenCalled();
  });

  it('cancels queued local work from another API instance so it cannot later execute or complete the chat', async () => {
    const fx = await local();
    const sent = await ai.ai.turns.send(fx.ctx, {
      threadId: newId(),
      model: fx.model,
      content: 'Cancel local question',
    });
    await vi.waitFor(async () => {
      const row = await database.kysely
        .selectFrom('model_invocations')
        .select('id')
        .where('workspace_id', '=', fx.workspaceId)
        .executeTakeFirst();
      expect(row).toBeDefined();
    });
    const otherInstance = createDomain({
      database,
      storage,
      llm: new UnconfiguredLlm(),
      modelEncryptionKey: encryptionKey,
    });
    await otherInstance.ai.turns.cancel(fx.ctx, sent.turnId);
    await ai.ai.turns.settled(sent.turnId);
    expect((await ai.ai.turns.get(fx.ctx, sent.turnId)).status).toBe('canceled');
    expect(await ai.agentic.models.claimRunnerInvocations(fx.enrolled.bearerToken)).toEqual([]);
    const row = await database.kysely
      .selectFrom('model_invocations')
      .selectAll()
      .where('workspace_id', '=', fx.workspaceId)
      .executeTakeFirstOrThrow();
    expect(row.outcome).toBe('canceled');
    const {
      rows: [dispatch],
    } = await sql<{ status: string; encrypted_request: unknown }>`SELECT status, encrypted_request
      FROM model_runner_dispatches WHERE invocation_id = ${row.id}::uuid`.execute(database.kysely);
    expect(dispatch!.status).toBe('settled');
    expect(dispatch!.encrypted_request).toBeNull();
  });
});
