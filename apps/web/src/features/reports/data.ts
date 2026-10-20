// Server state of the reports feature (BACKLOG 9.01–9.03, 9.10; slice9-server.md): the dashboards index, one dashboard
// with its cells and reports, grants, the writes (optimistic where Attio's are) and the dataset queries behind every
// chart. Keys live under ['ws', ws, 'reporting-dashboard', <dashboardId>, …] / 'reporting-dashboard-list' so realtime
// invalidations (data/realtime/invalidation.ts) reach them; datasets sit under 'report-dataset' and are never
// refetched by an invalidation — `report-stale` marks them ("New data", staleStore.ts).
import {
  type DashboardCell,
  type DashboardDetail,
  type DashboardSummary,
  type DatasetOutput,
  datasetQueryForReport,
  IncompleteReportError,
  type Report,
  type ReportDraft,
  type ReportSettings,
} from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { keys } from '../../data/keys';
import { queryClient } from '../../data/queryClient';
import { markCovered } from '../../data/realtime/invalidation';
import {
  acceptAfterFor,
  api,
  errorEnvelopeOf,
  httpStatusOf,
  inWorkspace,
  noteAcceptAfter,
  type RouterOutputs,
  type WorkspaceRef,
} from '../../data/trpc';
import { newId } from '../../lib/ids';
import { getFormatSettings } from '../attributes';
import { useWorkspace } from '../shell/workspaceContext';
import { serial } from '../views/data';
import { viewerTimeZone } from '../views/relativeDates';

export type { DashboardCell, DashboardDetail, DashboardSummary, DatasetOutput, Report };
export type Scope = 'member' | 'admin';
export type DashboardEntry = DashboardDetail['cells'][number];

/** The workspace ref of the current route as a stable object. */
export function useWs(): WorkspaceRef {
  const { workspace } = useWorkspace();
  return useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
}

// ---- keys ---------------------------------------------------------------------------------------------------------

const dashboardsPrefix = (ws: string) => keys.resource(ws, 'reporting-dashboard');

export const dashboardListKey = (ws: string, scope: Scope, query: string) =>
  [...keys.resource(ws, 'reporting-dashboard-list'), scope, query] as const;
export const dashboardKey = (ws: string, dashboardId: string, scope: Scope = 'member') =>
  [...dashboardsPrefix(ws), dashboardId, 'detail', scope] as const;
export const permissionsKey = (ws: string, dashboardId: string) =>
  [...dashboardsPrefix(ws), dashboardId, 'permissions'] as const;
const datasetPrefix = (ws: string) => ['ws', ws, 'report-dataset'] as const;

// ---- reads --------------------------------------------------------------------------------------------------------

export const dashboardsQuery = (ws: WorkspaceRef, options: { scope?: Scope; query?: string } = {}) => {
  const scope = options.scope ?? 'member';
  const query = options.query?.trim() ?? '';
  return queryOptions({
    queryKey: dashboardListKey(ws.id, scope, query),
    queryFn: (): Promise<DashboardSummary[]> =>
      api.dashboards.list.query({ scope, ...(query ? { query } : {}) }, inWorkspace(ws)) as Promise<DashboardSummary[]>,
  });
};

export const dashboardQuery = (ws: WorkspaceRef, dashboardId: string, scope: Scope = 'member') =>
  queryOptions({
    queryKey: dashboardKey(ws.id, dashboardId, scope),
    queryFn: (): Promise<DashboardDetail> =>
      api.dashboards.get.query({ dashboardId, scope }, inWorkspace(ws)) as Promise<DashboardDetail>,
    retry: (count, error) => httpStatusOf(error) !== 404 && httpStatusOf(error) !== 403 && count < 2,
  });

export function useDashboards(options: { scope?: Scope; query?: string } = {}) {
  const ws = useWs();
  return useQuery(dashboardsQuery(ws, options));
}

export function useDashboard(dashboardId: string, scope: Scope = 'member') {
  const ws = useWs();
  return useQuery(dashboardQuery(ws, dashboardId, scope));
}

