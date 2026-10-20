// Writes of Settings → Dashboards on top of the reports data layer (../data): deleting a report from the admin view also
// drops its row from the admin detail of the dashboard (the shared `deleteReport` patches the member detail).
import type { DashboardDetail } from '@agentic-crm/contracts';
import { keys } from '../../../data/keys';
import { queryClient } from '../../../data/queryClient';
import type { WorkspaceRef } from '../../../data/trpc';
import { dashboardKey, deleteReport } from '../data';

/** Delete report from the Reports tab: the row leaves at once, the server's cells (widths) arrive with the refetch. */
export async function deleteReportInSettings(
  ws: WorkspaceRef,
  dashboardId: string,
  reportId: string,
): Promise<boolean> {
  const key = dashboardKey(ws.id, dashboardId, 'admin');
  const before = queryClient.getQueryData<DashboardDetail>(key);
  const ok = await deleteReport(ws, dashboardId, reportId);
  if (ok) {
    queryClient.setQueryData<DashboardDetail>(key, (d) =>
      d ? { ...d, cells: d.cells.filter((c) => c.report.id !== reportId) } : d,
    );
  } else if (before) {
    queryClient.setQueryData(key, before);
  }
  void queryClient.invalidateQueries({ queryKey: [...keys.resource(ws.id, 'reporting-dashboard'), dashboardId] });
  return ok;
}
