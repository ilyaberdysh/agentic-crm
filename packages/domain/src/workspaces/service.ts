// Workspaces, members and invites (BACKLOG 1.03–1.04; K legacy-welcome §6.5/§9/§10, J workspace-admin §3.2,
// J permissions §1). Creating a workspace seeds its data model and makes the creator an admin; members also exist
// as records of the workspace-member definition (instance id = member id, A §4.2).
import {
  type AcceptInviteInput,
  type AccessLevel,
  acceptInviteInputSchema,
  type CreateInvitesInput,
  type CreateWorkspaceInput,
  createInvitesInputSchema,
  createWorkspaceInputSchema,
  type UpdateMemberInput,
  type UpdateWorkspaceInput,
  type UserIdentity,
  updateMemberInputSchema,
  updateWorkspaceInputSchema,
  userIdentitySchema,
  type ValueInput,
  type Workspace,
  type WorkspaceInvite,
  type WorkspaceMember,
  type WorkspaceWithMembership,
  workspaceSlugSchema,
} from '@agentic-crm/contracts';
import {
  type Database,
  type DB,
  jsonb,
  type Selectable,
  type Transaction,
  type WorkspaceInvitesTable,
  type WorkspaceMembersTable,
  type WorkspacesTable,
} from '@agentic-crm/db';
import { systemContext } from '../context.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { engineFor } from '../records/engine.ts';
import { createRecordInTx } from '../records/service.ts';
import { type AttrDef, loadDefinition } from '../schema/model.ts';
import { bootstrapWorkspaceSchema } from '../schema/standard.ts';
import { assertTeams, teamOps } from '../teams/service.ts';
import { enterWorkspace, runAsOwner, type Tx } from '../tx.ts';
import { workspaceMemberCreatedEvent } from '../webhooks/events.ts';

/** Handles that collide with app routes or services. */
// biome-ignore format: compact table
export const RESERVED_SLUGS = new Set([
  '404', '_', 'admin', 'api', 'app', 'app-invites', 'assets', 'auth', 'authorize', 'billing', 'blog', 'collab',
  'docs', 'health', 'help', 'integrations', 'invite', 'invites', 'join', 'login', 'logout', 'oauth', 'oauth2', 'onboarding',
  'openid', 'public', 'realtime', 'saml', 'settings', 'sign-in', 'sign-out', 'sign-up', 'signin', 'signup', 'static',
  'status', 'support', 'trpc', 'v1', 'v2', 'welcome', 'workspaces', 'www',
]);

type WorkspaceRow = Selectable<WorkspacesTable>;
type MemberRow = Selectable<WorkspaceMembersTable>;
type InviteRow = Selectable<WorkspaceInvitesTable>;

export function toWorkspace(r: WorkspaceRow): Workspace {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    logoUrl: r.logo_url,
    countryCode: r.country_code,
    settings: (r.settings ?? {}) as Record<string, unknown>,
    onboardingFlags: (r.onboarding_flags ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
  };
}

export function toMember(r: MemberRow): WorkspaceMember {
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
  };
}

function toInvite(r: InviteRow): WorkspaceInvite {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    emailAddress: r.email_address,
    accessLevel: r.access_level,
    firstName: r.first_name,
    lastName: r.last_name,
    createdByMemberId: r.created_by_member_id,
    createdAt: r.created_at,
    acceptedAt: r.accepted_at,
    revokedAt: r.revoked_at,
    teamIds: r.team_ids ?? [],
  };
}

function assertSlugAllowed(slug: string): void {
  if (RESERVED_SLUGS.has(slug))
    throw badRequest('RESERVED_SLUG', 'This handle is reserved', { conflicting_field: 'slug' });
}

/** Admin-only operations: members must be admins; system and API-token actors are trusted callers. */
async function requireAdmin(tx: Tx): Promise<void> {
  const actor = tx.ctx.actor;
  if (actor.type !== 'workspace-member') return;
  const row = await tx.db
    .selectFrom('workspace_members')
    .select('access_level')
    .where('id', '=', actor.id as string)
    .executeTakeFirst();
  if (row?.access_level !== 'admin') throw forbidden('Only workspace admins can do this');
}

