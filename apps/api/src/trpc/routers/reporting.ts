// The reporting dataset engine (BACKLOG 9.04, 9.10; H api §4): `dataset` runs one query (pivot = insight / historical
// / stage-changed, funnel, funnel-metric, time-in-stage) → `{rows, meta, freshness}`; `reportDataset` compiles a saved
// report (by id: dashboard read access + data source access) or an editor draft with datasetQueryForReport() and runs
// it (answers the compiled `query` too). Results carry a freshness token matched against `report-stale`
// invalidations ("New data" pill). Reads: exposed as queries (send as POST).
import { datasetInputSchema, reportDatasetInputSchema } from '@agentic-crm/contracts';
import { router, workspaceProcedure } from '../trpc';

export const reportingRouter = router({
  dataset: workspaceProcedure
    .input(datasetInputSchema)
    .query(({ ctx, input }) => ctx.domain.reporting.dataset(ctx.service, input)),

  reportDataset: workspaceProcedure
    .input(reportDatasetInputSchema)
    .query(({ ctx, input }) => ctx.domain.reporting.reportDataset(ctx.service, input)),
});
