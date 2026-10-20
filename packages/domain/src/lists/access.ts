// List access levels (J permissions §2–3, A §4.12; decision X-06). Lists carry grants
// (entity_definition_permissions): one workspace grant plus optional team and member overrides. Resolution (most
// permissive of workspace, teams and the member's own grant; deleted lists = No access) is the slice-6 grant resolver
// in permissions/resolver.ts; this module keeps the list-specific helpers: the workspace + member summary of the List
// contract and the grant writer used by lists.create / setAccess.
import type { AccessScope, ActionFlags, ListMemberAccess } from '@agentic-crm/contracts';
import { jsonb } from '@agentic-crm/db';
import { newId } from '../ids.ts';
import type { DefInfo } from '../schema/model.ts';
import type { Tx } from '../tx.ts';

const RANK: Record<AccessScope, number> = { 'no-access': 0, 'read-only': 1, 'read-write': 2, 'full-access': 3 };

export function maxScope(a: AccessScope, b: AccessScope): AccessScope {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The level a set of flags amounts to (Full access ⇔ may administrate permissions, …). */
export function scopeOfFlags(flags: ActionFlags | undefined): AccessScope {
  if (!flags) return 'no-access';
  if (flags.administrate_entity_definition_permissions) return 'full-access';
  if (flags.create_entity_instance) return 'read-write';
  if (flags.read_entity_instance) return 'read-only';
  return 'no-access';
}

export interface ListGrants {
  deleted: boolean;
  workspace: AccessScope;
  members: Map<string, AccessScope>;
}

const memoKey = (listId: string) => `list-grants:${listId}`;

/** Grants of lists (memoised per transaction; writers call forgetGrants). Unknown ids are absent. */
export async function loadGrants(tx: Tx, listIds: string[]): Promise<Map<string, ListGrants>> {
  const out = new Map<string, ListGrants>();
  const missing: string[] = [];
  for (const id of new Set(listIds)) {
    const cached = tx.memo.get(memoKey(id)) as ListGrants | undefined;
    if (cached) out.set(id, cached);
    else missing.push(id);
  }
  if (missing.length === 0) return out;
  const [collections, grants] = await Promise.all([
    tx.db.selectFrom('collections').select(['id', 'deleted_at']).where('id', 'in', missing).execute(),
    tx.db
      .selectFrom('entity_definition_permissions')
      .select(['entity_definition_id', 'target_type', 'target_id', 'scope'])
      .where('entity_definition_id', 'in', missing)
      .execute(),
  ]);
  for (const c of collections) {
    const entry: ListGrants = { deleted: c.deleted_at !== null, workspace: 'no-access', members: new Map() };
    for (const g of grants) {
      if (g.entity_definition_id !== c.id) continue;
      if (g.target_type === 'workspace') entry.workspace = g.scope;
      else if (g.target_type === 'workspace-member') entry.members.set(g.target_id, g.scope);
    }
    tx.memo.set(memoKey(c.id), entry);
    out.set(c.id, entry);
  }
  return out;
}

export function forgetGrants(tx: Tx): void {
  // `grants:` = the slice-6 grant memo of every resource kind (permissions/grants.ts).
  for (const key of [...tx.memo.keys()])
    if (key.startsWith('list-grants:') || key.startsWith('grants:')) tx.memo.delete(key);
}

/** Upserts (scope) or removes (null) one grant of a list. */
export async function putGrant(
  tx: Tx,
  listId: string,
  target: { type: 'workspace' | 'workspace-member'; id: string },
  scope: AccessScope | null,
): Promise<void> {
  if (scope === null) {
    await tx.db
      .deleteFrom('entity_definition_permissions')
      .where('entity_definition_id', '=', listId)
      .where('target_type', '=', target.type)
      .where('target_id', '=', target.id)
      .execute();
  } else {
    await tx.db
      .insertInto('entity_definition_permissions')
      .values({
        id: newId(),
        workspace_id: tx.workspaceId,
        entity_definition_id: listId,
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
  forgetGrants(tx);
}

/** The workspace level and member overrides of a list, for the List contract. */
export function grantSummary(g: ListGrants | undefined): {
  workspaceAccess: AccessScope;
  memberAccess: ListMemberAccess[];
} {
  if (!g) return { workspaceAccess: 'no-access', memberAccess: [] };
  return {
    workspaceAccess: g.workspace,
    memberAccess: [...g.members.entries()]
      .map(([memberId, scope]) => ({ memberId, scope }))
      .sort((a, b) => (a.memberId < b.memberId ? -1 : 1)),
  };
}

/** Lists of `defs` (helper for filters). */
export const isList = (def: DefInfo) => def.entityType === 'collection-entry';
