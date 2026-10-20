// Workspaces, members and invites (BACKLOG 1.03–1.04; K legacy-welcome §6.5, §9, §10; J workspace-admin §3.1–3.2;
// J permissions §1). Thin adapters over domain.workspaces / members / invites; administration needs the admin role
// (checked here and again by the domain).
import {
  acceptAfterSchema,
  createInvitesInputSchema,
  createWorkspaceInputSchema,
  type UserIdentity,
  updateWorkspaceInputSchema,
  uuidSchema,
  workspaceSlugSchema,
} from '@agentic-crm/contracts';
import { DomainError } from '@agentic-crm/domain';
import { z } from 'zod';
import type { AuthUser } from '../../auth/auth';
import { acceptAfterOnly, withSeq } from '../mutation';
import { adminProcedure, authedProcedure, router, workspaceProcedure } from '../trpc';

/** The session user as the domain's identity (auth tables are owned by apps/api, not read by the domain). */
export function identityOf(user: AuthUser): UserIdentity {
  const [firstName = '', ...rest] = (user.name ?? '').trim().split(/\s+/);
  return { userId: user.id, emailAddress: user.email, firstName, lastName: rest.join(' ') };
}

export const workspacesRouter = router({
  /** The `/workspaces` picker: active memberships of the caller, by name (K README §2.6). */
  list: authedProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.workspaces.listForUser(ctx.user.id)),

  /** The workspace named by `x-workspace-slug` (or `workspaceSlug`), with the caller's membership. */
  current: workspaceProcedure
    .input(
      z.object({ workspaceSlug: z.string().min(1).max(128).optional(), acceptAfter: acceptAfterSchema }).optional(),
    )
    .query(async ({ ctx }) => ({
      ...(await ctx.domain.workspaces.get(ctx.service)),
      membership: await ctx.domain.members.get(ctx.service, ctx.membership.id),
    })),

  /** Handle availability while typing in "Create your workspace" (K legacy-welcome §6.5); reserved = unavailable. */
  checkSlug: authedProcedure.input(z.object({ slug: z.string().max(128) })).query(async ({ ctx, input }) => ({
    slug: input.slug,
    valid: workspaceSlugSchema.safeParse(input.slug).success,
    available: await ctx.domain.workspaces.isSlugAvailable(input.slug),
  })),

  /**
   * Create a workspace (PUT-style: pass a client id to make retries idempotent). The creator becomes its admin.
   * 409 SLUG_IN_USE / 400 RESERVED_SLUG when the handle is taken.
   */
  create: authedProcedure.input(createWorkspaceInputSchema).mutation(async ({ ctx, input }) => ({
    workspace: await ctx.domain.workspaces.create(identityOf(ctx.user), input),
    seq: null,
  })),

  /** Workspace settings → General: name and logo (admin). */
  update: adminProcedure
    .input(updateWorkspaceInputSchema.pick({ name: true, logoUrl: true }))
    .mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workspaces.update(svc, input));
      return { workspace: result, seq };
    }),
});

export const invitesRouter = router({
  /** Pending invites of the workspace ("Invite pending" rows; admin). */
  list: adminProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.invites.list(ctx.service)),

  /** "Invite members": 1–10 emails as Member or Admin (admin). */
  create: adminProcedure.input(createInvitesInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.invites.create(svc, input));
    return { invites: result, seq };
  }),

  /** "Revoke invite" (admin; idempotent). */
  revoke: adminProcedure.input(z.object({ inviteId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.invites.revoke(svc, input.inviteId));
    return { invite: result, seq };
  }),

  /** Pending invites addressed to the caller's email, with their workspace (`/workspaces` "Invited" rows). */
  listMine: authedProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.invites.listForEmail(ctx.user.email)),

  /**
   * Accept an invite (`/auth/join/$workspaceSlug`, K legacy-welcome §9) by its token — the invite id carried by the
   * invite link — or by workspace slug. Invites are bound to the invited email. The token was only ever sent to that
   * address, so presenting it for an account with the same email proves control of the mailbox: the account becomes
   * email-verified and joins (invited sign-up works end to end). Accepting by slug has no such proof and needs an
   * already verified email. Idempotent for existing members.
   */
  accept: authedProcedure
    .input(z.union([z.object({ inviteId: uuidSchema }), z.object({ workspaceSlug: z.string().min(1).max(128) })]))
    .mutation(async ({ ctx, input }) => {
      const byToken = 'inviteId' in input;
      if (!byToken && !ctx.user.emailVerified) {
        throw new DomainError(403, 'FORBIDDEN', 'Verify your email address before accepting an invite');
      }
      const pending = await ctx.domain.invites.listForEmail(ctx.user.email);
      const invite = pending.find((i) =>
        byToken ? i.id === input.inviteId : i.workspace.slug === input.workspaceSlug,
      );
      if (invite && byToken && !ctx.user.emailVerified) {
        if (!ctx.markEmailVerified) {
          throw new DomainError(403, 'FORBIDDEN', 'Verify your email address before accepting an invite');
        }
        await ctx.markEmailVerified(ctx.user.id);
      }
      if (!invite) {
        // Already a member (accept is idempotent) or no invite for this email.
        if ('workspaceSlug' in input) {
          const resolution = await ctx.domain.workspaces.resolveForUser(ctx.user.id, { slug: input.workspaceSlug });
          if (resolution.status === 'ok') {
            return { workspace: { ...resolution.workspace, membership: resolution.membership }, seq: null };
          }
        }
        throw new DomainError(404, 'INVITE_NOT_FOUND', 'There is no pending invite for this email');
      }
      const workspace = await ctx.domain.invites.accept(identityOf(ctx.user), { workspaceId: invite.workspaceId });
      return { workspace, seq: null };
    }),
});
