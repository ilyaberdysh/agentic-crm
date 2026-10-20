import { type AiModelsOutput, type AiTurn, aiTargetModelChoice } from '@agentic-crm/contracts';
import { memberContext, newId, systemContext } from '@agentic-crm/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  trpcCall,
  trpcError,
  WEB_ORIGIN,
} from './support/harness';

let h: Harness;
let alice: TestUser;
let bob: TestUser;
let workspaceId: string;
let aliceMemberId: string;
const slug = `ask-byo-${Date.now().toString(36)}`;
const call = <T>(user: TestUser, path: string, input?: unknown) => trpcCall<T>(h, path, input, { user, slug });

beforeAll(async () => {
  h = await startHarness();
  alice = await signUp(h, 'Alice Target');
  bob = await signUp(h, 'Bob Target');
  const workspace = await createWorkspaceWithMembers(h, slug, [{ user: alice, admin: true }, { user: bob }]);
  workspaceId = workspace.workspaceId;
  aliceMemberId = workspace.memberIds.get(alice.id)!;
});
afterAll(async () => h?.close());

describe('Ask saved-target product route', () => {
  it('selects a private local target, delivers attached CRM context only to its runner, and streams the saved answer', async () => {
    const ctx = memberContext(workspaceId, aliceMemberId);
    const enrollment = await h.domain.agentic.runners.createEnrollment(ctx);
    const enrolled = await h.domain.agentic.runners.enroll(systemContext(workspaceId, 'test-enrollment'), {
      id: newId(),
      token: enrollment.token,
      name: 'Alice local models',
    });
    const targetId = newId();
    await call(alice, 'agentic.models.targets.create', {
      id: targetId,
      name: 'Local CRM model',
      kind: 'runner-local',
      ownerKind: 'member',
      provider: 'openai-compatible',
      model: 'local-crm',
      runnerId: enrolled.id,
      endpoint: 'http://localhost:11434/v1',
      features: { text: true, clientTools: false, structuredOutput: 'none', streaming: false },
    });
    const model = aiTargetModelChoice(targetId, 1);
    expect((await call<AiModelsOutput>(alice, 'ai.models.list')).models.some((m) => m.id === model)).toBe(true);
    expect((await call<AiModelsOutput>(bob, 'ai.models.list')).models.some((m) => m.id === model)).toBe(false);
    expect(
      (await trpcError(call(bob, 'ai.turns.send', { threadId: newId(), model, content: 'Private target' }))).status,
    ).toBe(404);
    expect(
      (await trpcError(trpcCall(h, 'ai.turns.send', { threadId: newId(), model, content: 'Anonymous' }, { slug })))
        .status,
    ).toBe(401);
    const companies = (await h.domain.schema.getObject(ctx, 'companies')).id;
    const recordId = newId();
    await h.domain.records.create(ctx, {
      entityDefinitionId: companies,
      entityInstanceId: recordId,
      values: { name: [{ value: 'Attached Acme' }] },
    });
    const sent = await call<{ threadId: string; turnId: string }>(alice, 'ai.turns.send', {
      threadId: newId(),
      model,
      content: 'Summarize the company',
      context: { records: [{ entityDefinitionId: companies, entityInstanceId: recordId }] },
    });
    let dispatch: { invocationId: string; leaseGeneration: string; request: unknown } | undefined;
    await vi.waitFor(async () => {
      const response = await fetch(`${h.baseUrl}/api/agentic/models/runner/claim`, {
        method: 'POST',
        headers: { authorization: `Bearer ${enrolled.bearerToken}`, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(200);
      dispatch = ((await response.json()) as (typeof dispatch)[])[0];
      expect(dispatch).toBeDefined();
    });
    expect(JSON.stringify(dispatch!.request)).toContain('Attached Acme');
    expect((await trpcError(call(bob, 'agentic.models.result', dispatch!.invocationId))).status).toBe(404);
    const completion = await fetch(`${h.baseUrl}/api/agentic/models/runner/complete`, {
      method: 'POST',
      headers: { authorization: `Bearer ${enrolled.bearerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        invocationId: dispatch!.invocationId,
        leaseGeneration: dispatch!.leaseGeneration,
        outcome: 'completed',
        text: 'Attached Acme is the selected company.',
      }),
    });
    expect(completion.status).toBe(200);
    await h.domain.ai.turns.settled(sent.turnId);
    const turn = await call<AiTurn>(alice, 'ai.turns.get', { turnId: sent.turnId });
    expect(turn).toMatchObject({ status: 'completed', model, creditCost: null, contextTokens: null });
    expect(turn.steps[0]?.parts).toMatchObject([{ type: 'text', content: 'Attached Acme is the selected company.' }]);
    const sse = await fetch(`${h.baseUrl}/ai/threads/${sent.threadId}/stream?turnId=${sent.turnId}`, {
      headers: { cookie: alice.cookie, 'x-workspace-slug': slug, origin: WEB_ORIGIN },
    });
    expect(sse.status).toBe(200);
    expect(await sse.text()).toContain('Attached Acme is the selected company.');
    expect((await trpcError(call(bob, 'ai.turns.get', { turnId: sent.turnId }))).status).toBe(404);
    const rows = await h.db.query('SELECT cost_status, micro_usd FROM model_invocations WHERE id = $1', [
      dispatch!.invocationId,
    ]);
    expect(rows.rows[0]).toMatchObject({ cost_status: 'unknown', micro_usd: null });
  });
});