/** Inserts a membership and the member's record (name, email, member actor). Runs in the workspace transaction. */
export async function addMemberInTx(
  tx: Tx,
  user: UserIdentity,
  accessLevel: AccessLevel,
  memberId: string = newId(),
): Promise<MemberRow> {
  const identity = userIdentitySchema.parse(user);
  await tx.db
    .insertInto('workspace_members')
    .values({
      id: memberId,
      workspace_id: tx.workspaceId,
      user_id: identity.userId,
      access_level: accessLevel,
      email_address: identity.emailAddress,
      first_name: identity.firstName,
      last_name: identity.lastName,
      created_at: tx.now,
      updated_at: tx.now,
    })
    .execute();
  const def = await loadDefinition(tx, 'workspace_members');
  const values = new Map<AttrDef, ValueInput[]>();
  const set = (slug: string, value: unknown) => values.set(def.bySlug.get(slug) as AttrDef, [{ value }]);
  set('workspace_member_id', { referencedActorType: 'workspace-member', referencedActorId: memberId });
  set('email_address', identity.emailAddress);
  if (identity.firstName || identity.lastName)
    set('name', { firstName: identity.firstName, lastName: identity.lastName });
  const engine = engineFor(tx);
  await engine.asSystem(() => createRecordInTx(tx, def, memberId, values));
  await engine.finalize();
  tx.emit('workspace-member', memberId);
  workspaceMemberCreatedEvent(tx, memberId);
  return tx.db.selectFrom('workspace_members').selectAll().where('id', '=', memberId).executeTakeFirstOrThrow();
}

async function workspaceById(trx: Transaction<DB>, id: string): Promise<WorkspaceRow | undefined> {
  return trx.selectFrom('workspaces').selectAll().where('id', '=', id).executeTakeFirst();
}

