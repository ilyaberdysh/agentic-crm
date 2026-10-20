// Dashboards (BACKLOG 9.01, 9.02, 9.09; H api §1.1–1.2, §2, README §3.1–3.3, §3.10–3.11): index (newest first, search,
// favourites, thumbnails; `scope: 'admin'` = Settings → Dashboards), one dashboard with its cells and reports and the
// caller's resolved access, CRUD (create grants workspace + creator Full access), duplicate, and the layout shuffle.
// Grants: permissions.* with resourceKind 'dashboard'. Thin adapters over domain.dashboards (I5).
import {
  createDashboardInputSchema,
  deleteDashboardInputSchema,
  duplicateDashboardInputSchema,
  getDashboardInputSchema,
  listDashboardsInputSchema,
  setDashboardLayoutInputSchema,
  updateDashboardInputSchema,
} from '@agentic-crm/contracts';
import { withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const dashboardsRouter = router({
  /** DashboardSummary[]: `{…dashboard, favoriteId, reportCount, reports[{id,title,reportType,visualisationType}], access}`. */
  list: workspaceProcedure
    .input(listDashboardsInputSchema)
    .query(({ ctx, input }) =>
      ctx.domain.dashboards.list(ctx.service, input ? { query: input.query, scope: input.scope } : undefined),
    ),

  /** DashboardDetail: `{dashboard, cells[{…cell, report}], hiddenReportCount, access, favoriteId}`. */
  get: workspaceProcedure
    .input(getDashboardInputSchema)
    .query(({ ctx, input }) =>
      ctx.domain.dashboards.get(ctx.service, { dashboardId: input.dashboardId, scope: input.scope }),
    ),

  /** "New dashboard": PUT with a client UUID (title "New Dashboard"); idempotent. Answers the detail. */
  create: workspaceProcedure.input(createDashboardInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.dashboards.create(svc, input));
    return { ...result, seq };
  }),

  /** Inline title / description edits. */
  update: workspaceProcedure.input(updateDashboardInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.dashboards.update(svc, input));
    return { dashboard: result, seq };
  }),

  /** Deletes the dashboard with its reports (needs delete_reporting_dashboard). */
  delete: workspaceProcedure.input(deleteDashboardInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.dashboards.delete(svc, input));
    return { ...result, seq };
  }),

  /** A copy with copies of every report (client-minted `newDashboardId`). */
  duplicate: workspaceProcedure.input(duplicateDashboardInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.dashboards.duplicate(svc, input));
    return { ...result, seq };
  }),

  /** `cells/shuffle`: every cell's rank and width; answers all cells in rank order. */
  setLayout: workspaceProcedure.input(setDashboardLayoutInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.dashboards.setLayout(svc, input));
    return { cells: result, seq };
  }),
});
