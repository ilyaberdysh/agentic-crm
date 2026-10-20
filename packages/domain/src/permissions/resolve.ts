// Effective access (J permissions §3 "Access priority rules"): the most permissive of the workspace grant (or the
// kind's default when the resource has none), the grants of the member's teams and the member's own grant.
// Workflows get the workspace grant plus their own grant. Workspace-level API tokens and internal callers are not
// grantees: they are governed by their scopes (decision in slice6-server.md), i.e. full access here.
//
// Ties pick the most specific source that is not lower than the others — own grant, then the workspace, then a team —
// so the ⚠ tooltip says 'Inheriting "…" from the workspace' rather than naming a team that merely matches it.
import {
  type AccessScope,
  accessScopeRank,
  type EffectiveAccess,
  type PermissionSource,
  type ResourceKind,
  resourceKindDefaults,
} from '@agentic-crm/contracts';
import type { PolicySubject } from '../permissions.ts';
import type { DefInfo } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { type ResourceGrants, teamsOfMember } from './grants.ts';

export type Principal =
  | { type: 'member'; memberId: string; teamIds: string[]; suspended: boolean }
  | { type: 'team'; teamId: string }
  | { type: 'workflow'; workflowId: string }
  | { type: 'trusted'; reason: 'token' | 'system' };

const source = (type: PermissionSource['type'], id: string | null = null, name: string | null = null) => ({
  type,
  id,
  name,
});

/** The workspace level of a resource: its workspace grant, else the workspace's / kind's default. */
export function workspaceLevel(
  kind: ResourceKind,
  grants: ResourceGrants | undefined,
): { level: AccessScope; source: PermissionSource } {
  const ws = grants?.workspace ?? null;
  return ws !== null
    ? { level: ws, source: source('workspace') }
    : { level: resourceKindDefaults[kind].implicitWorkspaceScope, source: source('default') };
}

export function effectiveAccess(
  kind: ResourceKind,
  grants: ResourceGrants | undefined,
  principal: Principal,
): EffectiveAccess {
  if (principal.type === 'trusted') return { level: 'full-access', source: source(principal.reason) };
  if (principal.type === 'member' && principal.suspended) return { level: 'no-access', source: source('member') };
  const candidates: { level: AccessScope; source: PermissionSource; priority: number }[] = [
    { ...workspaceLevel(kind, grants), priority: 1 },
  ];
  if (principal.type === 'member') {
    const own = grants?.members.get(principal.memberId);
    if (own) candidates.push({ level: own, source: source('member', principal.memberId), priority: 0 });
    for (const teamId of principal.teamIds) {
      const level = grants?.teams.get(teamId);
      if (level) candidates.push({ level, source: source('team', teamId), priority: 2 });
    }
  } else if (principal.type === 'team') {
    const own = grants?.teams.get(principal.teamId);
    if (own) candidates.push({ level: own, source: source('team', principal.teamId), priority: 0 });
  } else {
    const own = grants?.workflows.get(principal.workflowId);
    if (own) candidates.push({ level: own, source: source('workflow', principal.workflowId), priority: 0 });
  }
  let best = candidates[0] as (typeof candidates)[number];
  for (const c of candidates.slice(1)) {
    const diff = accessScopeRank[c.level] - accessScopeRank[best.level];
    if (diff > 0 || (diff === 0 && c.priority < best.priority)) best = c;
  }
  return { level: best.level, source: best.source };
}

/** Object or list (governed by grants); other definitions (tasks, members, interfaces) are not shareable resources. */
export function kindOfDefinition(def: DefInfo): 'object' | 'list' | null {
  if (def.entityType === 'collection-entry') return 'list';
  if (OBJECT_TYPES.has(def.entityType)) return 'object';
  return null;
}
const OBJECT_TYPES = new Set(['person-record', 'company-record', 'standard-object', 'custom-record']);

/** The principal a policy subject resolves as. */
export async function principalOf(tx: Tx, subject: PolicySubject): Promise<Principal> {
  if (subject.memberId) {
    const suspended = subject.accessLevel === 'suspended';
    return {
      type: 'member',
      memberId: subject.memberId,
      teamIds: suspended ? [] : await teamsOfMember(tx, subject.memberId),
      suspended,
    };
  }
  if (subject.workflowId) return { type: 'workflow', workflowId: subject.workflowId };
  return { type: 'trusted', reason: tx.ctx.actor.type === 'system' ? 'system' : 'token' };
}
