// Members administration (BACKLOG 6.03; J workspace-admin §3, J permissions §1): the members table with teams,
// member detail, suspend / reactivate / remove. Admin-only writes; the last admin can be neither demoted, suspended
// nor removed. Removal keeps the membership row and the member's record — the id is the actor of their history — but
// ends access (access level suspended), takes them out of every team and drops their own grants; a later invite of
// the same person reactivates the row.
import type { ListMembersInput, MemberDetail, MemberSummary } from '@agentic-crm/contracts';
import { listMembersInputSchema } from '@agentic-crm/contracts';
import type { Selectable, WorkspaceMembersTable } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { requireAdminCaller } from '../permissions/admin.ts';
import { deleteGrantsOf, forgetTeamsOf } from '../permissions/grants.ts';
import { teamOps } from '../teams/service.ts';
import type { Tx } from '../tx.ts';

type MemberRow = Selectable<WorkspaceMembersTable>;

function toSummary(r: MemberRow, teamIds: string[]): MemberSummary {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    userId: r.user_id,
    accessLevel: r.access_level,
    emailAddress: r.email_address,
    firstName: r.first_name,
    lastName: r.last_name,
    suspendedAt: r.suspended_at,
    createdAt: r.created_at,
    removedAt: r.removed_at ?? null,
    avatarFileId: r.avatar_file_id ?? null,
    teamIds,
  };
}

async function teamIdsOf(tx: Tx, memberIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (memberIds.length === 0) return out;
  const rows = await tx.db
    .selectFrom('workspace_team_memberships as m')
    .innerJoin('workspace_teams as t', 't.id', 'm.team_id')
    .select(['m.member_id', 'm.team_id'])
    .where('m.member_id', 'in', memberIds)
    .where('t.archived_at', 'is', null)
    .orderBy('t.sort_order')
    .execute();
  for (const r of rows) out.set(r.member_id, [...(out.get(r.member_id) ?? []), r.team_id]);
  return out;
}

async function requireMemberRow(tx: Tx, memberId: string): Promise<MemberRow> {
  const row = await tx.db.selectFrom('workspace_members').selectAll().where('id', '=', memberId).executeTakeFirst();
  if (!row) throw notFound('The requested workspace member could not be found', { workspace_member_id: memberId });
  return row;
}

async function assertNotLastAdmin(tx: Tx, member: MemberRow): Promise<void> {
  if (member.access_level !== 'admin') return;
  const admins = await tx.db
    .selectFrom('workspace_members')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('access_level', '=', 'admin')
    .executeTakeFirstOrThrow();
  if (Number(admins.n) <= 1) throw conflict('LAST_ADMIN', 'A workspace needs at least one admin');
}

export const memberAdminOps = {
  async list(tx: Tx, input?: ListMembersInput): Promise<MemberSummary[]> {
    const data = listMembersInputSchema.parse(input) ?? { includeRemoved: true };
    const rows = await tx.db
      .selectFrom('workspace_members')
      .selectAll()
      .$if(!data.includeRemoved, (q) => q.where('removed_at', 'is', null))
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    const teams = await teamIdsOf(
      tx,
      rows.map((r) => r.id),
    );
    return rows.map((r) => toSummary(r, teams.get(r.id) ?? []));
  },

  /** Member detail: profile, role, teams with "Added at". */
  async get(tx: Tx, memberId: string): Promise<MemberDetail> {
    const row = await requireMemberRow(tx, memberId);
    const teams = await teamOps.ofMember(tx, row.id);
    return {
      ...toSummary(
        row,
        teams.map((t) => t.teamId),
      ),
      teams,
    };
  },

  /** "Suspend from workspace" ("Are you sure you want to suspend this user?"). */
  async suspend(tx: Tx, memberId: string): Promise<MemberDetail> {
    await requireAdminCaller(tx);
    const row = await requireMemberRow(tx, memberId);
    if (row.removed_at) throw notFound('The requested workspace member could not be found');
    if (row.id === actingMemberId(tx.ctx)) throw badRequest('VALIDATION_ERROR', 'You cannot suspend yourself');
    await assertNotLastAdmin(tx, row);
    if (row.access_level !== 'suspended') {
      await tx.db
        .updateTable('workspace_members')
        .set({ access_level: 'suspended', suspended_at: tx.now, updated_at: tx.now })
        .where('id', '=', row.id)
        .execute();
      tx.emit('workspace-member', row.id);
    }
    return memberAdminOps.get(tx, row.id);
  },

  /** "Reactivate user": back as a member (admins make them admin again explicitly). */
  async reactivate(tx: Tx, memberId: string): Promise<MemberDetail> {
    await requireAdminCaller(tx);
    const row = await requireMemberRow(tx, memberId);
    if (row.removed_at) throw notFound('The requested workspace member could not be found');
    if (row.access_level === 'suspended') {
      await tx.db
        .updateTable('workspace_members')
        .set({ access_level: 'member', suspended_at: null, updated_at: tx.now })
        .where('id', '=', row.id)
        .execute();
      tx.emit('workspace-member', row.id);
    }
    return memberAdminOps.get(tx, row.id);
  },

  /** Remove from the workspace: access ends, history stays (idempotent). */
  async remove(tx: Tx, memberId: string): Promise<MemberDetail> {
    await requireAdminCaller(tx);
    const row = await requireMemberRow(tx, memberId);
    if (row.id === actingMemberId(tx.ctx)) {
      throw badRequest('VALIDATION_ERROR', 'You cannot remove yourself from the workspace');
    }
    if (!row.removed_at) {
      await assertNotLastAdmin(tx, row);
      await tx.db.deleteFrom('workspace_team_memberships').where('member_id', '=', row.id).execute();
      const touched = await deleteGrantsOf(tx, { type: 'workspace-member', id: row.id });
      await tx.db
        .updateTable('workspace_members')
        .set({
          access_level: 'suspended',
          suspended_at: row.suspended_at ?? tx.now,
          removed_at: tx.now,
          updated_at: tx.now,
        })
        .where('id', '=', row.id)
        .execute();
      for (const t of touched) if (t.kind === 'entity') tx.emit('entity-definition', t.resourceId);
      forgetTeamsOf(tx);
      tx.emit('workspace-member', row.id);
      tx.emit('workspace-team-list', null);
    }
    return memberAdminOps.get(tx, row.id);
  },
};