/** Cells of a dashboard in packing order, or the cached detail's cells. */
export function cellsOf(detail: DashboardDetail | undefined): DashboardEntry[] {
  return detail?.cells ?? [];
}

// ---- helpers ------------------------------------------------------------------------------------------------------

function fail(error: unknown, title: string): void {
  toast.error({ title, description: errorEnvelopeOf(error).message, durationMs: 8000 });
}

function patchDetail(
  ws: WorkspaceRef,
  dashboardId: string,
  patch: (detail: DashboardDetail) => DashboardDetail,
  scope: Scope = 'member',
): void {
  queryClient.setQueryData<DashboardDetail>(dashboardKey(ws.id, dashboardId, scope), (d) => (d ? patch(d) : d));
}

function covered(ws: WorkspaceRef, dashboardId: string, seq: string | null | undefined): void {
  noteAcceptAfter(ws.id, seq);
  markCovered(dashboardKey(ws.id, dashboardId, 'member'), seq);
  markCovered(dashboardKey(ws.id, dashboardId, 'admin'), seq);
}

function refreshIndex(ws: WorkspaceRef): void {
  void queryClient.invalidateQueries({ queryKey: keys.resource(ws.id, 'reporting-dashboard-list') });
}

const byRank = (a: { sortOrder: string }, b: { sortOrder: string }) =>
  a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0;

// ---- dashboard writes ---------------------------------------------------------------------------------------------

/** "New dashboard": created at once with a client id (idempotent), title "New Dashboard"; the caller navigates. */
export async function createDashboard(ws: WorkspaceRef): Promise<string> {
  const id = newId();
  const { seq, ...detail } = (await api.dashboards.create.mutate({ id }, inWorkspace(ws))) as DashboardDetail & {
    seq: string | null;
  };
  queryClient.setQueryData(dashboardKey(ws.id, id, 'member'), detail);
  covered(ws, id, seq);
  refreshIndex(ws);
  return id;
}

/** Inline title / description edits (optimistic; the index and the favourites carry the title). */
export async function updateDashboardHeader(
  ws: WorkspaceRef,
  dashboardId: string,
  patch: { title?: string; description?: string | null },
): Promise<void> {
  const before = queryClient.getQueryData<DashboardDetail>(dashboardKey(ws.id, dashboardId));
  patchDetail(ws, dashboardId, (d) => ({ ...d, dashboard: { ...d.dashboard, ...patch } }));
  try {
    const { dashboard, seq } = await serial(`dashboard:${dashboardId}`, () =>
      api.dashboards.update.mutate({ dashboardId, ...patch }, inWorkspace(ws)),
    );
    patchDetail(ws, dashboardId, (d) => ({ ...d, dashboard: dashboard as DashboardDetail['dashboard'] }));
    covered(ws, dashboardId, seq);
    refreshIndex(ws);
    void queryClient.invalidateQueries({ queryKey: keys.resource(ws.id, 'favorite-list') });
  } catch (error) {
    if (before) queryClient.setQueryData(dashboardKey(ws.id, dashboardId), before);
    fail(error, 'Failed to save your changes');
  }
}

