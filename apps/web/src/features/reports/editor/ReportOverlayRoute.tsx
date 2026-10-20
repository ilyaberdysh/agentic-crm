// The routes /cell/new, /cell/$cellId and /cell/$cellId/edit (BACKLOG 9.03, 9.08): the editor / viewer overlay over the
// dashboard page, which stays mounted behind it. Resolves the cell from the dashboard detail (shared cache with the
// page), so ▲ ▼ and J / K step through the same ordered cells the grid shows.
import { Navigate } from '@tanstack/react-router';
import { ContentSpinner } from '../../shell/AppShell';
import { useWorkspace } from '../../shell/workspaceContext';
import { useDashboard } from '../data';
import { ReportEditor } from './ReportEditor';

export function ReportOverlayRoute({
  dashboardId,
  cellId,
  mode,
}: {
  dashboardId: string;
  cellId?: string;
  mode: 'new' | 'edit' | 'view';
}) {
  const { href } = useWorkspace();
  const query = useDashboard(dashboardId);
  const detail = query.data;
  if (query.isPending) return <ContentSpinner />;
  if (!detail) return <Navigate to={href('reports')} replace />;
  const canEdit = detail.access.flags.update_reporting_dashboard;
  if (mode === 'new') {
    // A member who cannot update the dashboard cannot add reports.
    if (!canEdit) return <Navigate to={href(`reports/dashboard/${dashboardId}`)} replace />;
    return <ReportEditor key="new" dashboardId={dashboardId} cells={detail.cells} mode="new" canEdit={canEdit} />;
  }
  const cell = detail.cells.find((c) => c.id === cellId);
  if (!cell) return <Navigate to={href(`reports/dashboard/${dashboardId}`)} replace />;
  return (
    <ReportEditor
      key={cell.id}
      dashboardId={dashboardId}
      cells={detail.cells}
      cellId={cell.id}
      mode={mode}
      canEdit={canEdit}
    />
  );
}