export const workspaceOps = {
  /** Creates a workspace (cross-tenant: runs as owner, then enters the new workspace to seed it). */
  async create(database: Database, user: UserIdentity, input: CreateWorkspaceInput): Promise<WorkspaceWithMembership> {
    const data = createWorkspaceInputSchema.parse(input);
    const identity = userIdentitySchema.parse(user);
    assertSlugAllowed(data.slug);
    return runAsOwner(database, async (trx) => {
      const id = data.id ?? newId();
      const existing = await workspaceById(trx, id);
      if (existing) {
        const member = await trx
          .selectFrom('workspace_members')
          .selectAll()
          .where('workspace_id', '=', id)
          .where('user_id', '=', identity.userId)
          .executeTakeFirst();
        if (!member) throw conflict('ID_CONFLICT', 'A workspace with this id already exists');
        return { ...toWorkspace(existing), membership: toMember(member) }; // idempotent replay
      }
      const taken = await trx.selectFrom('workspaces').select('id').where('slug', '=', data.slug).executeTakeFirst();
      if (taken) throw conflict('SLUG_IN_USE', 'This handle is already in use', { conflicting_field: 'slug' });
      const known = await trx.selectFrom('users').select('id').where('id', '=', identity.userId).executeTakeFirst();
      if (!known) throw badRequest('VALIDATION_ERROR', 'Unknown user', { user_id: identity.userId });
      await trx
        .insertInto('workspaces')
        .values({
          id,
          slug: data.slug,
          name: data.name,
          logo_url: data.logoUrl ?? null,
          country_code: data.countryCode ?? null,
          onboarding_flags: jsonb({ is_onboarding_complete: false }),
          created_by_user_id: identity.userId,
        })
        .execute();
      const tx = await enterWorkspace(trx, systemContext(id, 'workspace-creation'));
      await bootstrapWorkspaceSchema(tx);
      const member = await addMemberInTx(tx, identity, 'admin');
      tx.emit('workspace', id);
      await tx.flush();
      const row = (await workspaceById(trx, id)) as WorkspaceRow;
      return { ...toWorkspace(row), membership: toMember(member) };
    });
  },

  async get(tx: Tx): Promise<Workspace> {
    const row = await workspaceById(tx.db, tx.workspaceId);
    if (!row) throw notFound('The requested workspace could not be found');
    return toWorkspace(row);
  },

  async update(tx: Tx, input: UpdateWorkspaceInput): Promise<Workspace> {
    const data = updateWorkspaceInputSchema.parse(input);
    await requireAdmin(tx);
    if (data.slug !== undefined) assertSlugAllowed(data.slug);
    await tx.db
      .updateTable('workspaces')
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.slug !== undefined ? { slug: data.slug } : {}),
        ...(data.logoUrl !== undefined ? { logo_url: data.logoUrl } : {}),
        updated_at: tx.now,
      })
      .where('id', '=', tx.workspaceId)
      .execute();
    tx.emit('workspace', tx.workspaceId);
    return workspaceOps.get(tx);
  },

  /** The workspace picker: active (non-suspended) memberships of a user, by name. */
  async listForUser(database: Database, userId: string): Promise<WorkspaceWithMembership[]> {
    return runAsOwner(database, async (trx) => {
      const rows = await trx
        .selectFrom('workspace_members as m')
        .innerJoin('workspaces as w', 'w.id', 'm.workspace_id')
        .selectAll('m')
        .select([
          'w.slug',
          'w.name',
          'w.logo_url',
          'w.country_code',
          'w.settings',
          'w.onboarding_flags',
          'w.created_at as w_created_at',
        ])
        .where('m.user_id', '=', userId)
        .where('m.access_level', '!=', 'suspended')
        .orderBy('w.name')
        .execute();
      return rows.map((r) => ({
        id: r.workspace_id,
        slug: r.slug,
        name: r.name,
        logoUrl: r.logo_url,
        countryCode: r.country_code,
        settings: (r.settings ?? {}) as Record<string, unknown>,
        onboardingFlags: (r.onboarding_flags ?? {}) as Record<string, unknown>,
        createdAt: r.w_created_at,
        membership: toMember(r),
      }));
    });
  },

  /** Resolves a workspace by slug or id for a user (what apps/api's WorkspaceResolver needs). */
  async resolveForUser(
    database: Database,
    userId: string,
    key: { slug: string } | { id: string },
  ): Promise<
    | { status: 'ok'; workspace: Workspace; membership: WorkspaceMember }
    | { status: 'not-found' }
    | { status: 'not-member' }
  > {
    return runAsOwner(database, async (trx) => {
      const ws = await trx
        .selectFrom('workspaces')
        .selectAll()
        .$if('slug' in key, (q) => q.where('slug', '=', (key as { slug: string }).slug))
        .$if('id' in key, (q) => q.where('id', '=', (key as { id: string }).id))
        .executeTakeFirst();
      if (!ws) return { status: 'not-found' as const };
      const member = await trx
        .selectFrom('workspace_members')
        .selectAll()
        .where('workspace_id', '=', ws.id)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (!member || member.access_level === 'suspended') return { status: 'not-member' as const };
      return { status: 'ok' as const, workspace: toWorkspace(ws), membership: toMember(member) };
    });
  },

  /** K legacy-welcome §6.5: handle availability check (reserved = unavailable). */
  async isSlugAvailable(database: Database, slug: string): Promise<boolean> {
    if (!workspaceSlugSchema.safeParse(slug).success || RESERVED_SLUGS.has(slug)) return false;
    return runAsOwner(
      database,
      async (trx) => !(await trx.selectFrom('workspaces').select('id').where('slug', '=', slug).executeTakeFirst()),
    );
  },
};