export async function deleteDashboard(ws: WorkspaceRef, dashboardId: string): Promise<boolean> {
  try {
    const { seq } = await api.dashboards.delete.mutate({ dashboardId }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
    queryClient.removeQueries({ queryKey: [...dashboardsPrefix(ws.id), dashboardId] });
    refreshIndex(ws);
    void queryClient.invalidateQueries({ queryKey: keys.resource(ws.id, 'favorite-list') });
    return true;
  } catch (error) {
    fail(error, 'Failed to delete dashboard');
    return false;
  }
}

// ---- layout (cells/shuffle) ---------------------------------------------------------------------------------------

export interface LayoutCell {
  cellId: string;
  sortOrder: string;
  width: number;
}

/** Optimistic layout save: every cell's rank and width in one call (H api §3 "Move / resize"). */
export async function saveLayout(ws: WorkspaceRef, dashboardId: string, layout: LayoutCell[]): Promise<void> {
  const before = queryClient.getQueryData<DashboardDetail>(dashboardKey(ws.id, dashboardId));
  const apply = (d: DashboardDetail, source: LayoutCell[]): DashboardDetail => {
    const byId = new Map(source.map((c) => [c.cellId, c]));
    const cells = d.cells
      .map((c) => {
        const l = byId.get(c.id);
        return l ? { ...c, sortOrder: l.sortOrder, width: l.width } : c;
      })
      .sort(byRank);
    return { ...d, cells };
  };
  patchDetail(ws, dashboardId, (d) => apply(d, layout));
  try {
    const { cells, seq } = await serial(`dashboard:${dashboardId}`, () =>
      api.dashboards.setLayout.mutate({ dashboardId, cells: layout }, inWorkspace(ws)),
    );
    patchDetail(ws, dashboardId, (d) =>
      apply(
        d,
        (cells as DashboardCell[]).map((c) => ({ cellId: c.id, sortOrder: c.sortOrder, width: c.width })),
      ),
    );
    covered(ws, dashboardId, seq);
  } catch (error) {
    if (before) queryClient.setQueryData(dashboardKey(ws.id, dashboardId), before);
    fail(error, 'Failed to save the layout');
  }
}

// ---- report writes ------------------------------------------------------------------------------------------------

type CreateOut = RouterOutputs['reports']['create'];

function addCell(ws: WorkspaceRef, dashboardId: string, report: Report, cell: DashboardCell): void {
  patchDetail(ws, dashboardId, (d) => ({
    ...d,
    cells: [...d.cells.filter((c) => c.id !== cell.id), { ...cell, report }].sort(byRank),
  }));
}

export interface CreateReportParams {
  dashboardId: string;
  entityDefinitionId: string;
  title: string;
  description: string | null;
  filter: Report['filter'];
  reportType: Report['reportType'];
  visualisationType: Report['visualisationType'];
  settings: ReportSettings;
  /** Client ids (idempotent creates). */
  id?: string;
  cellId?: string;
}

/** Report + cell in one call; the cell goes full width after the last one (H README §3.3). */
export async function createReport(
  ws: WorkspaceRef,
  p: CreateReportParams,
): Promise<{ report: Report; cell: DashboardCell }> {
  const id = p.id ?? newId();
  const cellId = p.cellId ?? newId();
  const out = (await api.reports.create.mutate(
    {
      id,
      cellId,
      dashboardId: p.dashboardId,
      entityDefinitionId: p.entityDefinitionId,
      filter: p.filter,
      title: p.title,
      description: p.description,
      reportType: p.reportType,
      visualisationType: p.visualisationType,
      settings: p.settings as unknown as Record<string, unknown>,
      width: 12,
    },
    inWorkspace(ws),
  )) as unknown as CreateOut & { report: Report; cell: DashboardCell; seq: string | null };
  addCell(ws, p.dashboardId, out.report, out.cell);
  queryClient.setQueryData(reportKey(ws.id, p.dashboardId, id), out.report);
  covered(ws, p.dashboardId, out.seq);
  refreshIndex(ws);
  return { report: out.report, cell: out.cell };
}

export const reportKey = (ws: string, dashboardId: string, reportId: string) =>
  [...dashboardsPrefix(ws), dashboardId, 'report', reportId] as const;

export const reportQuery = (ws: WorkspaceRef, dashboardId: string, reportId: string) =>
  queryOptions({
    queryKey: reportKey(ws.id, dashboardId, reportId),
    queryFn: (): Promise<Report> => api.reports.get.query({ reportId }, inWorkspace(ws)) as Promise<Report>,
    retry: (count, error) => httpStatusOf(error) !== 404 && httpStatusOf(error) !== 403 && count < 2,
  });

export interface UpdateReportParams {
  reportId: string;
  dashboardId: string;
  entityDefinitionId?: string;
  filter?: Report['filter'];
  title?: string;
  description?: string | null;
  reportType?: Report['reportType'];
  visualisationType?: Report['visualisationType'];
  settings?: ReportSettings;
}

/** The editor's Save: the server merges settings, resets them on a type change and clears them on a source change. */
export async function updateReport(ws: WorkspaceRef, p: UpdateReportParams): Promise<Report> {
  const { reportId, dashboardId, settings, ...rest } = p;
  const { report, seq } = await serial(`report:${reportId}`, () =>
    api.reports.update.mutate(
      { reportId, ...rest, ...(settings ? { settings: settings as unknown as Record<string, unknown> } : {}) },
      inWorkspace(ws),
    ),
  );
  const saved = report as Report;
  patchDetail(ws, dashboardId, (d) => ({
    ...d,
    cells: d.cells.map((c) => (c.report.id === reportId ? { ...c, report: saved } : c)),
  }));
  queryClient.setQueryData(reportKey(ws.id, dashboardId, reportId), saved);
  covered(ws, dashboardId, seq);
  refreshIndex(ws);
  return saved;
}

/** Delete report: the row's other cells absorb the width (server answers the dashboard's cells). */
export async function deleteReport(ws: WorkspaceRef, dashboardId: string, reportId: string): Promise<boolean> {
  try {
    const out = await api.reports.delete.mutate({ reportId }, inWorkspace(ws));
    const cells = out.cells as DashboardCell[];
    patchDetail(ws, dashboardId, (d) => {
      const byId = new Map(cells.map((c) => [c.id, c]));
      return {
        ...d,
        cells: d.cells
          .filter((c) => c.report.id !== reportId && byId.has(c.id))
          .map((c) => ({
            ...c,
            width: byId.get(c.id)?.width ?? c.width,
            sortOrder: byId.get(c.id)?.sortOrder ?? c.sortOrder,
          }))
          .sort(byRank),
      };
    });
    queryClient.removeQueries({ queryKey: reportKey(ws.id, dashboardId, reportId) });
    covered(ws, dashboardId, out.seq);
    refreshIndex(ws);
    return true;
  } catch (error) {
    fail(error, 'Failed to delete report');
    return false;
  }
}

/** Duplicate: a copy right after the source, same width; the app opens the copy's editor (H README §3.6). */
export async function duplicateReport(
  ws: WorkspaceRef,
  dashboardId: string,
  reportId: string,
): Promise<{ report: Report; cell: DashboardCell } | null> {
  try {
    const out = (await api.reports.duplicate.mutate(
      { reportId, newReportId: newId(), newCellId: newId() },
      inWorkspace(ws),
    )) as unknown as { report: Report; cell: DashboardCell; seq: string | null };
    addCell(ws, dashboardId, out.report, out.cell);
    covered(ws, dashboardId, out.seq);
    refreshIndex(ws);
    toast.success({ title: 'Duplicate report', description: 'Report successfully duplicated' });
    return { report: out.report, cell: out.cell };
  } catch (error) {
    fail(error, 'Failed to duplicate report');
    return null;
  }
}

/** Duplicate to…: a copy at the end of another dashboard. */
export async function duplicateReportTo(
  ws: WorkspaceRef,
  reportId: string,
  targetDashboardId: string,
): Promise<boolean> {
  try {
    const out = (await api.reports.duplicateTo.mutate(
      { reportId, targetDashboardId, newReportId: newId(), newCellId: newId() },
      inWorkspace(ws),
    )) as unknown as { report: Report; cell: DashboardCell; seq: string | null };
    addCell(ws, targetDashboardId, out.report, out.cell);
    covered(ws, targetDashboardId, out.seq);
    refreshIndex(ws);
    toast.success({ title: 'Duplicate report', description: 'Report successfully duplicated' });
    return true;
  } catch (error) {
    fail(error, 'Failed to duplicate report');
    return false;
  }
}

// ---- datasets -----------------------------------------------------------------------------------------------------

export interface DatasetEnv {
  timeZone: string;
  weekStart: number;
}

/** The viewer's zone and week start (X-10): zone from the browser, week start from the locale / preference. */
export function viewerEnv(): DatasetEnv {
  return { timeZone: viewerTimeZone() ?? 'UTC', weekStart: getFormatSettings().weekStartsOn };
}

export type ReportDatasetResult = DatasetOutput & { query: unknown };

const requestedAfter = new Map<string, string>();

function hashOf(key: readonly unknown[]): string {
  return JSON.stringify(key);
}

/** Why a report cannot run yet (a funnel without a status attribute …), else null. */
export function incompleteReason(report: {
  entityDefinitionId: string;
  filter: Report['filter'];
  reportType: Report['reportType'];
  visualisationType: Report['visualisationType'] | null;
  settings: ReportSettings;
}): string | null {
  // A funnel needs at least two statuses (builder §8, `Y5coDI`); the shared compiler only rejects an empty list.
  if (report.reportType === 'funnel') {
    const s = report.settings as { funnelAttributePath: unknown; funnelSelectedPipelineStageIds: string[] };
    if (s.funnelAttributePath && s.funnelSelectedPipelineStageIds.length === 1) return 'Select stages';
  }
  try {
    datasetQueryForReport(report, { today: '2000-01-01', weekStart: 1, timeZone: 'UTC' });
    return null;
  } catch (error) {
    if (error instanceof IncompleteReportError) return error.message;
    return null;
  }
}

/** A saved report's dataset. The key carries `updatedAt`, so an edited report refetches by itself. */
export const savedDatasetQuery = (ws: WorkspaceRef, report: Report, env: DatasetEnv, enabled = true) => {
  const queryKey = [
    ...datasetPrefix(ws.id),
    'saved',
    report.id,
    report.updatedAt,
    env.timeZone,
    env.weekStart,
  ] as const;
  return queryOptions({
    queryKey,
    enabled: enabled && incompleteReason(report) === null,
    // A dataset is a snapshot: only the "New data" button (or a new key) refreshes it.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 10 * 60_000,
    queryFn: async (): Promise<ReportDatasetResult> => {
      const acceptAfter = requestedAfter.get(hashOf(queryKey)) ?? acceptAfterFor(ws.id);
      return (await api.reporting.reportDataset.query(
        {
          reportId: report.id,
          timeZone: env.timeZone,
          weekStart: env.weekStart,
          ...(acceptAfter ? { acceptAfter } : {}),
        },
        inWorkspace(ws),
      )) as unknown as ReportDatasetResult;
    },
  });
};

/** An unsaved editor draft's dataset (re-run for every distinct draft). */
export const draftDatasetQuery = (ws: WorkspaceRef, draft: ReportDraft, env: DatasetEnv, enabled = true) => {
  const queryKey = [...datasetPrefix(ws.id), 'draft', draft, env.timeZone, env.weekStart] as const;
  return queryOptions({
    queryKey,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60_000,
    queryFn: async (): Promise<ReportDatasetResult> => {
      const acceptAfter = requestedAfter.get(hashOf(queryKey)) ?? acceptAfterFor(ws.id);
      return (await api.reporting.reportDataset.query(
        { draft, timeZone: env.timeZone, weekStart: env.weekStart, ...(acceptAfter ? { acceptAfter } : {}) },
        inWorkspace(ws),
      )) as unknown as ReportDatasetResult;
    },
  });
};

/** "New data" / "Refresh data": refetch with `acceptAfter` = the newest stale seq (H README §3.7). */
export function refreshDataset(
  client: QueryClient,
  queryKey: readonly unknown[],
  seq: string | null,
): Promise<unknown> {
  if (seq) requestedAfter.set(hashOf(queryKey), seq);
  return client.refetchQueries({ queryKey: queryKey as unknown[], exact: true });
}

export function useSavedDataset(report: Report, enabled = true) {
  const ws = useWs();
  const env = useMemo(viewerEnv, []);
  const options = savedDatasetQuery(ws, report, env, enabled);
  const result = useQuery(options);
  return { ...result, queryKey: options.queryKey, ws };
}
