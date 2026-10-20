// Teams (BACKLOG 6.03; J permissions §6): list and detail for every member (pickers, member detail, Share popover);
// create, update, delete and membership for admins (checked again by the domain).
import {
  createTeamInputSchema,
  teamIdInputSchema,
  teamMembersInputSchema,
  updateTeamInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { acceptAfterOnly, withSeq } from '../mutation';
import { adminProcedure, router, workspaceProcedure } from '../trpc';

export const teamsRouter = router({
  list: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.teams.list(ctx.service)),

  /** Configuration, Members and Usage tabs. */
  get: workspaceProcedure
    .input(teamIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.teams.get(ctx.service, input.teamId)),

  /** "New team" (client id; idempotent). */
  create: adminProcedure.input(createTeamInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.teams.create(svc, input));
    return { team: result, seq };
  }),

  update: adminProcedure.input(updateTeamInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.teams.update(svc, input));
    return { team: result, seq };
  }),

  /** "Permanently delete team": answers what was affected (the confirm dialog lists it beforehand via get().usage). */
  delete: adminProcedure.input(z.object({ teamId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.teams.delete(svc, input.teamId));
    return { ...result, seq };
  }),

  /** "Invite to team" / "Add to team". */
  addMembers: adminProcedure.input(teamMembersInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.teams.addMembers(svc, input));
    return { team: result, seq };
  }),

  /** "Remove from team". */
  removeMembers: adminProcedure.input(teamMembersInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.teams.removeMembers(svc, input));
    return { team: result, seq };
  }),
});
