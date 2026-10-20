// Comments, threads and reactions (BACKLOG 3.16; E README §2.8, §3.5). Thin adapters over domain.comments.
import {
  addReactionInputSchema,
  commentCountsInputSchema,
  commentIdInputSchema,
  createCommentInputSchema,
  listThreadsInputSchema,
  removeReactionInputSchema,
  resolveCommentInputSchema,
  threadIdInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const commentsRouter = router({
  /** PUT create with a client UUID: a new thread (`target`: record or list entry) or a reply (`threadId`). */
  create: workspaceProcedure.input(createCommentInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.comments.create(svc, input));
    return { comment: result, seq };
  }),

  /** Resolve / re-open a thread root. */
  resolve: workspaceProcedure.input(resolveCommentInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.comments.resolve(svc, input));
    return { comment: result, seq };
  }),

  /** Author only; deleting a thread root deletes its replies. */
  delete: workspaceProcedure.input(z.object({ commentId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.comments.delete(svc, input.commentId));
    return { ...result, seq };
  }),

  /** PUT a reaction with a client UUID (`emoji`: the emoji character sequence). */
  addReaction: workspaceProcedure.input(addReactionInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.comments.addReaction(svc, input));
    return { comment: result, seq };
  }),

  /** Clicking your own chip removes your reaction. */
  removeReaction: workspaceProcedure.input(removeReactionInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.comments.removeReaction(svc, input));
    return { comment: result, seq };
  }),

  /** "All comments": threads of a record / entry (`target`) or of an object (`entityDefinitionId`), newest first. */
  listThreads: workspaceProcedure
    .input(listThreadsInputSchema)
    .query(({ ctx, input }) => ctx.domain.comments.listThreads(ctx.service, input)),

  /** Thread view: root + replies (oldest first). */
  getThread: workspaceProcedure
    .input(threadIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.comments.getThread(ctx.service, input.threadId)),

  get: workspaceProcedure
    .input(commentIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.comments.get(ctx.service, input.commentId)),

  /** Deep link `/comment/$commentHeaderId` → `{threadId, target, parentRecord, isResolved}`. */
  locate: workspaceProcedure
    .input(commentIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.comments.locate(ctx.service, input.commentId)),

  /** Thread / comment counts per record (table-row dots, header comment count). */
  counts: workspaceProcedure
    .input(commentCountsInputSchema)
    .query(({ ctx, input }) => ctx.domain.comments.counts(ctx.service, input)),
});
