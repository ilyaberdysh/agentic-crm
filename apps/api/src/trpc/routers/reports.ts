// Reports (BACKLOG 9.03, 9.05, 9.06; H api §1.3–1.4, §3, builder §5–6, README §3.6): a report = data source + filter +
// type + visualisation + the type's settings, placed on a dashboard by one cell. Create places a full-width cell after
// the last one; update is the editor's Save (partial settings; a type change resets settings; a source change clears
// the filter); delete lets the row's other cells absorb the width; duplicate / duplicateTo copy report and filter.
import {
  createReportInputSchema,
  deleteReportInputSchema,
  duplicateReportInputSchema,
  duplicateReportToInputSchema,
  getReportInputSchema,
  updateReportInputSchema,
} from '@agentic-crm/contracts';
import { withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const reportsRouter = router({
  get: workspaceProcedure
    .input(getReportInputSchema)
    .query(({ ctx, input }) => ctx.domain.reports.get(ctx.service, { reportId: input.reportId })),

  /** Report (+ filter) + cell in one transaction → `{report, cell, seq}`. */
  create: workspaceProcedure.input(createReportInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.reports.create(svc, input));
    return { ...result, seq };
  }),

  /** Save → `{report, seq}` ("Discard changes" never calls it: drafts stay on the client). */
  update: workspaceProcedure.input(updateReportInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.reports.update(svc, input));
    return { report: result, seq };
  }),

  /** Delete report → `{id, cells (the dashboard's cells after the row absorbed the width), seq}`. */
  delete: workspaceProcedure.input(deleteReportInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.reports.delete(svc, input));
    return { ...result, seq };
  }),

  /** Duplicate: right after the source cell, same width → `{report, cell, seq}`. */
  duplicate: workspaceProcedure.input(duplicateReportInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.reports.duplicate(svc, input));
    return { ...result, seq };
  }),

  /** Duplicate to…: at the end of another dashboard the caller can edit → `{report, cell, seq}`. */
  duplicateTo: workspaceProcedure.input(duplicateReportToInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.reports.duplicateTo(svc, input));
    return { ...result, seq };
  }),
});
