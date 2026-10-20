// Permissions tab and Share popover (BACKLOG 6.04/6.05; J permissions §4–5): grants of objects, lists and (later
// slices) dashboards, workflows, sequences. Viewing needs access to the resource; changing grants needs Full access
// or the admin role (OQ-067) — checked by the domain. `resolve` gives the caller's level, flags and the source of the
// level (⚠ tooltip); `policies.resolve` stays the bulk 22-flag entry point for objects and lists.
import {
  listPermissionsInputSchema,
  putPermissionInputSchema,
  removePermissionInputSchema,
  resolvePermissionsInputSchema,
} from '@agentic-crm/contracts';
import { acceptAfterInput, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const permissionsRouter = router({
  /** Rows of the Permissions tab: workspace, teams, members, automations with their effective levels. */
  list: workspaceProcedure
    .input(listPermissionsInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) =>
      ctx.domain.permissions.list(ctx.service, { resourceKind: input.resourceKind, resourceId: input.resourceId }),
    ),

  /** Add a team / member / automation (with a level) or change a level (workspace row included). */
  put: workspaceProcedure.input(putPermissionInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.permissions.put(svc, input));
    return { grant: result, seq };
  }),

  /** "Remove team-level override" / "Remove member-level override". */
  remove: workspaceProcedure.input(removePermissionInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.permissions.remove(svc, input));
    return { ...result, seq };
  }),

  /** Per resource: the caller's 22 (or 4) flags, effective level and its source, and whether they may manage it. */
  resolve: workspaceProcedure
    .input(resolvePermissionsInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) =>
      ctx.domain.permissions.resolve(ctx.service, { resourceKind: input.resourceKind, resourceIds: input.resourceIds }),
    ),
});
