import { type Action, memberContext, newId, type RecordAgentState } from '@agentic-crm/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  trpcCall,
  trpcError,
} from './support/harness';

let h: Harness;
let user: TestUser;
let workspaceId: string;
let memberId: string;
const slug = `record-agent-${Date.now().toString(36)}`;
const ctx = () => memberContext(workspaceId, memberId);
const call = <T>(path: string, input: unknown) => trpcCall<T>(h, path, input, { user, slug });

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

async function fixture() {
  const created = await h.domain.records.create(ctx(), {
    entityDefinitionId: 'companies',
    entityInstanceId: newId(),
    values: { name: [{ value: 'Review test' }] },
  });
  const scope = {
    entityDefinitionId: created.record.entityDefinitionId,
    entityInstanceId: created.record.entityInstanceId,
  };
  const note = await h.domain.notes.create(ctx(), { id: newId(), title: 'Request', parentRecords: [scope] });
  const quote = 'Send the contract tomorrow.';
  await h.domain.documents.replaceContent(ctx(), { id: note.documentId, content: { markdown: quote } });
  const evidence = await h.domain.agentic.evidence.capture(ctx(), {
    id: newId(),
    scope,
    source: { kind: 'crm.note', id: note.id },
    band: 'VERIFIED',
    claim: 'Send contract',
    fragment: { start: 0, end: quote.length, quote },
  });
  const action = await h.domain.agentic.actions.propose(ctx(), {
    id: newId(),
    scope,
    diff: { operation: 'create', task: { id: newId(), content: { text: 'Send contract' }, linkedRecords: [scope] } },
    evidenceIds: [evidence.id],
    reviewerMemberId: memberId,
  });
  const decision = {
    id: newId(),
    actionId: action.id,
    proposalDigest: action.digest,
    expectedVersion: action.version,
    outcome: 'APPROVE',
  };
  return { scope, note, action, evidence, decision };
}

describe('record agent tRPC surface', () => {
  it('reads persisted proposal and evidence, decides exact intent, executes and reads a receipt on refresh', async () => {
    const fx = await fixture();
    const initial = await call<RecordAgentState>('agentic.recordState', { scope: fx.scope });
    expect(initial).toMatchObject({
      scope: fx.scope,
      actions: [{ action: fx.action, evidence: [fx.evidence], receipt: null }],
      tasks: [],
      unavailableActionCount: 0,
    });
    const decision = await call<Pick<Action, 'id' | 'status' | 'version'> & { seq: string }>(
      'agentic.decide',
      fx.decision,
    );
    expect(decision).toEqual({ id: fx.action.id, status: 'APPROVED', version: 2, seq: expect.any(String) });
    expect(await call('agentic.decide', fx.decision)).toEqual({ ...decision, seq: null });
    const execute = {
      id: newId(),
      receiptId: newId(),
      actionId: fx.action.id,
      proposalDigest: fx.action.digest,
      expectedVersion: decision.version,
    };
    await call('agentic.executeTaskCreate', execute);
    const refreshed = await call<RecordAgentState>('agentic.recordState', { scope: fx.scope });
    expect(refreshed.actions[0]).toMatchObject({
      action: { status: 'SUCCEEDED', version: 4 },
      receipt: {
        id: execute.receiptId,
        proposalDigest: fx.action.digest,
        outcome: { outcome: 'SUCCEEDED', result: { taskId: fx.action.proposal.diff.task.id } },
        createdAt: expect.any(String),
      },
    });
  });

  it('rejects stale decision CAS, supports rejection without effect, and prevents input replacement', async () => {
    const fx = await fixture();
    expect((await trpcError(call('agentic.decide', { ...fx.decision, expectedVersion: 999 }))).status).toBe(409);
    for (const injection of [{ proposal: {} }, { actor: { type: 'system' } }, { diff: { task: {} } }]) {
      expect((await trpcError(call('agentic.decide', { ...fx.decision, ...injection }))).status).toBe(400);
    }
    const rejected = await call('agentic.decide', { ...fx.decision, outcome: 'REJECT' });
    expect(rejected).toMatchObject({ status: 'REJECTED', version: 2 });
    const state = await call<RecordAgentState>('agentic.recordState', { scope: fx.scope });
    expect(state.actions[0]!.action.status).toBe('REJECTED');
    expect(state.actions[0]!.receipt).toBeNull();
    const effects = await h.db.query('SELECT count(*) FROM tasks WHERE id = $1', [fx.action.proposal.diff.task.id]);
    expect(effects.rows[0].count).toBe('0');
  });

  it('requires a session and omits stale evidence without leaking the captured proposal', async () => {
    const fx = await fixture();
    expect((await trpcError(trpcCall(h, 'agentic.recordState', { scope: fx.scope }, { slug }))).status).toBe(401);
    await h.domain.documents.replaceContent(ctx(), {
      id: fx.note.documentId,
      content: { markdown: 'Request withdrawn.' },
    });
    const state = await call<RecordAgentState>('agentic.recordState', { scope: fx.scope });
    expect(state).toMatchObject({ actions: [], unavailableActionCount: 1 });
    expect(JSON.stringify(state)).not.toContain('Send contract');
  });
});
