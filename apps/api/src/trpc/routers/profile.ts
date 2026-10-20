// Profile (BACKLOG 6.01; J workspace-admin §1): first/last name (save on blur), avatar (upload to your member record
// through files.createUploadSession/complete, then set `avatarFileId`), time zone, "Start week on", locale. Names and
// time preferences apply to every workspace of the user; the auth user's name follows.
import { acceptAfterSchema, updateProfileInputSchema } from '@agentic-crm/contracts';
import { z } from 'zod';
import { withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const profileRouter = router({
  get: workspaceProcedure
    .input(z.object({ acceptAfter: acceptAfterSchema }).optional())
    .query(({ ctx }) => ctx.domain.profile.get(ctx.service)),

  update: workspaceProcedure.input(updateProfileInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.profile.update(svc, input));
    if (input.name && ctx.updateUserName) {
      const name = `${input.name.firstName} ${input.name.lastName}`.trim();
      if (name) await ctx.updateUserName(ctx.user.id, name);
    }
    return { profile: result, seq };
  }),
});
