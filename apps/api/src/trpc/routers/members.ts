// Members (BACKLOG 1.04, 6.03; J workspace-admin §3, J permissions §1): the members table with teams (every member;
// non-admins get the read-only page), member detail, role changes, suspend / reactivate and remove (admin; the domain
// checks the role again and keeps history).
import { listMembersInputSchema, memberIdInputSchema, updateMemberInputSchema } from '@agentic-crm/contracts';
import { acceptAfterInput, withSeq } from '../mutation';
import { adminProcedure, router, workspaceProcedure } from '../trpc';

export const membersRouter = router({
  /** Every member with role and teams; `includeRemoved: false` hides removed members (settings tables, pickers). */
  list: workspaceProcedure
    .input(listMembersInputSchema)
    .query(({ ctx, input }) => ctx.domain.members.list(ctx.service, input)),

  /** Member detail: profile, role, teams with "Added at". */
  get: workspaceProcedure
    .input(memberIdInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) => ctx.domain.members.get(ctx.service, input.memberId)),

  /** "Make workspace admin" / "Make workspace member" (and suspend/reactivate by level); the last admin stays. */
  updateAccessLevel: adminProcedure.input(updateMemberInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.members.updateAccessLevel(svc, input));
    return { member: result, seq };
  }),

  /** "Suspend from workspace". */
  suspend: adminProcedure.input(memberIdInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.members.suspend(svc, input.memberId));
    return { member: result, seq };
  }),

  /** "Reactivate user" (back as a member). */
  reactivate: adminProcedure.input(memberIdInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.members.reactivate(svc, input.memberId));
    return { member: result, seq };
  }),

  /**
   * Remove from the workspace: access ends at once, teams and own grants go, history stays (the member id remains the
   * actor of their changes). Inviting the person again restores the membership.
   */
  remove: adminProcedure.input(memberIdInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.members.remove(svc, input.memberId));
    return { member: result, seq };
  }),
});
