// permissions.* (BACKLOG 6.04/6.05; J permissions §4–5): the Permissions tab and Share popover of objects, lists and
// (later slices) dashboards, workflows and sequences. One workspace grant per resource (synthesised from the kind
// default when missing), plus team, member and workflow overrides that can only add access. Changing grants needs
// Full access on the resource or the admin role (OQ-067: admins can always grant themselves access).
import {
  type AccessScope,
  accessScopes,
  administrateFlagOf,
  type EffectiveAccess,
  kindFlagsForScope,
  type ListPermissionsInput,
  type ListPermissionsOutput,
  listPermissionsInputSchema,
  type PermissionGrant,
  type PutPermissionInput,
  putPermissionInputSchema,
  type RemovePermissionInput,
  type ResolvePermissionsInput,
  type ResolvePermissionsOutput,
  type ResourceKind,
  removePermissionInputSchema,
  resolvePermissionsInputSchema,
  resourceKindDefaults,
} from '@agentic-crm/contracts';
import { badRequest, DomainError, forbidden, notFound } from '../errors.ts';
import type { Policies } from '../permissions.ts';
import { subjectOf } from '../permissions.ts';
import { type DefInfo, loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { callerAccessLevel } from './admin.ts';
import {
  type GrantRow,
  loadResourceGrants,
  type ResourceGrants,
  type StoredTargetType,
  teamsOfMember,
  writeGrant,
} from './grants.ts';
import { effectiveAccess, kindOfDefinition, type Principal, principalOf, workspaceLevel } from './resolve.ts';

/** How a kind finds its resources (objects and lists are entity definitions; later slices register the others). */
export interface ResourceKindHandler {
  /** Resolves an id (or api slug) to the resource; throws 404 when it does not exist. */
  load(tx: Tx, ref: string): Promise<{ id: string; name: string; def?: DefInfo }>;
  /** Invalidations to emit after its grants change. */
  emit?(tx: Tx, resourceId: string): void;
}

const resourceNotFound = (kind: ResourceKind, ref: string) =>
  notFound(`The requested ${kind} could not be found`, { resource_kind: kind, resource_id: ref });

async function loadEntity(tx: Tx, kind: 'object' | 'list', ref: string) {
  let def: DefInfo;
  try {
    def = await loadDefinition(tx, ref);
  } catch {
    throw resourceNotFound(kind, ref);
  }
  if (kindOfDefinition(def) !== kind || (kind === 'list' && def.isArchived)) throw resourceNotFound(kind, ref);
  let name = def.pluralNoun;
  if (kind === 'list') {
    const row = await tx.db.selectFrom('collections').select('name').where('id', '=', def.id).executeTakeFirst();
    name = row?.name ?? def.pluralNoun;
  }
  return { id: def.id, name, def };
}

const handlers: Partial<Record<ResourceKind, ResourceKindHandler>> = {
  object: {
    load: (tx, ref) => loadEntity(tx, 'object', ref),
    emit(tx, id) {
      // Clients refetch resolved policies on definition invalidations.
      tx.emit('entity-definition', id);
      tx.emit('entity-definition-list', null);
    },
  },
  list: {
    load: (tx, ref) => loadEntity(tx, 'list', ref),
    emit(tx, id) {
      tx.emit('entity-definition', id);
      tx.emit('entity-definition-list', null);
      tx.emit('collection', id, { listId: id });
      tx.emit('collection-list', null);
    },
  },
};

/** Later slices (dashboards, workflows, sequences) register how their resources are found. */
export function registerResourceKind(kind: ResourceKind, handler: ResourceKindHandler): void {
  handlers[kind] = handler;
}

function handlerOf(kind: ResourceKind): ResourceKindHandler {
  const handler = handlers[kind];
  if (!handler) throw badRequest('VALIDATION_ERROR', `Permissions of ${kind}s are not available yet`);
  return handler;
}

const STORED: Record<'workspace' | 'team' | 'member' | 'workflow', StoredTargetType> = {
  workspace: 'workspace',
  team: 'team',
  member: 'workspace-member',
  workflow: 'workflow',
};
const PUBLIC: Record<StoredTargetType, PermissionGrant['target']['type']> = {
  workspace: 'workspace',
  team: 'team',
  'workspace-member': 'member',
  workflow: 'workflow',
};

/** The principal of the current call. */
async function currentPrincipal(tx: Tx): Promise<Principal> {
  return principalOf(tx, await subjectOf(tx));
}

/** Admins, members with Full access (the kind's administrate flag) and the system may change a resource's grants. */
async function canManage(tx: Tx, kind: ResourceKind, grants: ResourceGrants | undefined): Promise<boolean> {
  if (tx.ctx.actor.type === 'system') return true;
  const level = await callerAccessLevel(tx);
  if (level === 'admin') return true;
  if (level === null || level === 'suspended') return false;
  return effectiveAccess(kind, grants, await currentPrincipal(tx)).level === 'full-access';
}

/** The workspace level a new resource of `kind` gets (workspace settings override the built-in default, X-06). */
export async function createWorkspaceScope(tx: Tx, kind: ResourceKind): Promise<AccessScope> {
  const row = await tx.db
    .selectFrom('workspaces')
    .select('settings')
    .where('id', '=', tx.workspaceId)
    .executeTakeFirst();
  const overrides = ((row?.settings ?? {}) as { defaultWorkspaceAccess?: Partial<Record<ResourceKind, unknown>> })
    .defaultWorkspaceAccess;
  const value = overrides?.[kind];
  return typeof value === 'string' && (accessScopes as readonly string[]).includes(value)
    ? (value as AccessScope)
    : resourceKindDefaults[kind].createWorkspaceScope;
}

/**
 * Grants of a newly created resource (X-06): the workspace grant (explicit level, else the workspace's default for the
 * kind) and Full access for the creating member. Skipped when the resource already has a workspace grant (replays).
 */
export async function grantDefaultsOnCreate(
  tx: Tx,
  kind: ResourceKind,
  resourceId: string,
  workspaceAccess?: AccessScope | null,
): Promise<void> {
  const existing = (await loadResourceGrants(tx, kind, [resourceId])).get(resourceId);
  if (existing?.workspace !== null && existing?.workspace !== undefined) return;
  const level = workspaceAccess ?? (await createWorkspaceScope(tx, kind));
  await writeGrant(tx, kind, resourceId, { type: 'workspace', id: tx.workspaceId }, level);
  const creator = tx.ctx.actor.type === 'workspace-member' ? tx.ctx.actor.id : null;
  if (creator) {
    await writeGrant(
      tx,
      kind,
      resourceId,
      { type: 'workspace-member', id: creator },
      resourceKindDefaults[kind].creatorScope,
    );
  }
}

async function targetNames(tx: Tx, rows: GrantRow[]) {
  const teamIds = rows.filter((r) => r.targetType === 'team').map((r) => r.targetId);
  const memberIds = rows.filter((r) => r.targetType === 'workspace-member').map((r) => r.targetId);
  const [teams, members, counts] = await Promise.all([
    teamIds.length
      ? tx.db.selectFrom('workspace_teams').select(['id', 'name']).where('id', 'in', teamIds).execute()
      : [],
    memberIds.length
      ? tx.db
          .selectFrom('workspace_members')
          .select(['id', 'first_name', 'last_name', 'email_address'])
          .where('id', 'in', memberIds)
          .execute()
      : [],
    teamIds.length
      ? tx.db
          .selectFrom('workspace_team_memberships')
          .select((eb) => ['team_id', eb.fn.countAll<string>().as('n')])
          .where('team_id', 'in', teamIds)
          .groupBy('team_id')
          .execute()
      : [],
  ]);
  const names = new Map<string, { name: string; detail: string | null }>();
  for (const t of teams) {
    const n = counts.find((c) => c.team_id === t.id)?.n ?? '0';
    names.set(t.id, { name: t.name, detail: String(Number(n)) });
  }
  for (const m of members) {
    const name = `${m.first_name} ${m.last_name}`.trim() || m.email_address;
    names.set(m.id, { name, detail: m.email_address });
  }
  return names;
}

async function withTeamName(tx: Tx, e: EffectiveAccess): Promise<EffectiveAccess> {
  if (e.source.type !== 'team' || !e.source.id) return e;
  const row = await tx.db.selectFrom('workspace_teams').select('name').where('id', '=', e.source.id).executeTakeFirst();
  return { ...e, source: { ...e.source, name: row?.name ?? null } };
}

/** Rows of the Permissions tab: workspace first, then teams, members and workflows (each by name). */
async function buildGrants(tx: Tx, kind: ResourceKind, resourceId: string, g: ResourceGrants | undefined) {
  const rows = g?.rows ?? [];
  const names = await targetNames(tx, rows);
  const out: PermissionGrant[] = [];
  const ws = workspaceLevel(kind, g);
  const wsRow = rows.find((r) => r.targetType === 'workspace');
  out.push({
    id: wsRow?.id ?? null,
    resourceKind: kind,
    resourceId,
    target: { type: 'workspace', id: tx.workspaceId },
    level: ws.level,
    flags: kindFlagsForScope(kind, ws.level),
    targetName: null,
    targetDetail: null,
    effective: { level: ws.level, source: ws.source },
    createdBy: wsRow?.createdBy ?? null,
    createdAt: wsRow?.createdAt ?? null,
    updatedAt: wsRow?.updatedAt ?? null,
  });
  const order: StoredTargetType[] = ['team', 'workspace-member', 'workflow'];
  const others = rows
    .filter((r) => r.targetType !== 'workspace')
    .sort((a, b) => {
      const byType = order.indexOf(a.targetType) - order.indexOf(b.targetType);
      if (byType !== 0) return byType;
      return (names.get(a.targetId)?.name ?? '').localeCompare(names.get(b.targetId)?.name ?? '');
    });
  for (const r of others) {
    let principal: Principal;
    if (r.targetType === 'team') principal = { type: 'team', teamId: r.targetId };
    else if (r.targetType === 'workflow') principal = { type: 'workflow', workflowId: r.targetId };
    else
      principal = {
        type: 'member',
        memberId: r.targetId,
        teamIds: await teamsOfMember(tx, r.targetId),
        suspended: false,
      };
    out.push({
      id: r.id,
      resourceKind: kind,
      resourceId,
      target: { type: PUBLIC[r.targetType], id: r.targetId },
      level: r.scope,
      flags: kindFlagsForScope(kind, r.scope),
      targetName: names.get(r.targetId)?.name ?? null,
      targetDetail: names.get(r.targetId)?.detail ?? null,
      effective: await withTeamName(tx, effectiveAccess(kind, g, principal)),
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }
  return out;
}

async function assertTarget(tx: Tx, type: 'team' | 'member' | 'workflow', id: string): Promise<void> {
  if (type === 'team') {
    const team = await tx.db
      .selectFrom('workspace_teams')
      .select('id')
      .where('id', '=', id)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!team) throw notFound('The requested team could not be found', { workspace_team_id: id });
  } else if (type === 'member') {
    const member = await tx.db
      .selectFrom('workspace_members')
      .select('id')
      .where('id', '=', id)
      .where('removed_at', 'is', null)
      .executeTakeFirst();
    if (!member) throw notFound('The requested workspace member could not be found', { workspace_member_id: id });
  } else if (type === 'workflow') {
    // Workflows are grantees of object / list access (G README §4.5; slice 8).
    const workflow = await tx.db
      .selectFrom('workflows')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!workflow) throw notFound('The requested workflow could not be found', { workflow_id: id });
  }
}

export function permissionOps(policies: Policies) {
  const ops = {
    async list(tx: Tx, input: ListPermissionsInput): Promise<ListPermissionsOutput> {
      const data = listPermissionsInputSchema.parse(input);
      const kind = data.resourceKind;
      const resource = await handlerOf(kind).load(tx, data.resourceId);
      const g = (await loadResourceGrants(tx, kind, [resource.id])).get(resource.id);
      const manage = await canManage(tx, kind, g);
      if (!manage) {
        // Everyone who can see the resource may see who else can (Share popover); editing needs `canManage`.
        const own = effectiveAccess(kind, g, await currentPrincipal(tx));
        if (own.level === 'no-access') throw resourceNotFound(kind, data.resourceId);
      }
      return {
        resourceKind: kind,
        resourceId: resource.id,
        resourceName: resource.name,
        levels: [...accessScopes],
        canManage: manage,
        grants: await buildGrants(tx, kind, resource.id, g),
      };
    },

    /** Creates or changes one grant (adding a team or member, changing a level); answers the updated row. */
    async put(tx: Tx, input: PutPermissionInput): Promise<PermissionGrant> {
      const data = putPermissionInputSchema.parse(input);
      const kind = data.resourceKind;
      const handler = handlerOf(kind);
      const resource = await handler.load(tx, data.resourceId);
      const g = (await loadResourceGrants(tx, kind, [resource.id])).get(resource.id);
      if (!(await canManage(tx, kind, g))) {
        throw forbidden('You are not authorized to create this permission', {
          resource_kind: kind,
          resource_id: resource.id,
          action: administrateFlagOf(kind),
        });
      }
      const targetId = data.target.type === 'workspace' ? tx.workspaceId : data.target.id;
      if (data.target.type !== 'workspace') await assertTarget(tx, data.target.type, targetId);
      await writeGrant(tx, kind, resource.id, { type: STORED[data.target.type], id: targetId }, data.level);
      handler.emit?.(tx, resource.id);
      const after = (await loadResourceGrants(tx, kind, [resource.id])).get(resource.id);
      const rows = await buildGrants(tx, kind, resource.id, after);
      return rows.find((r) => r.target.type === data.target.type && r.target.id === targetId) as PermissionGrant;
    },

    /** "Remove team-level override" / "Remove member-level override"; the workspace grant cannot be removed. */
    async remove(tx: Tx, input: RemovePermissionInput): Promise<{ removed: boolean }> {
      const data = removePermissionInputSchema.parse(input);
      const kind = data.resourceKind;
      if (data.target.type === 'workspace') {
        throw badRequest('VALIDATION_ERROR', 'The workspace permission cannot be removed; change its level instead');
      }
      const handler = handlerOf(kind);
      const resource = await handler.load(tx, data.resourceId);
      const g = (await loadResourceGrants(tx, kind, [resource.id])).get(resource.id);
      if (!(await canManage(tx, kind, g))) {
        throw forbidden('You do not have access to update these permissions.', {
          resource_kind: kind,
          resource_id: resource.id,
          action: administrateFlagOf(kind),
        });
      }
      const stored = STORED[data.target.type];
      const exists = g?.rows.some((r) => r.targetType === stored && r.targetId === data.target.id) ?? false;
      if (exists) {
        await writeGrant(tx, kind, resource.id, { type: stored, id: data.target.id as string }, null);
        handler.emit?.(tx, resource.id);
      }
      return { removed: exists };
    },

    /** The caller's effective level, flags and its source per resource (unknown ids → NOT_FOUND entries). */
    async resolve(tx: Tx, input: ResolvePermissionsInput): Promise<ResolvePermissionsOutput> {
      const data = resolvePermissionsInputSchema.parse(input);
      const kind = data.resourceKind;
      const handler = handlerOf(kind);
      const subject = await subjectOf(tx);
      const principal = await principalOf(tx, subject);
      const admin = (await callerAccessLevel(tx)) === 'admin' || tx.ctx.actor.type === 'system';
      const resolved: ResolvePermissionsOutput['resolved'] = {};
      for (const ref of data.resourceIds) {
        let resource: Awaited<ReturnType<ResourceKindHandler['load']>>;
        try {
          resource = await handler.load(tx, ref);
        } catch (err) {
          if (err instanceof DomainError && err.statusCode === 404) {
            resolved[ref] = { state: 'error', error: 'NOT_FOUND' };
            continue;
          }
          throw err;
        }
        const g = (await loadResourceGrants(tx, kind, [resource.id])).get(resource.id);
        const effective = await withTeamName(tx, effectiveAccess(kind, g, principal));
        let flags = kindFlagsForScope(kind, effective.level);
        if (resource.def) {
          // Objects and lists: exactly what enforcement uses (grants ∩ the base resolver).
          flags = { ...((await policies.flags(tx, [resource.def])).get(resource.def.id) ?? flags) };
        }
        const value = {
          workspaceMembershipId: subject.memberId,
          level: effective.level,
          source: effective.source,
          flags,
          canManagePermissions: admin || flags[administrateFlagOf(kind)] === true,
        };
        resolved[ref] = { state: 'complete', value };
        if (resource.id !== ref) resolved[resource.id] = { state: 'complete', value };
      }
      return { resourceKind: kind, resolved };
    },
  };
  return ops;
}

export type PermissionOps = ReturnType<typeof permissionOps>;
