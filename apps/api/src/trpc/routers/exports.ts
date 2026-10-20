// View export (BACKLOG 4.08; specs C2 export.md; procedure names: decisions/slice4-contracts.md). The client mints
// `exportId`, calls create, polls status (toast: Preparing → Collecting data {progress} → Building CSV file) and
// fetches downloadUrl when `complete` (`failed` + `instance-count-zero` → "No records to export").
import { createExportInputSchema, exportRefSchema } from '@agentic-crm/contracts';
import { acceptAfterInput, withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

const exportQuery = exportRefSchema.extend(acceptAfterInput);

export const exportsRouter = router({
  /** `{exportId?, viewId, format: 'csv', locale?, timeZone?}` → `{exportId, export, seq}`. */
  create: workspaceProcedure.input(createExportInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.exports.create(svc, input));
    return { ...result, seq };
  }),

  /** `{status: pending | in-progress | complete | failed, progress 0–100, failureReason, title, fileName, …}`. */
  status: workspaceProcedure
    .input(exportQuery)
    .query(({ ctx, input }) => ctx.domain.exports.status(ctx.service, { exportId: input.exportId })),

  /** `{url, expiresAt, fileName}`: a signed GET valid for 5 minutes (409 EXPORT_NOT_READY before completion). */
  downloadUrl: workspaceProcedure
    .input(exportQuery)
    .query(({ ctx, input }) => ctx.domain.exports.downloadUrl(ctx.service, { exportId: input.exportId })),
});
