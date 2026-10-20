// Slice-9 services wired for createDomain(): dashboards, reports and the reporting dataset engine. Every method is
// one workspace transaction (I1, I2); dataset queries are reads in their own transaction.
import type {
  CreateDashboardInput,
  CreateReportInput,
  DatasetInput,
  DeleteDashboardInput,
  DeleteReportInput,
  DuplicateDashboardInput,
  DuplicateReportInput,
  DuplicateReportToInput,
  GetDashboardInput,
  GetReportInput,
  ListDashboardsInput,
  ReportDatasetInput,
  SetDashboardLayoutInput,
  UpdateDashboardInput,
  UpdateReportInput,
} from '@agentic-crm/contracts';
import type { Database } from '@agentic-crm/db';
import type { ServiceContext } from '../context.ts';
import type { Policies } from '../permissions.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import './access.ts';
import { runDataset, runReportDataset } from './dataset/index.ts';
import { dashboardOps, reportOps } from './service.ts';

export { dashboardAccess } from './access.ts';
export { emitReportStale, freshnessSeq } from './stale.ts';

export function createReportServices(deps: { database: Database; policies: Policies }) {
  const run = <T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) => runInWorkspace(deps.database, ctx, fn);
  const dashboards = dashboardOps(deps);
  const reports = reportOps(deps);
  return {
    /** Dashboards (BACKLOG 9.01, 9.02, 9.09): index, detail with cells and reports, CRUD, duplicate, layout. */
    dashboards: {
      list: (ctx: ServiceContext, input?: ListDashboardsInput) => run(ctx, (tx) => dashboards.list(tx, input)),
      get: (ctx: ServiceContext, input: GetDashboardInput) => run(ctx, (tx) => dashboards.get(tx, input)),
      create: (ctx: ServiceContext, input: CreateDashboardInput) => run(ctx, (tx) => dashboards.create(tx, input)),
      update: (ctx: ServiceContext, input: UpdateDashboardInput) => run(ctx, (tx) => dashboards.update(tx, input)),
      delete: (ctx: ServiceContext, input: DeleteDashboardInput) => run(ctx, (tx) => dashboards.delete(tx, input)),
      duplicate: (ctx: ServiceContext, input: DuplicateDashboardInput) =>
        run(ctx, (tx) => dashboards.duplicate(tx, input)),
      setLayout: (ctx: ServiceContext, input: SetDashboardLayoutInput) =>
        run(ctx, (tx) => dashboards.setLayout(tx, input)),
    },
    /** Reports (BACKLOG 9.03, 9.05, 9.06): CRUD with filter and per-type settings, duplicate, duplicate to. */
    reports: {
      get: (ctx: ServiceContext, input: GetReportInput) => run(ctx, (tx) => reports.get(tx, input)),
      create: (ctx: ServiceContext, input: CreateReportInput) => run(ctx, (tx) => reports.create(tx, input)),
      update: (ctx: ServiceContext, input: UpdateReportInput) => run(ctx, (tx) => reports.update(tx, input)),
      delete: (ctx: ServiceContext, input: DeleteReportInput) => run(ctx, (tx) => reports.delete(tx, input)),
      duplicate: (ctx: ServiceContext, input: DuplicateReportInput) => run(ctx, (tx) => reports.duplicate(tx, input)),
      duplicateTo: (ctx: ServiceContext, input: DuplicateReportToInput) =>
        run(ctx, (tx) => reports.duplicateTo(tx, input)),
    },
    /** The dataset engine (BACKLOG 9.04, 9.10). */
    reporting: {
      dataset: (ctx: ServiceContext, input: DatasetInput) => run(ctx, (tx) => runDataset(tx, deps, input)),
      reportDataset: (ctx: ServiceContext, input: ReportDatasetInput) =>
        run(ctx, (tx) =>
          runReportDataset(tx, deps, input, async (t, reportId) => {
            const { report } = await reports.readable(t, reportId);
            return report;
          }),
        ),
    },
  };
}
