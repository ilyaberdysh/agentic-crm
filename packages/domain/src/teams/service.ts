// Teams (BACKLOG 6.03; J permissions §6): CRUD, membership and usage. Teams are grantees of object/list (and later
// dashboard/workflow/sequence) access; a member inherits the most permissive grant of their teams. Administration is
// admin-only (OQ-067); every member can list teams (pickers, member detail). Deleting a team archives it and removes
// its memberships and grants ("Once deleted, your team cannot be recovered").
import {
  type CreateTeamInput,
  createTeamInputSchema,
  rankAfter,
  type Team,
  type TeamDetail,
  type TeamMembersInput,
  type TeamUsageItem,
  teamMembersInputSchema,
  type UpdateTeamInput,
  updateTeamInputSchema,
} from '@agentic-crm/contracts';
import { jsonb } from '@agentic-crm/db';
import { capabilityOps } from '../capabilities.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { requireAdminCaller } from '../permissions/admin.ts';
import { deleteGrantsOf, forgetResourceGrants, forgetTeamsOf } from '../permissions/grants.ts';
import type { Tx } from '../tx.ts';

const teamNotFound = (teamId: string) =>
  notFound('The requested team could not be found', { workspace_team_id: teamId });

type TeamRow = {
  id: string;
  name: string;
  description: string;
  icon: unknown;
  sort_order: string;
  created_by: unknown;
  created_at: string;
};

async function counts(tx: Tx, teamIds: string[]) {
  if (teamIds.length === 0) return { members: new Map<string, number>(), usage: new Map<string, number>() };
  const [members, entityGrants, otherGrants] = await Promise.all([
    tx.db
      .selectFrom('workspace_team_memberships')
      .select((eb) => ['team_id', eb.fn.countAll<string>().as('n')])
      .where('team_id', 'in', teamIds)
      .groupBy('team_id')
      .execute(),
    tx.db
      .selectFrom('entity_definition_permissions')
      .select((eb) => ['target_id', eb.fn.countAll<string>().as('n')])
      .where('target_type', '=', 'team')
      .where('target_id', 'in', teamIds)
      .groupBy('target_id')
      .execute(),
    tx.db
      .selectFrom('resource_permissions')
      .select((eb) => ['target_id', eb.fn.countAll<string>().as('n')])
      .where('target_type', '=', 'team')
      .where('target_id', 'in', teamIds)
      .groupBy('target_id')
      .execute(),
  ]);
  const usage = new Map<string, number>();
  for (const r of [...entityGrants, ...otherGrants])
    usage.set(r.target_id, (usage.get(r.target_id) ?? 0) + Number(r.n));
  return { members: new Map(members.map((r) => [r.team_id, Number(r.n)])), usage };
}

