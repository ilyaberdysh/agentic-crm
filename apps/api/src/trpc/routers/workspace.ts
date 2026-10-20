// Workspace › General and Security (BACKLOG 6.02, 6.09; J workspace-admin §2, §5): name, slug (availability check;
// type-to-confirm in the UI), logo (upload to your member record through files, then set `logoFileId`), and settings:
// export formula-injection protection and default access for new resources. Writes are admin-only.
import {
  acceptAfterSchema,
  checkWorkspaceSlugInputSchema,
  updateWorkspaceGeneralInputSchema,
  updateWorkspaceSettingsInputSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { withSeq } from '../mutation';
import { adminProcedure, router, workspaceProcedure } from '../trpc';

export const workspaceRouter = router({
  /** The workspace with logo file and security settings (every member: sidebar logo, name). */
  get: workspaceProcedure
    .input(z.object({ acceptAfter: acceptAfterSchema }).optional())
    .query(({ ctx }) => ctx.domain.workspace.get(ctx.service)),

  /** Name, slug, logo (admin). A new slug changes every URL: clients navigate to the new handle. */
  update: adminProcedure.input(updateWorkspaceGeneralInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workspace.update(svc, input));
    return { workspace: result, seq };
  }),

  /** Slug availability for the slug-change dialog (`reason`: invalid, reserved, taken, current). */
  checkSlug: adminProcedure
    .input(checkWorkspaceSlugInputSchema)
    .query(({ ctx, input }) => ctx.domain.workspace.checkSlug(ctx.service, input.slug)),

  settings: router({
    /** Security → "Protect CSV exports against formula injection"; default access per resource kind. */
    update: adminProcedure.input(updateWorkspaceSettingsInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.workspace.updateSettings(svc, input));
      return { workspace: result, seq };
    }),
  }),
});
