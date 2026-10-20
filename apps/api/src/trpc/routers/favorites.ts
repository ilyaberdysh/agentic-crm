// Favorites and favorite folders (BACKLOG 3.17; B sidebar §6). Personal to the acting member.
import {
  favoriteDirectoryIdInputSchema,
  favoriteIdInputSchema,
  listFavoritesInputSchema,
  moveFavoriteInputSchema,
  putFavoriteDirectoryInputSchema,
  putFavoriteInputSchema,
  removeFavoriteByTargetInputSchema,
  updateFavoriteDirectoryInputSchema,
} from '@agentic-crm/contracts';
import { withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const favoritesRouter = router({
  /** `{directories, favorites}` in rank order; each favorite carries its sidebar label (`target`). */
  list: workspaceProcedure.input(listFavoritesInputSchema).query(({ ctx }) => ctx.domain.favorites.list(ctx.service)),

  /** Star an item (PUT with a client UUID); goes to the top unless `sortOrder` is given; idempotent per item. */
  put: workspaceProcedure.input(putFavoriteInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.favorites.put(svc, input));
    return { favorite: result, seq };
  }),

  /** Drag and drop: `{favoriteId, directoryId | null, sortOrder}`. */
  move: workspaceProcedure.input(moveFavoriteInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.favorites.move(svc, input));
    return { favorite: result, seq };
  }),

  delete: workspaceProcedure.input(favoriteIdInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.favorites.delete(svc, input.favoriteId));
    return { id: result.id, seq };
  }),

  /** Un-star by item (record header star, note menu). */
  removeByTarget: workspaceProcedure.input(removeFavoriteByTargetInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.favorites.removeByTarget(svc, input));
    return { ...result, seq };
  }),

  putDirectory: workspaceProcedure.input(putFavoriteDirectoryInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.favorites.putDirectory(svc, input));
    return { directory: result, seq };
  }),

  /** Rename and / or move a folder (folders live at the top level only). */
  updateDirectory: workspaceProcedure.input(updateFavoriteDirectoryInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.favorites.updateDirectory(svc, input));
    return { directory: result, seq };
  }),

  /** Deletes the folder and the favorites inside it. */
  deleteDirectory: workspaceProcedure.input(favoriteDirectoryIdInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) =>
      ctx.domain.favorites.deleteDirectory(svc, input.directoryId),
    );
    return { ...result, seq };
  }),
});
