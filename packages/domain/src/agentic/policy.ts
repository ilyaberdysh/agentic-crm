import {
  type AgenticCapabilityRequest,
  type AgenticPolicyDecision,
  agentCapabilityGrantSchema,
  agenticCapabilityRequestSchema,
  agenticPolicyVersion,
  agenticPrincipalSchema,
  agentPrincipalSchema,
} from '@agentic-crm/contracts';
import { forbidden } from '../errors.ts';
import { kindOfDefinition } from '../permissions/resolve.ts';
import type { PolicyResolver } from '../permissions.ts';
import { loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';

/**
 * Trusted server integration, not model/tool/request input. principalOf must authenticate the runtime identity;
 * loadGrant must read current server-owned authority in this transaction's workspace. Missing integration denies.
 * Kept outside ServiceContext.actor until durable agent audit storage is introduced; never encode an agent as a
 * system actor to obtain the existing permission resolver's trusted-caller fallback.
 */
export interface AgentAuthoritySource {
  principalOf(tx: Tx): Promise<unknown>;
  loadGrant(tx: Tx, grantId: string): Promise<unknown>;
}

export interface AgenticPolicyOptions {
  /** The same configured, grant-wrapped resolver used by existing domain services. */
  resolver: PolicyResolver;
  agents?: AgentAuthoritySource;
}

const decision = (effect: AgenticPolicyDecision['effect'], reason: AgenticPolicyDecision['reason']) => ({
  effect,
  reason,
  policyVersion: agenticPolicyVersion,
});
const deny = (reason: AgenticPolicyDecision['reason']): AgenticPolicyDecision => decision('deny', reason);

/**
 * Executable capability boundary for the record/task slice. No flags, roles, grants, or principals are accepted
 * from request payloads. This service decides authority only; it never executes a mutation or records approval.
 */
export function createAgenticPolicy(options: AgenticPolicyOptions) {
  async function decide(tx: Tx, input: AgenticCapabilityRequest): Promise<AgenticPolicyDecision> {
    const parsed = agenticCapabilityRequestSchema.safeParse(input);
    if (!parsed.success) return deny('invalid-request');
    const request = parsed.data;

    // Human identity comes from the authenticated actor. Other legacy actor types have no executable authority
    // here unless the server explicitly authenticates them as an agent through AgentAuthoritySource.
    const actor = tx.ctx.actor;
    const parsedPrincipal = agenticPrincipalSchema.safeParse(
      actor.type === 'workspace-member' ? actor : await options.agents?.principalOf(tx),
    );
    if (!parsedPrincipal.success) return deny('unknown-principal');
    const principal = parsedPrincipal.data;
    if (actor.type !== 'workspace-member' && !agentPrincipalSchema.safeParse(principal).success)
      return deny('unknown-principal');

    let memberId: string;
    if (principal.type === 'agent') {
      // This holds even when a server grant mistakenly includes the approval capability.
      if (request.capability === 'agentic.action.approve') return deny('agent-approval-forbidden');
      const parsedGrant = agentCapabilityGrantSchema.safeParse(await options.agents?.loadGrant(tx, principal.grantId));
      if (!parsedGrant.success) return deny('grant-denied');
      const grant = parsedGrant.data;
      if (
        grant.id !== principal.grantId ||
        grant.workspaceId !== tx.workspaceId ||
        grant.agentId !== principal.id ||
        grant.revokedAt !== null ||
        Date.parse(grant.expiresAt) <= Date.parse(tx.now) ||
        !grant.capabilities.includes(request.capability) ||
        grant.scope.entityDefinitionId !== request.scope.entityDefinitionId ||
        grant.scope.entityInstanceId !== request.scope.entityInstanceId
      )
        return deny('grant-denied');
      memberId = grant.delegatedByMemberId;
    } else {
      memberId = principal.id;
    }

    // Delegation can only narrow the member's current access; removal, suspension and grant revocation take effect
    // on the next decision. Do not memoise this authority across calls or inherit trusted non-member defaults.
    const member = await tx.db
      .selectFrom('workspace_members')
      .select('access_level')
      .where('workspace_id', '=', tx.workspaceId)
      .where('id', '=', memberId)
      .where('removed_at', 'is', null)
      .executeTakeFirst();
    if (!member || (member.access_level !== 'admin' && member.access_level !== 'member')) return deny('member-denied');

    const def = (await loadDefinitionsByIds(tx, [request.scope.entityDefinitionId])).get(
      request.scope.entityDefinitionId,
    );
    if (!def || def.workspaceId !== tx.workspaceId || def.isArchived || kindOfDefinition(def) !== 'object')
      return deny('scope-denied');
    const record = await tx.db
      .selectFrom('entity_instances')
      .select('id')
      .where('workspace_id', '=', tx.workspaceId)
      .where('entity_definition_id', '=', def.id)
      .where('id', '=', request.scope.entityInstanceId)
      .where('archived_at', 'is', null)
      .where('merged_at', 'is', null)
      .executeTakeFirst();
    if (!record) return deny('scope-denied');

    // Tasks require readable linked records in the existing domain path; admin status is not a data bypass.
    const flags = await options.resolver.resolve(tx, { memberId, accessLevel: member.access_level }, [def]);
    if (flags.get(def.id)?.read_entity_instance !== true) return deny('scope-denied');

    if (principal.type === 'agent' && request.capability === 'crm.task.create')
      return decision('approval-required', 'human-approval-required');
    return decision('allow', 'allowed');
  }

  return {
    decide,
    /** Only an allow decision passes. Approval-required must enter the durable action path, never execute directly. */
    async assertCan(tx: Tx, input: AgenticCapabilityRequest): Promise<void> {
      const result = await decide(tx, input);
      if (result.effect !== 'allow') throw forbidden('Executable capability denied', { ...result });
    },
  };
}

export type AgenticPolicy = ReturnType<typeof createAgenticPolicy>;
