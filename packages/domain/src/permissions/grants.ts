// Grant storage for every resource kind (B.12, J permissions §3): objects and lists keep their grants in
// entity_definition_permissions (migration 0500), dashboards / workflows / sequences in resource_permissions
// (migration 0650). Reads are memoised per transaction; every writer goes through writeGrant / deleteGrantsOf, which
// forget the memo (and the slice-4 list memo).
import type { AccessScope, ResourceKind } from '@agentic-crm/contracts';
import { jsonb } from '@agentic-crm/db';
import { newId } from '../ids.ts';
import { forgetGrants as forgetListGrants } from '../lists/access.ts';
import type { Tx } from '../tx.ts';

export type StoredTargetType = 'workspace' | 'team' | 'workspace-member' | 'workflow';

export interface GrantRow {
  id: string;
  resourceId: string;
  targetType: StoredTargetType;
  targetId: string;
  scope: AccessScope;
  createdBy: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceGrants {
  /** The workspace grant's level; null when the resource has none (the kind default applies). */
  workspace: AccessScope | null;
  teams: Map<string, AccessScope>;
  members: Map<string, AccessScope>;
  workflows: Map<string, AccessScope>;
  rows: GrantRow[];
}

const MEMO = 'grants:';
const memoKey = (kind: ResourceKind, id: string) => `${MEMO}${kind}:${id}`;

const isEntityKind = (kind: ResourceKind) => kind === 'object' || kind === 'list';

function emptyGrants(): ResourceGrants {
  return { workspace: null, teams: new Map(), members: new Map(), workflows: new Map(), rows: [] };
}

/** Grants of resources of one kind (unknown ids get empty grants). */
export async function loadResourceGrants(
  tx: Tx,
  kind: ResourceKind,
  resourceIds: string[],
): Promise<Map<string, ResourceGrants>> {
  const out = new Map<string, ResourceGrants>();
  const missing: string[] = [];
  for (const id of new Set(resourceIds)) {
    const cached = tx.memo.get(memoKey(kind, id)) as ResourceGrants | undefined;
    if (cached) out.set(id, cached);
    else missing.push(id);
  }
  if (missing.length === 0) return out;
  const rows: GrantRow[] = isEntityKind(kind)
    ? (
        await tx.db
          .selectFrom('entity_definition_permissions')
          .selectAll()
          .where('entity_definition_id', 'in', missing)
          .orderBy('created_at')
          .orderBy('id')
          .execute()
      ).map((r) => ({
        id: r.id,
        resourceId: r.entity_definition_id,
        targetType: r.target_type,
        targetId: r.target_id,
        scope: r.scope as AccessScope,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
    : (
        await tx.db
          .selectFrom('resource_permissions')
          .selectAll()
          .where('resource_kind', '=', kind as 'dashboard' | 'workflow' | 'sequence')
          .where('resource_id', 'in', missing)
          .orderBy('created_at')
          .orderBy('id')
          .execute()
      ).map((r) => ({
        id: r.id,
        resourceId: r.resource_id,
        targetType: r.target_type,
        targetId: r.target_id,
        scope: r.scope,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
  for (const id of missing) {
    const g = emptyGrants();
    for (const r of rows) {
      if (r.resourceId !== id) continue;
      g.rows.push(r);
      if (r.targetType === 'workspace') g.workspace = r.scope;
      else if (r.targetType === 'team') g.teams.set(r.targetId, r.scope);
      else if (r.targetType === 'workspace-member') g.members.set(r.targetId, r.scope);
      else g.workflows.set(r.targetId, r.scope);
    }
    tx.memo.set(memoKey(kind, id), g);
    out.set(id, g);
  }
  return out;
}

export function forgetResourceGrants(tx: Tx): void {
  for (const key of [...tx.memo.keys()]) if (key.startsWith(MEMO)) tx.memo.delete(key);
  forgetListGrants(tx);
}

/** Upserts (scope) or removes (null) one grant. */
export async function writeGrant(
  tx: Tx,
  kind: ResourceKind,
  resourceId: string,
  target: { type: StoredTargetType; id: string },
  scope: AccessScope | null,
): Promise<void> {
  if (isEntityKind(kind)) {
    if (scope === null) {
      await tx.db
        .deleteFrom('entity_definition_permissions')
        .where('entity_definition_id', '=', resourceId)
        .where('target_type', '=', target.type)
        .where('target_id', '=', target.id)
        .execute();
    } else {
      await tx.db
        .insertInto('entity_definition_permissions')
        .values({
          id: newId(),
          workspace_id: tx.workspaceId,
          entity_definition_id: resourceId,
          target_type: target.type,
          target_id: target.id,
          scope,
          created_by: jsonb(tx.ctx.actor),
          created_at: tx.now,
          updated_at: tx.now,
        })
        .onConflict((oc) =>
          oc.columns(['entity_definition_id', 'target_type', 'target_id']).doUpdateSet({ scope, updated_at: tx.now }),
        )
        .execute();
    }
  } else {
    const resourceKind = kind as 'dashboard' | 'workflow' | 'sequence';
    if (scope === null) {
      await tx.db
        .deleteFrom('resource_permissions')
        .where('resource_kind', '=', resourceKind)
        .where('resource_id', '=', resourceId)
        .where('target_type', '=', target.type)
        .where('target_id', '=', target.id)
        .execute();
    } else {
      await tx.db
        .insertInto('resource_permissions')
        .values({
          id: newId(),
          workspace_id: tx.workspaceId,
          resource_kind: resourceKind,
          resource_id: resourceId,
          target_type: target.type,
          target_id: target.id,
          scope,
          created_by: jsonb(tx.ctx.actor),
          created_at: tx.now,
          updated_at: tx.now,
        })
        .onConflict((oc) =>
          oc
            .columns(['resource_kind', 'resource_id', 'target_type', 'target_id'])
            .doUpdateSet({ scope, updated_at: tx.now }),
        )
        .execute();
    }
  }
  forgetResourceGrants(tx);
}

/** Removes every grant that targets a team or member (team deleted, member removed); returns the touched resources. */
export async function deleteGrantsOf(
  tx: Tx,
  target: { type: 'team' | 'workspace-member'; id: string },
): Promise<{ kind: ResourceKind | 'entity'; resourceId: string }[]> {
  const entity = await tx.db
    .deleteFrom('entity_definition_permissions')
    .where('target_type', '=', target.type)
    .where('target_id', '=', target.id)
    .returning('entity_definition_id')
    .execute();
  const other = await tx.db
    .deleteFrom('resource_permissions')
    .where('target_type', '=', target.type)
    .where('target_id', '=', target.id)
    .returning(['resource_kind', 'resource_id'])
    .execute();
  forgetResourceGrants(tx);
  return [
    ...entity.map((r) => ({ kind: 'entity' as const, resourceId: r.entity_definition_id })),
    ...other.map((r) => ({ kind: r.resource_kind as ResourceKind, resourceId: r.resource_id })),
  ];
}

/** Active (non-archived) teams of a member, memoised per transaction. */
export async function teamsOfMember(tx: Tx, memberId: string): Promise<string[]> {
  const key = `teams-of:${memberId}`;
  const cached = tx.memo.get(key) as string[] | undefined;
  if (cached) return cached;
  const rows = await tx.db
    .selectFrom('workspace_team_memberships as m')
    .innerJoin('workspace_teams as t', 't.id', 'm.team_id')
    .select('m.team_id')
    .where('m.member_id', '=', memberId)
    .where('t.archived_at', 'is', null)
    .execute();
  const ids = rows.map((r) => r.team_id);
  tx.memo.set(key, ids);
  return ids;
}

export function forgetTeamsOf(tx: Tx): void {
  for (const key of [...tx.memo.keys()]) if (key.startsWith('teams-of:')) tx.memo.delete(key);
}
