import {
  type AgentCapabilityGrant,
  type AgenticCapabilityRequest,
  type AgentPrincipal,
  agenticCapabilityRequestSchema,
  executableCapabilitySchema,
} from '@agentic-crm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { type AgentAuthoritySource, createAgenticPolicy } from '../src/agentic/policy.ts';
import type { ServiceContext } from '../src/context.ts';
import { grantResolver } from '../src/permissions/resolver.ts';
import { allowAllResolver } from '../src/permissions.ts';
import { runInWorkspace } from '../src/tx.ts';
import { addMember, collabFixture } from './collab-fixtures.ts';
import { database, domain, expectCode, newId } from './support/harness.ts';

const resolver = grantResolver(allowAllResolver);
const humanPolicy = createAgenticPolicy({ resolver });

const requestFor = (
  scope: AgenticCapabilityRequest['scope'],
  capability: AgenticCapabilityRequest['capability'] = 'crm.task.create',
): AgenticCapabilityRequest => ({
  capability,
  scope,
  policyVersion: 1,
});

async function agentFixture() {
  const fx = await collabFixture();
  const agent: AgentPrincipal = { type: 'agent', id: newId(), grantId: newId() };
  // The existing app actor is only an authenticated identity selector, never a trusted permission subject.
  const ctx: ServiceContext = { workspaceId: fx.workspaceId, actor: { type: 'app', id: agent.id } };
  let stored: unknown = {
    id: agent.grantId,
    workspaceId: fx.workspaceId,
    agentId: agent.id,
    delegatedByMemberId: fx.memberId,
    capabilities: ['crm.task.create', 'agentic.action.propose', 'agentic.action.approve'],
    scope: fx.record,
    expiresAt: '2099-01-01T00:00:00Z',
    revokedAt: null,
  } satisfies AgentCapabilityGrant;
  const source: AgentAuthoritySource = {
    principalOf: vi.fn(async (tx) => (tx.ctx.actor.type === 'app' && tx.ctx.actor.id === agent.id ? agent : null)),
    loadGrant: vi.fn(async (_tx, grantId) => (grantId === agent.grantId ? stored : null)),
  };
  const policy = createAgenticPolicy({ resolver, agents: source });
  return {
    ...fx,
    agent,
    agentCtx: ctx,
    policy,
    source,
    get grant() {
      return stored as AgentCapabilityGrant;
    },
    store(value: unknown) {
      stored = value;
    },
    decide(input = requestFor(fx.record)) {
      return runInWorkspace(database, ctx, (tx) => policy.decide(tx, input));
    },
  };
}

