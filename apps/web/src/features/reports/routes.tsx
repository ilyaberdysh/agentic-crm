// Routes of the reports feature:
// /$ws/reports dashboards index (`?query=` = title search)
// /$ws/reports/dashboard/$dashboardId one dashboard (grid of report cells)
// /$ws/reports/dashboard/$dashboardId/cell/new report editor, new report (type picker first)
// /$ws/reports/dashboard/$dashboardId/cell/$cellId full-screen report viewer (J / K through the cells)
// /$ws/reports/dashboard/$dashboardId/cell/$cellId/edit  report editor, existing report
// /$ws/settings/reports/dashboards[/$dashboardId[/reports|/permissions]]  Settings → Dashboards (admin)
// /$ws/settings/data/reports legacy alias → settings/reports/dashboards
// The dashboard route renders the page and an <Outlet/> for the editor / viewer overlays, so the grid stays mounted
// (scroll position, loaded datasets) behind them, by default.
import { type AnyRoute, createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { lazy } from 'react';
import { stringSearch } from '../../app/routeGuards';
import './staleStore';

const DashboardsIndexPage = lazy(() =>
  import('./index/DashboardsIndexPage').then((m) => ({ default: m.DashboardsIndexPage })),
);
const DashboardPage = lazy(() => import('./dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ReportOverlayRoute = lazy(() =>
  import('./editor/ReportOverlayRoute').then((m) => ({ default: m.ReportOverlayRoute })),
);
const DashboardsSettingsPage = lazy(() =>
  import('./settings/DashboardsSettingsPage').then((m) => ({ default: m.DashboardsSettingsPage })),
);
const DashboardSettingsPage = lazy(() =>
  import('./settings/DashboardSettingsPage').then((m) => ({ default: m.DashboardSettingsPage })),
);

const SETTINGS_TABS = ['reports', 'permissions'] as const;
export type DashboardSettingsTab = (typeof SETTINGS_TABS)[number];

/** Pass the main (`_main`) route. */
export function reportRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const index = createRoute({
    getParentRoute,
    path: 'reports',
    validateSearch: (search: Record<string, unknown>) => ({ query: stringSearch(search, 'query') }),
    component: function ReportsIndexRoute() {
      const { query } = index.useSearch() as { query?: string };
      const navigate = useNavigate();
      return (
        <DashboardsIndexPage
          query={query ?? ''}
          onQueryChange={(q: string) =>
            void navigate({
              to: '.',
              search: ((prev: Record<string, unknown>) => ({ ...prev, query: q || undefined })) as never,
              replace: true,
            })
          }
        />
      );
    },
  });

  const dashboard = createRoute({
    getParentRoute,
    path: 'reports/dashboard/$dashboardId',
    component: function DashboardRoute() {
      return <DashboardPage dashboardId={(dashboard.useParams() as { dashboardId: string }).dashboardId} />;
    },
  });
  const newReport = createRoute({
    getParentRoute: () => dashboard,
    path: 'cell/new',
    component: function NewReportRoute() {
      return (
        <ReportOverlayRoute dashboardId={(newReport.useParams() as { dashboardId: string }).dashboardId} mode="new" />
      );
    },
  });
  const viewReport = createRoute({
    getParentRoute: () => dashboard,
    path: 'cell/$cellId',
    component: function ViewReportRoute() {
      const p = viewReport.useParams() as { dashboardId: string; cellId: string };
      return <ReportOverlayRoute dashboardId={p.dashboardId} cellId={p.cellId} mode="view" />;
    },
  });
  const editReport = createRoute({
    getParentRoute: () => dashboard,
    path: 'cell/$cellId/edit',
    component: function EditReportRoute() {
      const p = editReport.useParams() as { dashboardId: string; cellId: string };
      return <ReportOverlayRoute dashboardId={p.dashboardId} cellId={p.cellId} mode="edit" />;
    },
  });
  dashboard.addChildren([newReport, viewReport, editReport]);

  // Unknown paths below /reports fall through to the workspace splat (back to Home), as everywhere else.
  return [index, dashboard];
}

/** Pass the settings route. */
export function reportSettingsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const list = createRoute({ getParentRoute, path: 'reports/dashboards', component: DashboardsSettingsPage });
  const detail = createRoute({
    getParentRoute,
    path: 'reports/dashboards/$dashboardId',
    beforeLoad: ({ location }) => {
      throw redirect({ href: `${location.pathname.replace(/\/$/, '')}/reports`, replace: true });
    },
  });
  const tab = createRoute({
    getParentRoute,
    path: 'reports/dashboards/$dashboardId/$tab',
    beforeLoad: ({ params, location }) => {
      const { tab: t } = params as { tab: string };
      if (!(SETTINGS_TABS as readonly string[]).includes(t)) {
        const base = location.pathname.slice(0, location.pathname.lastIndexOf('/'));
        throw redirect({ href: `${base}/reports`, replace: true });
      }
    },
    component: function DashboardSettingsRoute() {
      const p = tab.useParams() as { dashboardId: string; tab: DashboardSettingsTab };
      return <DashboardSettingsPage dashboardId={p.dashboardId} tab={p.tab} />;
    },
  });
  /** `/settings/data/reports` → Settings → Dashboards. */
  const legacy = createRoute({
    getParentRoute,
    path: 'data/reports',
    beforeLoad: ({ location }) => {
      const base = location.pathname.slice(0, location.pathname.indexOf('/data/reports'));
      throw redirect({ href: `${base}/reports/dashboards`, replace: true });
    },
  });
  return [list, detail, tab, legacy];
}