export const memberOps = {
  async list(tx: Tx): Promise<WorkspaceMember[]> {
    const rows = await tx.db.selectFrom('workspace_members').selectAll().orderBy('created_at').orderBy('id').execute();
    return rows.map(toMember);
  },

  async get(tx: Tx, memberId: string): Promise<WorkspaceMember> {
    const row = await tx.db.selectFrom('workspace_members').selectAll().where('id', '=', memberId).executeTakeFirst();
    if (!row) throw notFound('The requested workspace member could not be found', { workspace_member_id: memberId });
    return toMember(row);
  },

  /** Make admin / make member / suspend / reactivate. The last admin cannot be demoted or suspended. */
  async updateAccessLevel(tx: Tx, input: UpdateMemberInput): Promise<WorkspaceMember> {
    const data = updateMemberInputSchema.parse(input);
    await requireAdmin(tx);
    const member = await memberOps.get(tx, data.memberId);
    const removed = await tx.db
      .selectFrom('workspace_members')
      .select('removed_at')
      .where('id', '=', member.id)
      .executeTakeFirst();
    // Removed members come back through a new invite only (slice 6).
    if (removed?.removed_at) {
      throw notFound('The requested workspace member could not be found', { workspace_member_id: member.id });
    }
    if (member.accessLevel === 'admin' && data.accessLevel !== 'admin') {
      const admins = await tx.db
        .selectFrom('workspace_members')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('access_level', '=', 'admin')
        .executeTakeFirstOrThrow();
      if (Number(admins.n) <= 1) throw conflict('LAST_ADMIN', 'A workspace needs at least one admin');
    }
    await tx.db
      .updateTable('workspace_members')
      .set({
        access_level: data.accessLevel,
        suspended_at: data.accessLevel === 'suspended' ? (member.suspendedAt ?? tx.now) : null,
        updated_at: tx.now,
      })
      .where('id', '=', member.id)
      .execute();
    tx.emit('workspace-member', member.id);
    return memberOps.get(tx, member.id);
  },
};

