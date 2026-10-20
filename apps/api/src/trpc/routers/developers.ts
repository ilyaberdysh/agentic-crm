// Developers → Access tokens (BACKLOG 6.07; J workspace-admin §6): workspace-level tokens with scopes. The secret is
// answered once by `create` (only its hash is stored); edit changes name and scopes; delete revokes. Admin-only.
import { createApiTokenInputSchema, updateApiTokenInputSchema, uuidSchema } from '@agentic-crm/contracts';
import { z } from 'zod';
import { acceptAfterOnly, withSeq } from '../mutation';
import { adminProcedure, router } from '../trpc';

export const developersRouter = router({
  tokens: router({
    /** Active tokens, oldest first (secrets are never listed). */
    list: adminProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.apiTokens.list(ctx.service)),

    /** "New access token": `{name, scopes}` → the token with its secret (`token`), shown this one time. */
    create: adminProcedure
      .input(createApiTokenInputSchema.pick({ id: true, name: true, scopes: true }))
      .mutation(async ({ ctx, input }) => {
        const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.apiTokens.create(svc, input));
        return { token: result, seq };
      }),

    /** "Edit access token": name and scopes. */
    update: adminProcedure.input(updateApiTokenInputSchema).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.apiTokens.update(svc, input));
      return { token: result, seq };
    }),

    /** "Delete access token": revokes it (API calls with it answer 401 at once). */
    delete: adminProcedure.input(z.object({ tokenId: uuidSchema })).mutation(async ({ ctx, input }) => {
      const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.apiTokens.revoke(svc, input.tokenId));
      return { token: result, seq };
    }),
  }),
});