describe('executable capability policy', () => {
  it('uses a closed catalog and rejects unknown policies and injected authority in requests', async () => {
    const fx = await collabFixture();
    expect(executableCapabilitySchema.safeParse('user_level_object_permissions').success).toBe(false);
    const request = requestFor(fx.record);
    for (const input of [
      { ...request, capability: 'crm.task.delete' },
      { ...request, policyVersion: 2 },
      { ...request, principal: { type: 'workspace-member', id: fx.memberId } },
      { ...request, grant: { capabilities: ['crm.task.create'] } },
    ]) {
      expect(agenticCapabilityRequestSchema.safeParse(input).success).toBe(false);
      expect(await runInWorkspace(database, fx.ctx, (tx) => humanPolicy.decide(tx, input as never))).toMatchObject({
        effect: 'deny',
        reason: 'invalid-request',
      });
    }
  });

  it('derives human identity from the authenticated member and checks current access', async () => {
    const fx = await collabFixture();
    for (const capability of ['crm.task.create', 'agentic.action.propose', 'agentic.action.approve'] as const) {
      expect(
        await runInWorkspace(database, fx.ctx, (tx) => humanPolicy.decide(tx, requestFor(fx.record, capability))),
      ).toEqual({ effect: 'allow', reason: 'allowed', policyVersion: 1 });
    }
    const unknown = { ...fx.ctx, actor: { type: 'workspace-member' as const, id: newId() } };
    expect(
      await runInWorkspace(database, unknown, (tx) => humanPolicy.decide(tx, requestFor(fx.record))),
    ).toMatchObject({ effect: 'deny', reason: 'member-denied' });
    const other = await collabFixture();
    expect(
      await runInWorkspace(database, { ...fx.ctx, actor: other.ctx.actor }, (tx) =>
        humanPolicy.decide(tx, requestFor(fx.record)),
      ),
    ).toMatchObject({ effect: 'deny', reason: 'member-denied' });
    const member = await addMember(fx);
    await domain.members.suspend(fx.ctx, member.memberId);
    expect(
      await runInWorkspace(database, member.ctx, (tx) => humanPolicy.decide(tx, requestFor(fx.record))),
    ).toMatchObject({ effect: 'deny', reason: 'member-denied' });
  });

  it('denies unknown and legacy non-member actors without an explicit authenticated agent source', async () => {
    const fx = await collabFixture();
    for (const type of ['system', 'api-token', 'workflow', 'app', 'unknown'] as const) {
      const ctx = { workspaceId: fx.workspaceId, actor: { type, id: newId() } } as ServiceContext;
      expect(await runInWorkspace(database, ctx, (tx) => humanPolicy.decide(tx, requestFor(fx.record)))).toMatchObject({
        effect: 'deny',
        reason: 'unknown-principal',
      });
    }
  });

  it('hydrates an exact agent grant on the server and requires human approval for task creation', async () => {
    const fx = await agentFixture();
    expect(await fx.decide(requestFor(fx.record, 'agentic.action.propose'))).toMatchObject({ effect: 'allow' });
    expect(await fx.decide()).toMatchObject({ effect: 'approval-required', reason: 'human-approval-required' });
    expect(fx.source.loadGrant).toHaveBeenCalledWith(expect.anything(), fx.agent.grantId);
    await expectCode(
      runInWorkspace(database, fx.agentCtx, (tx) => fx.policy.assertCan(tx, requestFor(fx.record))),
      'FORBIDDEN',
      403,
    );
    fx.store(null);
    expect(await fx.decide()).toMatchObject({ effect: 'deny', reason: 'grant-denied' });
  });

  it('denies agents approval even if their grant contains the approval capability', async () => {
    const fx = await agentFixture();
    expect(await fx.decide(requestFor(fx.record, 'agentic.action.approve'))).toMatchObject({
      effect: 'deny',
      reason: 'agent-approval-forbidden',
    });
    expect(fx.source.loadGrant).not.toHaveBeenCalled();
    await expectCode(
      runInWorkspace(database, fx.agentCtx, (tx) =>
        fx.policy.assertCan(tx, requestFor(fx.record, 'agentic.action.approve')),
      ),
      'FORBIDDEN',
      403,
    );
  });

  it('rejects mismatched, expired, revoked, malformed and insufficient grants', async () => {
    const fx = await agentFixture();
    const valid = fx.grant;
    for (const patch of [
      { id: newId() },
      { agentId: newId() },
      { workspaceId: newId() },
      { expiresAt: '2000-01-01T00:00:00Z' },
      { revokedAt: '2026-01-01T00:00:00Z' },
      { capabilities: ['agentic.action.propose'] },
      { capabilities: ['crm.task.create', 'unknown'] },
      { scope: { ...fx.record, entityDefinitionId: newId() } },
      { scope: { ...fx.record, entityInstanceId: newId() } },
      { expiresAt: 'invalid' },
      { allowed: true },
    ]) {
      fx.store({ ...valid, ...patch });
      expect(await fx.decide(), JSON.stringify(patch)).toMatchObject({ effect: 'deny', reason: 'grant-denied' });
    }
  });

  it('never lets an agent source impersonate a human or attach capabilities to a principal', async () => {
    const fx = await agentFixture();
    for (const principal of [
      { type: 'workspace-member', id: fx.memberId },
      { type: 'unknown', id: fx.agent.id },
      { ...fx.agent, capabilities: ['crm.task.create'] },
      { ...fx.agent, id: null },
    ]) {
      const policy = createAgenticPolicy({ resolver, agents: { ...fx.source, principalOf: async () => principal } });
      expect(
        await runInWorkspace(database, fx.agentCtx, (tx) => policy.decide(tx, requestFor(fx.record))),
      ).toMatchObject({ effect: 'deny', reason: 'unknown-principal' });
    }
  });

  it('intersects grants with live member access and denies permission revocation without an admin bypass', async () => {
    const fx = await agentFixture();
    expect(await fx.decide(requestFor(fx.record, 'agentic.action.propose'))).toMatchObject({ effect: 'allow' });
    await domain.permissions.put(fx.ctx, {
      resourceKind: 'object',
      resourceId: fx.companies,
      target: { type: 'workspace' },
      level: 'no-access',
    });
    expect(await fx.decide()).toMatchObject({ effect: 'deny', reason: 'scope-denied' });
    expect(await runInWorkspace(database, fx.ctx, (tx) => humanPolicy.decide(tx, requestFor(fx.record)))).toMatchObject(
      { effect: 'deny', reason: 'scope-denied' },
    );
    const delegate = await addMember(fx);
    fx.store({ ...fx.grant, delegatedByMemberId: delegate.memberId });
    await domain.members.suspend(fx.ctx, delegate.memberId);
    expect(await fx.decide()).toMatchObject({ effect: 'deny', reason: 'member-denied' });
  });

  it('denies missing or cross-workspace delegated members and does not trust a resolver with missing flags', async () => {
    const fx = await agentFixture();
    const other = await collabFixture();
    const valid = fx.grant;
    for (const delegatedByMemberId of [newId(), other.memberId]) {
      fx.store({ ...valid, delegatedByMemberId });
      expect(await fx.decide()).toMatchObject({ effect: 'deny', reason: 'member-denied' });
    }
    const policy = createAgenticPolicy({ resolver: { resolve: async () => new Map() } });
    expect(await runInWorkspace(database, fx.ctx, (tx) => policy.decide(tx, requestFor(fx.record)))).toMatchObject({
      effect: 'deny',
      reason: 'scope-denied',
    });
  });

  it('checks the live record and definition in the current workspace', async () => {
    const fx = await collabFixture();
    const other = await collabFixture();
    for (const scope of [
      other.record,
      { ...fx.record, entityDefinitionId: newId() },
      { ...fx.record, entityInstanceId: newId() },
      { entityDefinitionId: fx.people, entityInstanceId: fx.company },
    ]) {
      expect(await runInWorkspace(database, fx.ctx, (tx) => humanPolicy.decide(tx, requestFor(scope)))).toMatchObject({
        effect: 'deny',
        reason: 'scope-denied',
      });
    }
    await domain.records.delete(fx.ctx, fx.record);
    expect(await runInWorkspace(database, fx.ctx, (tx) => humanPolicy.decide(tx, requestFor(fx.record)))).toMatchObject(
      { effect: 'deny', reason: 'scope-denied' },
    );
  });
});