export const inviteOps = {
  /** "Invite members" (J workspace-admin §3.2): 1–10 addresses; members and pending invites are rejected. */
  async create(tx: Tx, input: CreateInvitesInput): Promise<WorkspaceInvite[]> {
    const data = createInvitesInputSchema.parse(input);
    await requireAdmin(tx);
    const emails = data.invites.map((i) => i.emailAddress);
    if (new Set(emails).size !== emails.length)
      throw badRequest('VALIDATION_ERROR', 'This email is already in the list');
    const members = await tx.db
      .selectFrom('workspace_members')
      .select('email_address')
      .where('email_address', 'in', emails)
      .where('removed_at', 'is', null)
      .execute();
    if (members.length > 0) {
      throw conflict('ALREADY_A_MEMBER', 'This email is already in your workspace', {
        email_address: members[0]?.email_address,
      });
    }
    const pending = await tx.db
      .selectFrom('workspace_invites')
      .select('email_address')
      .where('email_address', 'in', emails)
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .execute();
    if (pending.length > 0) {
      throw conflict('INVITE_ALREADY_EXISTS', 'This email has already been invited', {
        email_address: pending[0]?.email_address,
      });
    }
    const createdBy = tx.ctx.actor.type === 'workspace-member' ? tx.ctx.actor.id : null;
    const rows = data.invites.map((i) => ({
      id: i.id ?? newId(),
      workspace_id: tx.workspaceId,
      email_address: i.emailAddress,
      access_level: i.accessLevel,
      first_name: i.firstName ?? null,
      last_name: i.lastName ?? null,
      created_by_member_id: createdBy,
      created_at: tx.now,
      team_ids: [...new Set(i.teamIds ?? [])],
    }));
    await assertTeams(tx, [...new Set(rows.flatMap((r) => r.team_ids))]);
    await tx.db.insertInto('workspace_invites').values(rows).execute();
    tx.emit('workspace-invite-list', null);
    const ids = rows.map((r) => r.id);
    return (
      await tx.db.selectFrom('workspace_invites').selectAll().where('id', 'in', ids).orderBy('created_at').execute()
    ).map(toInvite);
  },

  /** Pending invites ("Member · Invite pending" rows). */
  async list(tx: Tx): Promise<WorkspaceInvite[]> {
    const rows = await tx.db
      .selectFrom('workspace_invites')
      .selectAll()
      .where('accepted_at', 'is', null)
      .where('revoked_at', 'is', null)
      .orderBy('created_at')
      .execute();
    return rows.map(toInvite);
  },

  async revoke(tx: Tx, inviteId: string): Promise<WorkspaceInvite> {
    await requireAdmin(tx);
    const row = await tx.db.selectFrom('workspace_invites').selectAll().where('id', '=', inviteId).executeTakeFirst();
    if (!row)
      throw notFound('The requested invite could not be found', { workspace_invite_id: inviteId }, 'INVITE_NOT_FOUND');
    if (row.accepted_at === null && row.revoked_at === null) {
      await tx.db.updateTable('workspace_invites').set({ revoked_at: tx.now }).where('id', '=', inviteId).execute();
      tx.emit('workspace-invite-list', null);
    }
    return toInvite(
      (await tx.db
        .selectFrom('workspace_invites')
        .selectAll()
        .where('id', '=', inviteId)
        .executeTakeFirstOrThrow()) as InviteRow,
    );
  },

  /** Pending invites addressed to an email, with their workspace (join page, K legacy-welcome §9). */
  async listForEmail(
    database: Database,
    emailAddress: string,
  ): Promise<(WorkspaceInvite & { workspace: Workspace })[]> {
    const email = emailAddress.trim().toLowerCase();
    return runAsOwner(database, async (trx) => {
      const rows = await trx
        .selectFrom('workspace_invites')
        .selectAll()
        .where('email_address', '=', email)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .orderBy('created_at')
        .execute();
      const out: (WorkspaceInvite & { workspace: Workspace })[] = [];
      for (const r of rows) {
        const ws = await workspaceById(trx, r.workspace_id);
        if (ws) out.push({ ...toInvite(r), workspace: toWorkspace(ws) });
      }
      return out;
    });
  },

  /** Accepts the pending invite for the user's email; idempotent for existing members. */
  async accept(database: Database, user: UserIdentity, input: AcceptInviteInput): Promise<WorkspaceWithMembership> {
    const { workspaceId } = acceptInviteInputSchema.parse(input);
    const identity = userIdentitySchema.parse(user);
    return runAsOwner(database, async (trx) => {
      const ws = await workspaceById(trx, workspaceId);
      if (!ws) throw notFound("We can't find that workspace");
      const existing = await trx
        .selectFrom('workspace_members')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('user_id', '=', identity.userId)
        .executeTakeFirst();
      if (existing && !existing.removed_at) return { ...toWorkspace(ws), membership: toMember(existing) };
      const invite = await trx
        .selectFrom('workspace_invites')
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .where('email_address', '=', identity.emailAddress)
        .where('accepted_at', 'is', null)
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (!invite) throw notFound('There is no pending invite for this email', {}, 'INVITE_NOT_FOUND');
      const tx = await enterWorkspace(trx, systemContext(workspaceId, 'invite-accepted'));
      let member: MemberRow;
      if (existing) {
        // A removed member invited again gets their membership (and history) back.
        await tx.db
          .updateTable('workspace_members')
          .set({ access_level: invite.access_level, suspended_at: null, removed_at: null, updated_at: tx.now })
          .where('id', '=', existing.id)
          .execute();
        tx.emit('workspace-member', existing.id);
        member = await tx.db
          .selectFrom('workspace_members')
          .selectAll()
          .where('id', '=', existing.id)
          .executeTakeFirstOrThrow();
      } else {
        member = await addMemberInTx(tx, identity, invite.access_level);
      }
      const teamIds = invite.team_ids ?? [];
      if (teamIds.length > 0) {
        const live = await tx.db
          .selectFrom('workspace_teams')
          .select('id')
          .where('id', 'in', teamIds)
          .where('archived_at', 'is', null)
          .execute();
        for (const t of live) await teamOps.addMembers(tx, { teamId: t.id, memberIds: [member.id] });
      }
      await tx.db
        .updateTable('workspace_invites')
        .set({ accepted_at: tx.now, accepted_member_id: member.id })
        .where('id', '=', invite.id)
        .execute();
      tx.emit('workspace-invite-list', null);
      await tx.flush();
      return { ...toWorkspace(ws), membership: toMember(member) };
    });
  },
};
