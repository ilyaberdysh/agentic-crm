// Record files (BACKLOG 3.06; contract E5; D README §3.9, §4.4). Three-step upload: createUploadSession → PUT the
// bytes to `upload.url` (presigned, 15 min) → complete. Downloads go through short-lived signed URLs.
import {
  completeUploadInputSchema,
  createFolderInputSchema,
  createUploadSessionInputSchema,
  downloadUrlInputSchema,
  entryIdInputSchema,
  listFilesInputSchema,
  renameEntryInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { acceptAfterInput, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const filesRouter = router({
  /** Step 1: `{id, entityDefinitionId, entityInstanceId, parentFolderId?, filename, contentType, contentSize}`. */
  createUploadSession: workspaceProcedure.input(createUploadSessionInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.files.createUploadSession(svc, input));
    return { ...result, seq };
  }),

  /** Step 3: verifies the uploaded object and creates the file entry (idempotent). */
  complete: workspaceProcedure.input(completeUploadInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.files.complete(svc, input));
    return { ...result, seq };
  }),

  /** Entries of a folder (null = root), folders first; `recursive` flattens every level below. */
  list: workspaceProcedure
    .input(listFilesInputSchema)
    .query(({ ctx, input }) => ctx.domain.files.list(ctx.service, input)),

  get: workspaceProcedure
    .input(entryIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.files.get(ctx.service, input.entryId)),

  createFolder: workspaceProcedure.input(createFolderInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.files.createFolder(svc, input));
    return { entry: result, seq };
  }),

  rename: workspaceProcedure.input(renameEntryInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.files.rename(svc, input));
    return { entry: result, seq };
  }),

  /** A file, or a folder with everything inside it. */
  delete: workspaceProcedure.input(z.object({ entryId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.files.delete(svc, input.entryId));
    return { ...result, seq };
  }),

  /** `{url, expiresAt}`: a signed GET valid for 5 minutes (`disposition` attachment | inline for the lightbox). */
  downloadUrl: workspaceProcedure
    .input(downloadUrlInputSchema.extend(acceptAfterInput))
    .query(({ ctx, input }) =>
      ctx.domain.files.downloadUrl(ctx.service, { entryId: input.entryId, disposition: input.disposition }),
    ),
});
