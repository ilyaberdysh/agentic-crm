import { type ExecuteTaskCreateInput, memberContext, newId } from '@agentic-crm/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invokeTaskCreateTool, taskCreateTool } from '../src/agentic/task-tool';
import { toApiError, toEnvelope } from '../src/errors';
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
let user: TestUser;
let workspaceId: string;
let memberId: string;
const slug = `capability-${Date.now().toString(36)}`;
const ctx = () => memberContext(workspaceId, memberId);

beforeAll(async () => {
  h = await startHarness();
  user = await signUp(h);
  const ws = await createWorkspaceWithMembers(h, slug, [{ user }]);
  workspaceId = ws.workspaceId;
  memberId = ws.memberIds.get(user.id)!;
});
afterAll(async () => {
  await h?.close();
});

async function approvedAction() {
  const created = await h.domain.records.create(ctx(), {
    entityDefinitionId: 'companies',
    entityInstanceId: newId(),
    values: { name: [{ value: 'Capability test' }] },
  });
  const record = {
    entityDefinitionId: created.record.entityDefinitionId,
    entityInstanceId: created.record.entityInstanceId,
  };
  const note = await h.domain.notes.create(ctx(), { id: newId(), title: 'Request', parentRecords: [record] });
  const quote = 'Send the contract tomorrow.';
  await h.domain.documents.replaceContent(ctx(), { id: note.documentId, content: { markdown: quote } });
  const evidence = await h.domain.agentic.evidence.capture(ctx(), {
    id: newId(),
    scope: record,
    source: { kind: 'crm.note', id: note.id },
    band: 'VERIFIED',
    claim: 'Send contract',
    fragment: { start: 0, end: quote.length, quote },
  });
  const taskId = newId();
  const action = await h.domain.agentic.actions.propose(ctx(), {
    id: newId(),
    scope: record,
    diff: {
      operation: 'create',
      task: {
        id: taskId,
        content: { text: 'Send contract' },
        linkedRecords: [record],
        assigneeMemberIds: [memberId],
      },
    },
    evidenceIds: [evidence.id],
    reviewerMemberId: memberId,
  });
  const decision = await h.domain.agentic.actions.decide(ctx(), {
    id: newId(),
    actionId: action.id,
    proposalDigest: action.digest,
    expectedVersion: action.version,
    outcome: 'APPROVE',
  });
  const input: ExecuteTaskCreateInput = {
    id: newId(),
    receiptId: newId(),
    actionId: action.id,
    proposalDigest: action.digest,
    expectedVersion: decision.version,
  };
  return { input, taskId, record };
}

const rest = (input: unknown, origin = WEB_ORIGIN, cookie = user.cookie) =>
  fetch(`${h.baseUrl}/api/agentic/capabilities/crm.task.create/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie, 'x-workspace-slug': slug },
    body: JSON.stringify(input),
  });
const trpc = (input: unknown) => trpcCall(h, 'agentic.executeTaskCreate', input, { user, slug });

describe('crm.task.create product surface symmetry', () => {
  it('uses the same exact task, approval, attempt and immutable receipt from every adapter', async () => {
    expect(taskCreateTool.name).toBe('crm.task.create');
    expect(taskCreateTool.inputSchema.additionalProperties).toBe(false);
    for (const surface of ['trpc', 'rest', 'tool'] as const) {
      const fx = await approvedAction();
      const result =
        surface === 'trpc'
          ? await trpc(fx.input)
          : surface === 'rest'
            ? await (await rest(fx.input)).json()
            : (await invokeTaskCreateTool(h.domain, ctx(), fx.input)).structuredContent;
      expect(result).toMatchObject({
        capability: 'crm.task.create',
        action: { status: 'SUCCEEDED', version: 4 },
        receipt: {
          id: fx.input.receiptId,
          attemptId: fx.input.id,
          proposalDigest: fx.input.proposalDigest,
          outcome: { outcome: 'SUCCEEDED', result: { taskId: fx.taskId } },
        },
        seq: expect.any(String),
      });
      const expected = { ...(result as object), seq: null };
      expect(await trpc(fx.input)).toEqual(expected);
      expect(await (await rest(fx.input)).json()).toEqual(expected);
      expect((await invokeTaskCreateTool(h.domain, ctx(), fx.input)).structuredContent).toEqual(expected);
      expect(await h.domain.tasks.get(ctx(), fx.taskId)).toMatchObject({
        content: { text: 'Send contract' },
        linkedRecords: [fx.record],
        assigneeMemberIds: [memberId],
      });
      const counts = await h.db.query(
        `SELECT
        (SELECT count(*)::int FROM agentic_action_attempts WHERE action_id = $1) AS attempts,
        (SELECT count(*)::int FROM agentic_action_receipts WHERE action_id = $1) AS receipts`,
        [fx.input.actionId],
      );
      expect(counts.rows[0]).toEqual({ attempts: 1, receipts: 1 });
    }
  });

  it('returns identical live policy denial after approval with no effect from any adapter', async () => {
    const fx = await approvedAction();
    await h.domain.permissions.put(ctx(), {
      resourceKind: 'object',
      resourceId: fx.record.entityDefinitionId,
      target: { type: 'workspace' },
      level: 'no-access',
    });
    const rpc = await trpcError(trpc(fx.input));
    const response = await rest(fx.input);
    const restError = await response.json();
    let toolError: unknown;
    try {
      await invokeTaskCreateTool(h.domain, ctx(), fx.input);
    } catch (error) {
      toolError = error;
    }
    const normalized = toEnvelope(toApiError(toolError));
    expect(rpc.status).toBe(403);
    expect(response.status).toBe(403);
    expect(restError).toEqual(normalized);
    expect(rpc.body).toMatchObject(normalized);
    expect(normalized.additional_information).toMatchObject({
      effect: 'deny',
      reason: 'scope-denied',
      policyVersion: 1,
    });
    const counts = await h.db.query(
      `SELECT
      (SELECT count(*)::int FROM tasks WHERE id = $1) AS tasks,
      (SELECT count(*)::int FROM agentic_action_attempts WHERE action_id = $2) AS attempts`,
      [fx.taskId, fx.input.actionId],
    );
    expect(counts.rows[0]).toEqual({ tasks: 0, attempts: 0 });
  });

  it('authenticates REST and checks write origins and rejects replacement diff, actor and outcome fields', async () => {
    const input = {
      id: newId(),
      receiptId: newId(),
      actionId: newId(),
      proposalDigest: '0'.repeat(64),
      expectedVersion: 2,
    };
    expect((await rest(input, WEB_ORIGIN, '')).status).toBe(401);
    expect((await rest(input, 'https://untrusted.example')).status).toBe(403);
    for (const injection of [{ task: { text: 'Injected' } }, { actor: { type: 'system' } }, { outcome: 'SUCCEEDED' }]) {
      expect((await rest({ ...input, ...injection })).status).toBe(400);
      expect((await trpcError(trpc({ ...input, ...injection }))).status).toBe(400);
      await expect(invokeTaskCreateTool(h.domain, ctx(), { ...input, ...injection })).rejects.toMatchObject({
        name: 'ZodError',
      });
    }
    expect(
      (await fetch(`${h.baseUrl}/v2/agentic/capabilities/crm.task.create/execute`, { method: 'POST' })).status,
    ).toBe(404);
  });
});