function toTeam(r: TeamRow, c: Awaited<ReturnType<typeof counts>>): Team {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    icon: (r.icon ?? null) as Team['icon'],
    sortOrder: r.sort_order,
    memberCount: c.members.get(r.id) ?? 0,
    usageCount: c.usage.get(r.id) ?? 0,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

async function requireTeam(tx: Tx, teamId: string): Promise<TeamRow> {
  const row = await tx.db
    .selectFrom('workspace_teams')
    .selectAll()
    .where('id', '=', teamId)
    .where('archived_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw teamNotFound(teamId);
  return row;
}

async function assertMembers(tx: Tx, memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return;
  const rows = await tx.db
    .selectFrom('workspace_members')
    .select('id')
    .where('id', 'in', memberIds)
    .where('removed_at', 'is', null)
    .execute();
  const known = new Set(rows.map((r) => r.id));
  const missing = memberIds.find((id) => !known.has(id));
  if (missing) throw notFound('The workspace member could not be found', { workspace_member_id: missing });
}

/** Team changes change effective access: clients refetch resolved policies on definition-list invalidations. */
function emitTeam(tx: Tx, teamId: string, membershipChanged: boolean): void {
  tx.emit('workspace-team', teamId, { teamId });
  tx.emit('workspace-team-list', null);
  if (membershipChanged) {
    tx.emit('workspace-member', null);
    tx.emit('entity-definition-list', null);
  }
  forgetTeamsOf(tx);
}

async function insertMemberships(tx: Tx, teamId: string, memberIds: string[]): Promise<number> {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return 0;
  const inserted = await tx.db
    .insertInto('workspace_team_memberships')
    .values(
      unique.map((memberId) => ({
        id: newId(),
        workspace_id: tx.workspaceId,
        team_id: teamId,
        member_id: memberId,
        created_by: jsonb(tx.ctx.actor),
        created_at: tx.now,
      })),
    )
    .onConflict((oc) => oc.columns(['team_id', 'member_id']).doNothing())
    .returning('id')
    .execute();
  return inserted.length;
}

export const teamOps = {
  /** Teams of the workspace by sort order (every member: pickers, member detail, Share popover). */
  async list(tx: Tx): Promise<Team[]> {
    const rows = await tx.db
      .selectFrom('workspace_teams')
      .selectAll()
      .where('archived_at', 'is', null)
      .orderBy('sort_order')
      .orderBy('id')
      .execute();
    const c = await counts(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toTeam(r, c));
  },

  /** Team detail: Configuration, Members (with "Added at") and Usage (where the team is referenced). */
  async get(tx: Tx, teamId: string): Promise<TeamDetail> {
    const row = await requireTeam(tx, teamId);
    const c = await counts(tx, [row.id]);
    const members = await tx.db
      .selectFrom('workspace_team_memberships as m')
      .innerJoin('workspace_members as w', 'w.id', 'm.member_id')
      .select(['m.id', 'm.team_id', 'm.member_id', 'm.created_at', 'm.created_by'])
      .where('m.team_id', '=', row.id)
      .where('w.removed_at', 'is', null)
      .orderBy('m.created_at')
      .orderBy('m.id')
      .execute();
    return {
      ...toTeam(row, c),
      members: members.map((m) => ({
        id: m.id,
        teamId: m.team_id,
        memberId: m.member_id,
        createdAt: m.created_at,
        createdBy: m.created_by,
      })),
      usage: await teamUsage(tx, row.id),
    };
  },

  /** "New team" (`PUT /workspace-teams/{uuid}`): idempotent per client id. */
  async create(tx: Tx, input: CreateTeamInput): Promise<TeamDetail> {
    const data = createTeamInputSchema.parse(input);
    await requireAdminCaller(tx, 'Only workspace admins can manage teams');
    const existing = await tx.db.selectFrom('workspace_teams').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (existing) {
      if (existing.archived_at !== null) throw conflict('ID_CONFLICT', 'This team id belonged to a deleted team');
      return teamOps.get(tx, existing.id);
    }
    const limit = await capabilityOps.quota(tx, 'teams_per_workspace_hard');
    if (limit !== null) {
      const live = await tx.db
        .selectFrom('workspace_teams')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('archived_at', 'is', null)
        .executeTakeFirstOrThrow();
      if (Number(live.n) >= limit) {
        throw conflict('OVER_USAGE_LIMIT', `Limit of ${limit} teams reached.`, {
          quota: 'teams_per_workspace_hard',
          limit,
        });
      }
    }
    const last = await tx.db
      .selectFrom('workspace_teams')
      .select((eb) => eb.fn.max('sort_order').as('m'))
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    await tx.db
      .insertInto('workspace_teams')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        name: data.name,
        description: data.description,
        icon: jsonb(data.icon ?? null),
        sort_order: data.sortOrder ?? rankAfter((last?.m as string | null) ?? null),
        created_by: jsonb(tx.ctx.actor),
        created_at: tx.now,
        updated_at: tx.now,
      })
      .execute();
    if (data.memberIds?.length) {
      await assertMembers(tx, data.memberIds);
      await insertMemberships(tx, data.id, data.memberIds);
    }
    emitTeam(tx, data.id, (data.memberIds?.length ?? 0) > 0);
    return teamOps.get(tx, data.id);
  },

  /** Team name, description and icon (autosave on blur). */
  async update(tx: Tx, input: UpdateTeamInput): Promise<TeamDetail> {
    const data = updateTeamInputSchema.parse(input);
    await requireAdminCaller(tx, 'Only workspace admins can manage teams');
    const row = await requireTeam(tx, data.teamId);
    await tx.db
      .updateTable('workspace_teams')
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.icon !== undefined ? { icon: jsonb(data.icon) } : {}),
        ...(data.sortOrder !== undefined ? { sort_order: data.sortOrder } : {}),
        updated_at: tx.now,
      })
      .where('id', '=', row.id)
      .execute();
    emitTeam(tx, row.id, false);
    return teamOps.get(tx, row.id);
  },

  /** "Permanently delete team": archives it and removes its memberships and every grant naming it. */
  async delete(tx: Tx, teamId: string): Promise<{ id: string; affected: TeamUsageItem[] }> {
    await requireAdminCaller(tx, 'Only workspace admins can manage teams');
    const row = await requireTeam(tx, teamId);
    const affected = await teamUsage(tx, row.id);
    const touched = await deleteGrantsOf(tx, { type: 'team', id: row.id });
    await tx.db.deleteFrom('workspace_team_memberships').where('team_id', '=', row.id).execute();
    await tx.db
      .updateTable('workspace_teams')
      .set({ archived_at: tx.now, archived_by: jsonb(tx.ctx.actor), updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    for (const t of touched) if (t.kind === 'entity') tx.emit('entity-definition', t.resourceId);
    forgetResourceGrants(tx);
    emitTeam(tx, row.id, true);
    return { id: row.id, affected };
  },

  /** "Invite to team" / "Add to team": idempotent per (team, member). */
  async addMembers(tx: Tx, input: TeamMembersInput): Promise<TeamDetail> {
    const data = teamMembersInputSchema.parse(input);
    await requireAdminCaller(tx, 'Only workspace admins can manage teams');
    const row = await requireTeam(tx, data.teamId);
    await assertMembers(tx, data.memberIds);
    const added = await insertMemberships(tx, row.id, data.memberIds);
    if (added > 0) emitTeam(tx, row.id, true);
    return teamOps.get(tx, row.id);
  },

  /** "Remove from team" (idempotent). */
  async removeMembers(tx: Tx, input: TeamMembersInput): Promise<TeamDetail> {
    const data = teamMembersInputSchema.parse(input);
    await requireAdminCaller(tx, 'Only workspace admins can manage teams');
    const row = await requireTeam(tx, data.teamId);
    const removed = await tx.db
      .deleteFrom('workspace_team_memberships')
      .where('team_id', '=', row.id)
      .where('member_id', 'in', data.memberIds)
      .returning('id')
      .execute();
    if (removed.length > 0) emitTeam(tx, row.id, true);
    return teamOps.get(tx, row.id);
  },

  /** Teams of one member with "Added at" (member detail "Teams"). */
  async ofMember(tx: Tx, memberId: string): Promise<{ teamId: string; name: string; addedAt: string }[]> {
    const rows = await tx.db
      .selectFrom('workspace_team_memberships as m')
      .innerJoin('workspace_teams as t', 't.id', 'm.team_id')
      .select(['m.team_id', 't.name', 'm.created_at'])
      .where('m.member_id', '=', memberId)
      .where('t.archived_at', 'is', null)
      .orderBy('t.sort_order')
      .execute();
    return rows.map((r) => ({ teamId: r.team_id, name: r.name, addedAt: r.created_at }));
  },
};

/** Where a team is referenced: object, list and other resources' grants (the Usage tab). */
async function teamUsage(tx: Tx, teamId: string): Promise<TeamUsageItem[]> {
  const entity = await tx.db
    .selectFrom('entity_definition_permissions as p')
    .innerJoin('entity_definitions as d', 'd.id', 'p.entity_definition_id')
    .leftJoin('collections as c', 'c.id', 'p.entity_definition_id')
    .select(['p.entity_definition_id', 'p.scope', 'd.entity_type', 'd.plural_noun', 'c.name', 'c.deleted_at'])
    .where('p.target_type', '=', 'team')
    .where('p.target_id', '=', teamId)
    .execute();
  const other = await tx.db
    .selectFrom('resource_permissions')
    .select(['resource_kind', 'resource_id', 'scope'])
    .where('target_type', '=', 'team')
    .where('target_id', '=', teamId)
    .execute();
  const items: TeamUsageItem[] = [];
  for (const r of entity) {
    if (r.deleted_at) continue;
    const isList = r.entity_type === 'collection-entry';
    items.push({
      type: isList ? 'list-permission' : 'object-permission',
      resourceId: r.entity_definition_id,
      name: isList ? (r.name ?? null) : r.plural_noun,
      level: r.scope,
    });
  }
  for (const r of other) {
    items.push({
      type: `${r.resource_kind}-permission` as TeamUsageItem['type'],
      resourceId: r.resource_id,
      name: null,
      level: r.scope,
    });
  }
  return items;
}

/** Unknown team ids in a list (validation helper for invites and member detail). */
export async function assertTeams(tx: Tx, teamIds: string[]): Promise<void> {
  if (teamIds.length === 0) return;
  const rows = await tx.db
    .selectFrom('workspace_teams')
    .select('id')
    .where('id', 'in', teamIds)
    .where('archived_at', 'is', null)
    .execute();
  const known = new Set(rows.map((r) => r.id));
  const missing = teamIds.find((id) => !known.has(id));
  if (missing) throw badRequest('VALIDATION_ERROR', 'Unknown team', { workspace_team_id: missing });
}
