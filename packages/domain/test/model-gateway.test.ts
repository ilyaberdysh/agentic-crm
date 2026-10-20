import { randomBytes } from 'node:crypto';
import { sql } from '@agentic-crm/db';
import { describe, expect, it, vi } from 'vitest';
import { InferenceError, type InferenceUsage } from '../src/ai/inference.ts';
import { memberContext } from '../src/context.ts';
import { toErrorEnvelope } from '../src/errors.ts';
import { createProviderConnections } from '../src/model-gateway/connections.ts';
import type { CreateModelTargetInput } from '../src/model-gateway/contracts.ts';
import { createModelGateway, type ModelGatewayOptions } from '../src/model-gateway/gateway.ts';
import { runInWorkspace } from '../src/tx.ts';
import { addMember } from './collab-fixtures.ts';
import { createWorkspace, database, expectCode, newId } from './support/harness.ts';

const KEY = 'gateway-test-secret-key-123456789';
const request = { purpose: 'custom', messages: [{ role: 'user' as const, content: 'Hello' }] };
const unknown: InferenceUsage = {
  inputTokens: 11,
  outputTokens: 7,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  serverToolRequests: {},
  cost: { status: 'unknown', reason: 'unknown_model_price' },
};
function reply(text = 'Hello', usage: unknown = { prompt_tokens: 11, completion_tokens: 7 }) {
  return new Response(
    JSON.stringify({
      id: 'chat-1',
      model: 'custom-model',
      choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      ...(usage ? { usage } : {}),
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
function world(overrides: Partial<ModelGatewayOptions> = {}) {
  const encryptionKey = randomBytes(32);
  const http = vi.fn<typeof fetch>(async () => reply());
  return {
    http,
    connections: createProviderConnections({ database, encryptionKey }),
    gateway: createModelGateway({ database, encryptionKey, fetch: http, ...overrides }),
  };
}
async function cloud(
  w: ReturnType<typeof world>,
  scope: 'member' | 'workspace' = 'member',
  provider: 'openai' | 'anthropic' = 'openai',
) {
  const ws = await createWorkspace();
  const connection = await w.connections.create(ws.ctx, { id: newId(), ownerKind: scope, provider, apiKey: KEY });
  const input: CreateModelTargetInput = {
    id: newId(),
    name: 'My model',
    kind: 'cloud-api',
    ownerKind: scope,
    provider,
    model: 'custom-model',
    connectionId: connection.id,
    connectionVersion: connection.version,
  };
  const target = await w.gateway.targets.create(ws.ctx, input);
  return {
    ...ws,
    connection,
    target,
    input,
    invoke: () => w.gateway.invoke(ws.ctx, { targetId: target.id, expectedVersion: target.version, request }),
  };
}
async function usageRows(workspaceId: string) {
  return database.kysely.selectFrom('model_invocations').selectAll().where('workspace_id', '=', workspaceId).execute();
}
const localFeatures = { text: true as const, clientTools: false, structuredOutput: 'none' as const, streaming: false };

describe('stored model gateway (PostgreSQL and injected HTTP)', () => {
  it('invokes OpenAI only at the fixed destination and persists unknown externally billed usage once', async () => {
    const w = world();
    const ws = await cloud(w);
    const result = await ws.invoke();
    expect(result.kind).toBe('completed');
    expect(w.http).toHaveBeenCalledTimes(1);
    const [url, init] = w.http.mock.calls[0]!;
    expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${KEY}`);
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(String(init?.body)).model).toBe('custom-model');
    const rows = await usageRows(ws.workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: result.invocationId,
      provider: 'openai',
      model: 'custom-model',
      connection_id: ws.connection.id,
      connection_version: 1,
      target_version: 1,
      outcome: 'completed',
      input_tokens: 11,
      output_tokens: 7,
      cost_status: 'unknown',
      cost_reason: 'unknown_model_price',
      micro_usd: null,
    });
    expect(JSON.stringify([result, rows, await w.gateway.targets.list(ws.ctx)])).not.toContain(KEY);
    expect(rows[0]).not.toHaveProperty('request');
  });

  it('preserves missing usage as null and does not charge prepaid credits', async () => {
    const w = world();
    const ws = await cloud(w);
    w.http.mockImplementation(async () => reply('No usage', null));
    await ws.invoke();
    expect((await usageRows(ws.workspaceId))[0]).toMatchObject({
      outcome: 'completed',
      input_tokens: null,
      output_tokens: null,
      micro_usd: null,
      cost_status: 'unknown',
      cost_reason: 'usage_unavailable',
    });
    const ledger = await database.kysely
      .selectFrom('credit_ledger')
      .select('id')
      .where('workspace_id', '=', ws.workspaceId)
      .execute();
    expect(ledger).toHaveLength(0);
  });

  it('uses the Anthropic fixed destination and strips credentials reflected in errors', async () => {
    const w = world();
    const ws = await cloud(w, 'member', 'anthropic');
    w.http.mockImplementation(
      async () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: KEY } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const error = await ws.invoke().catch((error) => error);
    expect(error).toMatchObject({ code: 'auth' });
    expect(String(w.http.mock.calls[0]![0])).toBe('https://api.anthropic.com/v1/messages?beta=true');
    expect(w.http.mock.calls[0]![1]?.redirect).toBe('error');
    const rows = await usageRows(ws.workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'failed',
      failure_code: 'auth',
      micro_usd: null,
      cost_reason: 'usage_unavailable',
    });
    expect(JSON.stringify([error, toErrorEnvelope(error), rows])).not.toContain(KEY);
  });

  it('redacts upstream key reflection from successful content and raw thrown transport errors', async () => {
    const w = world();
    const ws = await cloud(w);
    w.http.mockImplementationOnce(async () => reply(`Provider reflected ${KEY}`));
    const result = await ws.invoke();
    expect(result.kind === 'completed' && result.response.text).toBe('Provider reflected [redacted]');
    expect(JSON.stringify(result)).not.toContain(KEY);
    w.http.mockImplementationOnce(async () => {
      throw new Error(KEY);
    });
    const error = await ws.invoke().catch((error) => error);
    expect(error).toMatchObject({ code: 'transient' });
    expect(JSON.stringify([error, toErrorEnvelope(error), await usageRows(ws.workspaceId)])).not.toContain(KEY);
    expect(await usageRows(ws.workspaceId)).toHaveLength(2);
  });

  it('requires owner access to personal keys and targets, including when another admin acts', async () => {
    const w = world();
    const ws = await cloud(w);
    const other = await addMember(ws);
    await database.kysely
      .updateTable('workspace_members')
      .set({ access_level: 'admin' })
      .where('id', '=', other.memberId)
      .execute();
    await expectCode(w.gateway.targets.get(other.ctx, ws.target.id), 'NOT_FOUND');
    await expectCode(w.gateway.invoke(other.ctx, { targetId: ws.target.id, expectedVersion: 1, request }), 'NOT_FOUND');
    await expectCode(w.gateway.targets.create(other.ctx, { ...ws.input, id: newId() }), 'NOT_FOUND');
    await expectCode(
      w.gateway.targets.create(ws.ctx, { ...ws.input, id: newId(), ownerKind: 'workspace' }),
      'FORBIDDEN',
    );
    expect(w.http).not.toHaveBeenCalled();
  });

  it('lets active members use workspace keys while only admins manage workspace targets', async () => {
    const w = world();
    const ws = await cloud(w, 'workspace');
    const other = await addMember(ws);
    expect(await w.gateway.targets.list(other.ctx)).toHaveLength(1);
    expect((await w.gateway.invoke(other.ctx, { targetId: ws.target.id, expectedVersion: 1, request })).kind).toBe(
      'completed',
    );
    await expectCode(w.gateway.targets.configure(other.ctx, { ...ws.input, expectedVersion: 1 }), 'FORBIDDEN');
    await expectCode(w.gateway.targets.disable(other.ctx, { id: ws.target.id, expectedVersion: 1 }), 'FORBIDDEN');
    await database.kysely
      .updateTable('workspace_members')
      .set({ access_level: 'suspended' })
      .where('id', '=', other.memberId)
      .execute();
    await expectCode(w.gateway.invoke(other.ctx, { targetId: ws.target.id, expectedVersion: 1, request }), 'FORBIDDEN');
    expect(w.http).toHaveBeenCalledTimes(1);
  });

  it('rejects stale connection versions, disabled targets/connections, removed members, and system/token actors before dispatch', async () => {
    const w = world();
    const ws = await cloud(w);
    await w.connections.rotate(ws.ctx, { id: ws.connection.id, expectedVersion: 1, apiKey: 'replacement-secret' });
    await expectCode(ws.invoke(), 'VERSION_CONFLICT');
    const configured = await w.gateway.targets.configure(ws.ctx, {
      ...ws.input,
      connectionVersion: 2,
      expectedVersion: 1,
    });
    await expectCode(ws.invoke(), 'VERSION_CONFLICT');
    await w.connections.disable(ws.ctx, { id: ws.connection.id, expectedVersion: 2 });
    await expect(
      w.gateway.invoke(ws.ctx, { targetId: configured.id, expectedVersion: configured.version, request }),
    ).rejects.toMatchObject({ code: 'not_configured' });
    await expectCode(
      w.gateway.invoke(ws.sys, { targetId: configured.id, expectedVersion: configured.version, request }),
      'FORBIDDEN',
    );
    await expectCode(
      w.gateway.invoke(
        { ...ws.ctx, actor: { type: 'api-token', id: newId() }, onBehalfOfMemberId: ws.memberId },
        { targetId: configured.id, expectedVersion: configured.version, request },
      ),
      'FORBIDDEN',
    );
    const second = await cloud(w);
    await w.gateway.targets.disable(second.ctx, { id: second.target.id, expectedVersion: 1 });
    await expect(
      w.gateway.invoke(second.ctx, { targetId: second.target.id, expectedVersion: 2, request }),
    ).rejects.toMatchObject({ code: 'not_configured' });
    await sql`UPDATE workspace_members SET removed_at = now() WHERE id = ${second.memberId}::uuid`.execute(
      database.kysely,
    );
    await expectCode(second.invoke(), 'FORBIDDEN');
    expect(w.http).not.toHaveBeenCalled();
  });

  it('enforces tenant/provider identity and rejects hosted endpoint overrides at registration', async () => {
    const w = world();
    const ws = await cloud(w);
    const elsewhere = await createWorkspace();
    await expectCode(w.gateway.targets.create(elsewhere.ctx, { ...ws.input, id: newId() }), 'NOT_FOUND');
    await expectCode(
      w.gateway.targets.create(ws.ctx, { ...ws.input, id: newId(), provider: 'anthropic' }),
      'FORBIDDEN',
    );
    for (const endpoint of [
      'https://custom.example/v1',
      'http://169.254.169.254/v1',
      'http://192.168.0.1/v1',
      'http://localhost/v1?api_key=secret',
    ]) {
      await expectCode(
        w.gateway.targets.create(ws.ctx, {
          id: newId(),
          name: 'Custom',
          kind: 'runner-local',
          ownerKind: 'member',
          provider: 'openai-compatible',
          model: 'local-model',
          runnerId: newId(),
          endpoint,
          features: localFeatures,
        }),
        'VALIDATION_ERROR',
      );
    }
    await expectCode(
      w.gateway.targets.create(ws.ctx, {
        ...ws.input,
        id: newId(),
        endpoint: 'https://custom.example',
      } as CreateModelTargetInput),
      'VALIDATION_ERROR',
    );
    expect(w.http).not.toHaveBeenCalled();
  });

  it('routes local endpoints only through an authorized runner and finalizes one immutable usage row with authenticated proof', async () => {
    const ws = await createWorkspace();
    const runnerId = newId();
    const proof = Symbol('authenticated session');
    const authorizeRunner = vi.fn<ModelGatewayOptions['authorizeRunner'] extends infer F ? NonNullable<F> : never>(
      async (tx, identity) => {
        if (tx.workspaceId !== ws.workspaceId || identity.memberId !== ws.memberId || identity.runnerId !== runnerId)
          throw new Error();
      },
    );
    const authenticateRunnerCompletion = vi.fn<NonNullable<ModelGatewayOptions['authenticateRunnerCompletion']>>(
      async (supplied) => {
        if (supplied !== proof) throw new Error('Unauthenticated');
        return { workspaceId: ws.workspaceId, runnerId, memberId: ws.memberId };
      },
    );
    const w = world({ authorizeRunner, authenticateRunnerCompletion });
    const input: CreateModelTargetInput = {
      id: newId(),
      name: 'Local model',
      kind: 'runner-local',
      ownerKind: 'member',
      provider: 'openai-compatible',
      model: 'local-model',
      runnerId,
      endpoint: 'http://127.0.0.1:11434/v1/',
      features: localFeatures,
    };
    const target = await w.gateway.targets.create(ws.ctx, input);
    const result = await w.gateway.invoke(ws.ctx, { targetId: target.id, expectedVersion: target.version, request });
    expect(result).toMatchObject({
      kind: 'runner-required',
      code: 'RUNNER_REQUIRED',
    });
    expect(JSON.stringify(result)).not.toContain(request.messages[0]!.content);
    const stored = await sql<{ encrypted: string }>`SELECT encrypted_request::text AS encrypted
      FROM model_runner_dispatches WHERE invocation_id = ${result.invocationId}::uuid`.execute(database.kysely);
    expect(stored.rows[0]!.encrypted).not.toContain(request.messages[0]!.content);
    const [dispatch] = await w.gateway.claimRunnerInvocations(proof);
    expect(dispatch).toMatchObject({
      invocationId: result.invocationId,
      targetId: target.id,
      targetVersion: 1,
      model: 'local-model',
      endpoint: 'http://127.0.0.1:11434/v1',
      request,
    });
    expect(await w.gateway.claimRunnerInvocations(proof)).toEqual([]);
    await w.gateway.heartbeatRunnerInvocation(
      { invocationId: result.invocationId, leaseGeneration: dispatch!.leaseGeneration },
      proof,
    );
    expect(await w.gateway.claimRunnerInvocations(proof)).toEqual([]);
    await sql`UPDATE model_runner_dispatches SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE invocation_id = ${result.invocationId}::uuid`.execute(database.kysely);
    const [reclaimed] = await w.gateway.claimRunnerInvocations(proof);
    expect(reclaimed!.leaseGeneration).not.toBe(dispatch!.leaseGeneration);
    expect(w.http).not.toHaveBeenCalled();
    expect((await usageRows(ws.workspaceId))[0]).toMatchObject({
      outcome: 'pending',
      micro_usd: null,
      cost_reason: 'usage_unavailable',
      runner_id: runnerId,
    });
    const completion = {
      invocationId: result.invocationId,
      leaseGeneration: reclaimed!.leaseGeneration,
      outcome: 'completed' as const,
      text: 'A local answer',
      usage: unknown,
    };
    await expectCode(w.gateway.completeRunnerInvocation(completion, null), 'FORBIDDEN');
    await expectCode(
      w.gateway.completeRunnerInvocation({ ...completion, leaseGeneration: dispatch!.leaseGeneration }, proof),
      'VERSION_CONFLICT',
    );
    await expectCode(
      w.gateway.completeRunnerInvocation({ ...completion, leaseGeneration: '999' }, proof),
      'VERSION_CONFLICT',
    );
    await w.gateway.completeRunnerInvocation(completion, proof);
    expect((await w.gateway.getRunnerInvocation(ws.ctx, result.invocationId)).text).toBe('A local answer');
    const settled = await sql<{ request: string | null; response: string }>`SELECT encrypted_request::text AS request,
      encrypted_response::text AS response FROM model_runner_dispatches
      WHERE invocation_id = ${result.invocationId}::uuid`.execute(database.kysely);
    expect(settled.rows[0]!.request).toBeNull();
    expect(settled.rows[0]!.response).not.toContain('A local answer');
    await w.gateway.completeRunnerInvocation(
      { ...completion, usage: { ...unknown, cost: { status: 'known', microUsd: 0 } } },
      proof,
    );
    const rows = await usageRows(ws.workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: 'completed',
      input_tokens: 11,
      micro_usd: null,
      cost_reason: 'unknown_model_price',
    });
    await expect(
      runInWorkspace(database, ws.ctx, (tx) =>
        tx.db.updateTable('model_invocations').set({ micro_usd: 0 }).where('id', '=', result.invocationId).execute(),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('expires unclaimed durable runner prompts after the absolute two-minute lifetime', async () => {
    const ws = await createWorkspace();
    const runnerId = newId();
    const proof = Symbol('runner proof');
    const w = world({
      authorizeRunner: async () => {},
      authenticateRunnerCompletion: async (supplied) => {
        if (supplied !== proof) throw new Error('Unauthenticated');
        return { workspaceId: ws.workspaceId, runnerId, memberId: ws.memberId };
      },
    });
    const target = await w.gateway.targets.create(ws.ctx, {
      id: newId(),
      name: 'Expiring local model',
      kind: 'runner-local',
      ownerKind: 'member',
      provider: 'openai-compatible',
      model: 'local-model',
      runnerId,
      endpoint: 'http://127.0.0.1:11434/v1',
      features: localFeatures,
    });
    const invocationId = newId();
    await sql`INSERT INTO model_invocations
      (id, workspace_id, target_id, target_version, member_id, provider, model, runner_id, outcome,
        cost_status, cost_reason, created_at)
      VALUES (${invocationId}::uuid, ${ws.workspaceId}::uuid, ${target.id}::uuid, ${target.version},
        ${ws.memberId}::uuid, 'openai-compatible', 'local-model', ${runnerId}::uuid, 'pending',
        'unknown', 'usage_unavailable', clock_timestamp() - interval '121 seconds')`.execute(database.kysely);
    await sql`INSERT INTO model_runner_dispatches
      (invocation_id, workspace_id, runner_id, target_id, target_version, encrypted_request, created_at)
      VALUES (${invocationId}::uuid, ${ws.workspaceId}::uuid, ${runnerId}::uuid, ${target.id}::uuid,
        ${target.version}, '{"test":"ciphertext"}'::jsonb, clock_timestamp() - interval '121 seconds')`.execute(
      database.kysely,
    );
    expect(await w.gateway.claimRunnerInvocations(proof)).toEqual([]);
    expect(await w.gateway.getRunnerInvocation(ws.ctx, invocationId)).toMatchObject({
      outcome: 'failed',
      failureCode: 'transient',
    });
    const { rows } = await sql<{ status: string; encryptedRequest: unknown }>`SELECT status,
      encrypted_request AS "encryptedRequest" FROM model_runner_dispatches
      WHERE invocation_id = ${invocationId}::uuid`.execute(database.kysely);
    expect(rows[0]).toMatchObject({ status: 'settled', encryptedRequest: null });
  });

  it('discards a completion that crosses the absolute deadline while waiting for a target lock', async () => {
    const ws = await createWorkspace();
    const runnerId = newId();
    const proof = Symbol('runner proof');
    const w = world({
      authorizeRunner: async () => {},
      authenticateRunnerCompletion: async () => ({
        workspaceId: ws.workspaceId,
        runnerId,
        memberId: ws.memberId,
      }),
    });
    const target = await w.gateway.targets.create(ws.ctx, {
      id: newId(),
      name: 'Deadline local model',
      kind: 'runner-local',
      ownerKind: 'member',
      provider: 'openai-compatible',
      model: 'local-model',
      runnerId,
      endpoint: 'http://127.0.0.1:11434/v1',
      features: localFeatures,
    });
    const invocationId = newId();
    await sql`INSERT INTO model_invocations
      (id, workspace_id, target_id, target_version, member_id, provider, model, runner_id, outcome,
        cost_status, cost_reason, created_at)
      VALUES (${invocationId}::uuid, ${ws.workspaceId}::uuid, ${target.id}::uuid, ${target.version},
        ${ws.memberId}::uuid, 'openai-compatible', 'local-model', ${runnerId}::uuid, 'pending',
        'unknown', 'usage_unavailable', clock_timestamp() - interval '119 seconds')`.execute(database.kysely);
    await sql`INSERT INTO model_runner_dispatches
      (invocation_id, workspace_id, runner_id, target_id, target_version, encrypted_request, status,
        lease_generation, lease_expires_at, created_at)
      VALUES (${invocationId}::uuid, ${ws.workspaceId}::uuid, ${runnerId}::uuid, ${target.id}::uuid,
        ${target.version}, '{"test":"ciphertext"}'::jsonb, 'leased', 1,
        clock_timestamp() + interval '60 seconds', clock_timestamp() - interval '119 seconds')`.execute(
      database.kysely,
    );
    let releaseTarget!: () => void;
    let reportLocked!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseTarget = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const blocker = database.kysely.transaction().execute(async (tx) => {
      await tx.selectFrom('model_targets').select('id').where('id', '=', target.id).forUpdate().execute();
      reportLocked();
      await release;
    });
    await locked;
    const completion = w.gateway.completeRunnerInvocation(
      { invocationId, leaseGeneration: '1', outcome: 'completed', text: 'too late', usage: unknown },
      proof,
    );
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    releaseTarget();
    await blocker;
    await completion;
    expect(await w.gateway.getRunnerInvocation(ws.ctx, invocationId)).toMatchObject({
      outcome: 'failed',
      failureCode: 'transient',
      text: null,
    });
  }, 10_000);

  it('fails closed for unenrolled runners and unconfigured completion authentication', async () => {
    const ws = await createWorkspace();
    const input: CreateModelTargetInput = {
      id: newId(),
      name: 'Local',
      kind: 'runner-local',
      ownerKind: 'member',
      provider: 'openai-compatible',
      model: 'local',
      runnerId: newId(),
      endpoint: 'http://localhost:1234/v1',
      features: localFeatures,
    };
    const closed = world();
    await expectCode(closed.gateway.targets.create(ws.ctx, input), 'FORBIDDEN');
    const w = world({ authorizeRunner: async () => {} });
    const target = await w.gateway.targets.create(ws.ctx, input);
    const result = await w.gateway.invoke(ws.ctx, { targetId: target.id, expectedVersion: 1, request });
    await expectCode(
      w.gateway.completeRunnerInvocation(
        { invocationId: result.invocationId, leaseGeneration: '1', outcome: 'completed', text: 'Answer' },
        {},
      ),
      'FORBIDDEN',
    );
    expect(w.http).not.toHaveBeenCalled();
  });

  it('rechecks credential revocation after reserving usage and immediately before dispatch', async () => {
    const w = world();
    const ws = await cloud(w);
    const original = database.kysely.transaction.bind(database.kysely);
    let completedTransactions = 0;
    const intercepted = vi.spyOn(database.kysely, 'transaction').mockImplementation(() => {
      const builder = original();
      const execute = builder.execute.bind(builder);
      builder.execute = async (callback) => {
        const result = await execute(callback);
        if (++completedTransactions === 1) {
          await sql`UPDATE provider_connections SET enabled = false, disabled_at = now(), version = version + 1
            WHERE id = ${ws.connection.id}::uuid`.execute(database.kysely);
        }
        return result;
      };
      return builder;
    });
    try {
      await expect(ws.invoke()).rejects.toMatchObject({ code: 'not_configured' });
    } finally {
      intercepted.mockRestore();
    }
    expect(w.http).not.toHaveBeenCalled();
    expect(await usageRows(ws.workspaceId)).toMatchObject([
      { outcome: 'failed', cost_status: 'unknown', micro_usd: null },
    ]);
  });

  it('authenticates runner identity independently, sanitizes failure codes, and records explicitly known cost', async () => {
    const ws = await createWorkspace();
    const runnerId = newId();
    const proof = Symbol();
    let valid = true;
    const w = world({
      authorizeRunner: async () => {},
      authenticateRunnerCompletion: async (supplied) => {
        if (supplied !== proof) throw new Error(KEY);
        return { workspaceId: ws.workspaceId, runnerId: valid ? runnerId : newId(), memberId: ws.memberId };
      },
    });
    const target = await w.gateway.targets.create(ws.ctx, {
      id: newId(),
      name: 'Local',
      kind: 'runner-local',
      ownerKind: 'member',
      provider: 'openai-compatible',
      model: 'local',
      runnerId,
      endpoint: 'http://[::1]:1234/v1',
      features: localFeatures,
    });
    const first = await w.gateway.invoke(ws.ctx, { targetId: target.id, expectedVersion: 1, request });
    const [firstDispatch] = await w.gateway.claimRunnerInvocations(proof);
    valid = false;
    await expectCode(
      w.gateway.completeRunnerInvocation(
        {
          invocationId: first.invocationId,
          leaseGeneration: firstDispatch!.leaseGeneration,
          outcome: 'completed',
          text: 'Answer',
        },
        proof,
      ),
      'NOT_FOUND',
    );
    valid = true;
    await w.gateway.completeRunnerInvocation(
      {
        invocationId: first.invocationId,
        leaseGeneration: firstDispatch!.leaseGeneration,
        outcome: 'failed',
        failureCode: KEY,
        usage: { ...unknown, inputTokens: -3, outputTokens: Number.NaN },
      },
      proof,
    );
    const second = await w.gateway.invoke(ws.ctx, { targetId: target.id, expectedVersion: 1, request });
    const [secondDispatch] = await w.gateway.claimRunnerInvocations(proof);
    await w.gateway.completeRunnerInvocation(
      {
        invocationId: second.invocationId,
        leaseGeneration: secondDispatch!.leaseGeneration,
        outcome: 'completed',
        text: 'Second local answer',
        usage: { ...unknown, cost: { status: 'known', microUsd: 123 } },
      },
      proof,
    );
    const rows = await usageRows(ws.workspaceId);
    expect(rows.find((row) => row.id === first.invocationId)).toMatchObject({
      outcome: 'failed',
      failure_code: 'provider',
      input_tokens: null,
      output_tokens: null,
      micro_usd: null,
    });
    expect(rows.find((row) => row.id === second.invocationId)).toMatchObject({
      outcome: 'completed',
      cost_status: 'known',
      cost_reason: null,
      micro_usd: '123',
    });
    expect(JSON.stringify(rows)).not.toContain(KEY);
    await database.kysely
      .updateTable('workspace_members')
      .set({ access_level: 'suspended' })
      .where('id', '=', ws.memberId)
      .execute();
    await expectCode(
      w.gateway.completeRunnerInvocation(
        {
          invocationId: second.invocationId,
          leaseGeneration: secondDispatch!.leaseGeneration,
          outcome: 'completed',
          text: 'Second local answer',
        },
        proof,
      ),
      'FORBIDDEN',
    );
    expect(w.http).not.toHaveBeenCalled();
  });

  it('releases database transactions before provider HTTP and never retries external calls', async () => {
    const w = world();
    const ws = await cloud(w);
    let arrived!: () => void;
    const atFetch = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    let release!: () => void;
    const finishFetch = new Promise<void>((resolve) => {
      release = resolve;
    });
    w.http.mockImplementation(async () => {
      arrived();
      await finishFetch;
      return reply();
    });
    const running = ws.invoke();
    await atFetch;
    let disabled = false;
    const disable = w.connections.disable(ws.ctx, { id: ws.connection.id, expectedVersion: 1 }).then(() => {
      disabled = true;
    });
    await disable;
    expect(disabled).toBe(true);
    release();
    await running;
    await expect(ws.invoke()).rejects.toMatchObject({ code: 'not_configured' });
    expect(w.http).toHaveBeenCalledTimes(1);
  });
});
