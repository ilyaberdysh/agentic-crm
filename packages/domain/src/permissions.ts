// Permission hook (BACKLOG 1.10, 6.04; J permissions §2–3, A §4.12): resolved action policies per (member, entity
// definition) as the 22 boolean flags. The domain wraps the configured base resolver (allow-all by default: active
// members Full access, suspended members nothing) in the slice-6 grant resolver (permissions/resolver.ts), so objects
// and lists resolve to the most permissive of their workspace, team and member grants. The subject is the acting
// member, the member behind a user-level API token, or a workflow; other actors are governed by their scopes.
import {
  type ActionFlag,
  type ActionFlags,
  flagsForScope,
  type ResolvePoliciesInput,
  type ResolvePoliciesOutput,
  resolvePoliciesInputSchema,
} from '@agentic-crm/contracts';
import { permissionMemberId } from './context.ts';
import { forbidden } from './errors.ts';
import { type DefInfo, loadDefinition } from './schema/model.ts';
import type { Tx } from './tx.ts';

export interface PolicySubject {
  /** null for non-member actors (system, workspace-level API tokens, workflows). */
  memberId: string | null;
  accessLevel: 'admin' | 'member' | 'suspended' | null;
  /** Workflow actors resolve with the workspace grant plus the workflow's own grant (J permissions §3). */
  workflowId?: string | null;
}

export interface PolicyResolver {
  resolve(tx: Tx, subject: PolicySubject, definitions: DefInfo[]): Promise<Map<string, ActionFlags>>;
}

/** Full access for everyone active; nothing for suspended members. */
export const allowAllResolver: PolicyResolver = {
  async resolve(_tx, subject, definitions) {
    const flags = flagsForScope(subject.accessLevel === 'suspended' ? 'no-access' : 'full-access');
    return new Map(definitions.map((d) => [d.id, flags]));
  },
};

export async function subjectOf(tx: Tx): Promise<PolicySubject> {
  const memberId = permissionMemberId(tx.ctx);
  if (!memberId) {
    const actor = tx.ctx.actor;
    return { memberId: null, accessLevel: null, workflowId: actor.type === 'workflow' ? actor.id : null };
  }
  const cached = tx.memo.get('policy-subject') as PolicySubject | undefined;
  if (cached) return cached;
  const row = await tx.db
    .selectFrom('workspace_members')
    .select('access_level')
    .where('id', '=', memberId)
    .executeTakeFirst();
  // An actor claiming a membership that does not exist in this workspace is treated like a suspended member.
  const subject: PolicySubject = { memberId, accessLevel: row?.access_level ?? 'suspended' };
  tx.memo.set('policy-subject', subject);
  return subject;
}

export function createPolicies(resolver: PolicyResolver) {
  return {
    /** Resolved action policies for the acting member (batch, per-id result). */
    async resolve(tx: Tx, input: ResolvePoliciesInput): Promise<ResolvePoliciesOutput> {
      const data = resolvePoliciesInputSchema.parse(input);
      const subject = await subjectOf(tx);
      const policies: ResolvePoliciesOutput['policies'] = {};
      const defs: DefInfo[] = [];
      for (const ref of data.entityDefinitionIds) {
        try {
          defs.push(await loadDefinition(tx, ref));
        } catch {
          policies[ref] = { state: 'error', error: 'NOT_FOUND' };
        }
      }
      const resolved = await resolver.resolve(tx, subject, defs);
      for (const def of defs) {
        const flags = resolved.get(def.id) ?? flagsForScope('no-access');
        const value = { workspaceMembershipId: subject.memberId, ...flags };
        policies[def.id] = { state: 'complete', value };
        if (def.apiSlug !== def.id && data.entityDefinitionIds.includes(def.apiSlug))
          policies[def.apiSlug] = { state: 'complete', value };
      }
      return { policies };
    },

    /** Resolved flags of the acting member per definition id (unknown → all false). */
    async flags(tx: Tx, defs: DefInfo[]): Promise<Map<string, ActionFlags>> {
      if (defs.length === 0) return new Map();
      return resolver.resolve(tx, await subjectOf(tx), defs);
    },

    /** The definitions on which the acting member may perform `flag` (list and search endpoints). */
    async allowed(tx: Tx, defs: DefInfo[], flag: ActionFlag): Promise<DefInfo[]> {
      if (defs.length === 0) return defs;
      const subject = await subjectOf(tx);
      const resolved = await resolver.resolve(tx, subject, defs);
      return defs.filter((d) => resolved.get(d.id)?.[flag] === true);
    },

    /**
     * The definitions on which another member (not the actor) may perform `flag` — e.g. whether the recipient of a
     * notification can read what it is about. Unknown or suspended members get nothing.
     */
    async allowedFor(tx: Tx, memberId: string, defs: DefInfo[], flag: ActionFlag): Promise<DefInfo[]> {
      if (defs.length === 0) return defs;
      const row = await tx.db
        .selectFrom('workspace_members')
        .select('access_level')
        .where('id', '=', memberId)
        .executeTakeFirst();
      if (!row || row.access_level === 'suspended') return [];
      const resolved = await resolver.resolve(tx, { memberId, accessLevel: row.access_level }, defs);
      return defs.filter((d) => resolved.get(d.id)?.[flag] === true);
    },

    /** Throws 403 unless the acting member may perform `flag` on the definition. */
    async assertCan(tx: Tx, entityDefinitionId: string, flag: ActionFlag): Promise<void> {
      const def = await loadDefinition(tx, entityDefinitionId);
      const subject = await subjectOf(tx);
      const flags = (await resolver.resolve(tx, subject, [def])).get(def.id);
      if (!flags?.[flag])
        throw forbidden('You do not have permission to do this', {
          entity_definition_id: def.id,
          entity_type: def.entityType,
          action: flag,
        });
    },
  };
}

export type Policies = ReturnType<typeof createPolicies>;
