// dashboards.* and reports.* (BACKLOG 9.01–9.03, 9.09; H api §1–3, README §3.1–3.6, §3.10–3.11): dashboards with
// default grants, cells on the 12-column grid (layout saved as one shuffle of every cell), reports with their filter
// and per-type settings. Every write emits reporting-dashboard(-list|-cells) invalidations; creates are idempotent
// per client-minted id (I3).
import {
  type CreateDashboardInput,
  type CreateReportInput,
  clampCellWidth,
  createDashboardInputSchema,
  createReportInputSchema,
  type Dashboard,
  type DashboardAccess,
  type DashboardCell,
  type DashboardDetail,
  type DashboardSummary,
  type DeleteDashboardInput,
  type DeleteReportInput,
  type DuplicateDashboardInput,
  type DuplicateReportInput,
  type DuplicateReportToInput,
  defaultReportSettings,
  deleteDashboardInputSchema,
  deleteReportInputSchema,
  duplicateDashboardInputSchema,
  duplicateReportInputSchema,
  duplicateReportToInputSchema,
  type GetDashboardInput,
  type GetReportInput,
  getDashboardInputSchema,
  getReportInputSchema,
  isValidRank,
  type ListDashboardsInput,
  listDashboardsInputSchema,
  normaliseVisualisation,
  type Predicate,
  packDashboardRows,
  type Report,
  type ReportSettings,
  type ReportType,
  rankAfter,
  rankBetween,
  type SetDashboardLayoutInput,
  setDashboardLayoutInputSchema,
  type UpdateDashboardInput,
  type UpdateReportInput,
  updateDashboardInputSchema,
  updateReportInputSchema,
} from '@agentic-crm/contracts';
import { jsonb, sql } from '@agentic-crm/db';
import { deleteFavoritesOfTargets, favoriteIdsFor } from '../collab/favorites.ts';
import { actingMemberId } from '../context.ts';
import { badRequest, conflict, forbidden } from '../errors.ts';
import { newId } from '../ids.ts';
import { requireAdminCaller } from '../permissions/admin.ts';
import { grantDefaultsOnCreate } from '../permissions/service.ts';
import type { Policies } from '../permissions.ts';
import { type DefInfo, loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { resolvePredicate } from '../views/resolve.ts';
import { dashboardAccess, noAccess, requireDashboard } from './access.ts';
import {
  type CellRow,
  loadCells,
  loadDashboardRow,
  loadFilters,
  loadReport,
  loadReportRows,
  loadSource,
  type ReportRow,
  reportDependencies,
  reportNotFound,
  toCell,
  toDashboard,
  toReport,
  validateSettings,
} from './model.ts';

const MAX_CELLS_PER_DASHBOARD = 100;

export interface ReportDeps {
  policies: Policies;
}

function emitCells(tx: Tx, dashboardId: string, cellIds: string[] = [], reportIds: string[] = []): void {
  tx.emit('reporting-dashboard-cells', dashboardId, { dashboardId, cellIds, reportIds });
  // Index rows show report thumbnails and counts.
  tx.emit('reporting-dashboard-list', null);
}

function emitDashboard(tx: Tx, dashboardId: string): void {
  tx.emit('reporting-dashboard', dashboardId, { dashboardId });
  tx.emit('reporting-dashboard-list', null);
}

/** Data sources the caller may read (reports on others are hidden). */
async function readableSources(tx: Tx, deps: ReportDeps, defIds: string[]): Promise<Set<string>> {
  const defs = await loadDefinitionsByIds(tx, defIds);
  const live = [...defs.values()].filter((d) => !d.isArchived);
  const allowed = await deps.policies.allowed(tx, live, 'read_entity_instance');
  return new Set(allowed.map((d) => d.id));
}

/** Validates a filter (paths, operators, dynamic values) the way the dataset engine will resolve it. */
async function validateFilter(tx: Tx, def: DefInfo, filter: Predicate | null): Promise<void> {
  try {
    await resolvePredicate(tx, def, filter, { now: tx.now, timeZone: 'UTC', memberId: actingMemberId(tx.ctx) });
  } catch (err) {
    if ((err as { code?: string }).code === 'UNSUPPORTED_FILTER') {
      throw badRequest('VALIDATION_ERROR', (err as Error).message);
    }
    throw err;
  }
}

async function insertFilter(tx: Tx, defId: string, filter: Predicate | null): Promise<string | null> {
  if (!filter) return null;
  const id = newId();
  await tx.db
    .insertInto('entity_filters')
    .values({
      id,
      workspace_id: tx.workspaceId,
      entity_definition_id: defId,
      parent_type: 'entity-report',
      predicate: jsonb(filter),
      created_at: tx.now,
      updated_at: tx.now,
    })
    .execute();
  return id;
}

async function deleteFilters(tx: Tx, ids: (string | null)[]): Promise<void> {
  const list = ids.filter((x): x is string => x !== null);
  if (list.length > 0) await tx.db.deleteFrom('entity_filters').where('id', 'in', list).execute();
}

interface ReportSpec {
  id: string;
  entityDefinitionId: string;
  filter: Predicate | null;
  title: string;
  description: string | null;
  reportType: ReportType;
  visualisationType: string;
  settings: ReportSettings;
  createdBy?: unknown;
}

async function insertReport(
  tx: Tx,
  spec: ReportSpec,
  cell: { id: string; dashboardId: string; width: number; sortOrder: string },
): Promise<void> {
  const filterId = await insertFilter(tx, spec.entityDefinitionId, spec.filter);
  const deps = reportDependencies(spec.entityDefinitionId, spec.filter, spec.settings);
  await tx.db
    .insertInto('entity_reports')
    .values({
      id: spec.id,
      workspace_id: tx.workspaceId,
      entity_definition_id: spec.entityDefinitionId,
      entity_filter_id: filterId,
      title: spec.title,
      description: spec.description,
      report_type: spec.reportType,
      visualisation_type: spec.visualisationType as ReportRow['visualisation_type'],
      settings: jsonb(spec.settings) as never,
      depends_on_definition_ids: deps.definitionIds,
      depends_on_attribute_ids: deps.attributeIds,
      created_by: jsonb(tx.ctx.actor),
      created_at: tx.now,
      updated_at: tx.now,
    })
    .execute();
  await tx.db
    .insertInto('reporting_dashboard_cells')
    .values({
      id: cell.id,
      workspace_id: tx.workspaceId,
      dashboard_id: cell.dashboardId,
      report_id: spec.id,
      width: clampCellWidth(cell.width),
      sort_order: cell.sortOrder,
      created_at: tx.now,
      updated_at: tx.now,
    })
    .execute();
}

async function assertCellCapacity(tx: Tx, dashboardId: string, adding: number): Promise<void> {
  const row = await tx.db
    .selectFrom('reporting_dashboard_cells')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('dashboard_id', '=', dashboardId)
    .executeTakeFirst();
  if (Number(row?.n ?? 0) + adding > MAX_CELLS_PER_DASHBOARD) {
    throw badRequest('VALIDATION_ERROR', `A dashboard can hold at most ${MAX_CELLS_PER_DASHBOARD} reports`);
  }
}

async function lastRank(tx: Tx, dashboardId: string): Promise<string | null> {
  const row = await tx.db
    .selectFrom('reporting_dashboard_cells')
    .select((eb) => eb.fn.max('sort_order').as('m'))
    .where('dashboard_id', '=', dashboardId)
    .executeTakeFirst();
  return (row?.m as string | null | undefined) ?? null;
}

/** Copies a report (new filter row) into a new cell. */
async function copyReport(
  tx: Tx,
  source: Report,
  ids: { reportId: string; cellId: string },
  cell: { dashboardId: string; width: number; sortOrder: string },
  title = source.title,
): Promise<void> {
  await insertReport(
    tx,
    {
      id: ids.reportId,
      entityDefinitionId: source.entityDefinitionId,
      filter: source.filter,
      title,
      description: source.description,
      reportType: source.reportType,
      visualisationType: source.visualisationType,
      settings: structuredClone(source.settings),
    },
    { id: ids.cellId, ...cell },
  );
}

/** Deletes reports (their cells cascade) and their filters. */
async function deleteReports(tx: Tx, rows: ReportRow[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.db
    .deleteFrom('entity_reports')
    .where(
      'id',
      'in',
      rows.map((r) => r.id),
    )
    .execute();
  await deleteFilters(
    tx,
    rows.map((r) => r.entity_filter_id),
  );
  await deleteFavoritesOfTargets(
    tx,
    'report',
    rows.map((r) => r.id),
  );
}

/**
 * The widths after removing a cell: the remaining cells of its row absorb the freed columns (evenly, remainder to the
 * first ones; H README §3.6 "Delete report").
 */
function absorbWidths(cells: CellRow[], removedId: string): Map<string, number> {
  const rows = packDashboardRows(cells);
  const row = rows.find((r) => r.some((c) => c.cell.id === removedId));
  const out = new Map<string, number>();
  if (!row) return out;
  const removed = row.find((c) => c.cell.id === removedId) as { cell: CellRow };
  const rest = row.filter((c) => c.cell.id !== removedId);
  if (rest.length === 0) return out;
  const freed = clampCellWidth(removed.cell.width);
  const share = Math.floor(freed / rest.length);
  let extra = freed - share * rest.length;
  for (const c of rest) {
    const add = share + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    out.set(c.cell.id, clampCellWidth(c.cell.width + add));
  }
  return out;
}

async function buildDetail(
  tx: Tx,
  deps: ReportDeps,
  row: Awaited<ReturnType<typeof loadDashboardRow>>,
  access: DashboardAccess,
): Promise<DashboardDetail> {
  const cells = await loadCells(tx, [row.id]);
  const reports = await loadReportRows(
    tx,
    cells.map((c) => c.report_id),
  );
  const filters = await loadFilters(
    tx,
    [...reports.values()].map((r) => r.entity_filter_id),
  );
  const readable = await readableSources(
    tx,
    deps,
    [...reports.values()].map((r) => r.entity_definition_id),
  );
  const out: DashboardDetail['cells'] = [];
  let hidden = 0;
  for (const cell of cells) {
    const report = reports.get(cell.report_id);
    if (!report) continue;
    if (!readable.has(report.entity_definition_id)) {
      hidden++;
      continue;
    }
    out.push({ ...toCell(cell), report: toReport(report, cell, filters.get(report.entity_filter_id ?? '') ?? null) });
  }
  const favorites = await favoriteIdsFor(tx, 'reporting-dashboard', [row.id]);
  return {
    dashboard: toDashboard(row),
    cells: out,
    hiddenReportCount: hidden,
    access,
    favoriteId: favorites.get(row.id) ?? null,
  };
}

export function dashboardOps(deps: ReportDeps) {
  const ops = {
    /** Dashboards index (newest first; date buckets and favourites strip are grouped by the client). */
    async list(tx: Tx, input?: ListDashboardsInput): Promise<DashboardSummary[]> {
      const data = listDashboardsInputSchema.parse(input) ?? { scope: 'member' as const };
      const admin = data.scope === 'admin';
      if (admin) await requireAdminCaller(tx, 'Only workspace admins can manage dashboards');
      const query = data.query?.trim();
      const rows = await tx.db
        .selectFrom('reporting_dashboards')
        .selectAll()
        .$if(Boolean(query), (q) => q.where(sql<boolean>`strpos(lower(title), lower(${query as string})) > 0`))
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
      const access = await dashboardAccess(
        tx,
        rows.map((r) => r.id),
      );
      const visible = admin ? rows : rows.filter((r) => access.get(r.id)?.flags.read_reporting_dashboard);
      const ids = visible.map((r) => r.id);
      const cells = await loadCells(tx, ids);
      const reports = await loadReportRows(
        tx,
        cells.map((c) => c.report_id),
      );
      const readable = await readableSources(
        tx,
        deps,
        [...reports.values()].map((r) => r.entity_definition_id),
      );
      const favorites = await favoriteIdsFor(tx, 'reporting-dashboard', ids);
      return visible.map((r) => {
        const own = cells
          .filter((c) => c.dashboard_id === r.id)
          .map((c) => reports.get(c.report_id))
          .filter((x): x is ReportRow => x !== undefined && (admin || readable.has(x.entity_definition_id)));
        return {
          ...toDashboard(r),
          favoriteId: favorites.get(r.id) ?? null,
          reportCount: own.length,
          reports: own.map((x) => ({
            id: x.id,
            title: x.title,
            reportType: x.report_type,
            visualisationType: x.visualisation_type ?? 'bar',
          })),
          access: access.get(r.id) ?? noAccess(),
        };
      });
    },

    /** One dashboard with its cells and reports (reports on unreadable sources are counted, not returned). */
    async get(tx: Tx, input: GetDashboardInput): Promise<DashboardDetail> {
      const data = getDashboardInputSchema.parse(input);
      if (data.scope === 'admin') {
        await requireAdminCaller(tx, 'Only workspace admins can manage dashboards');
        const row = await loadDashboardRow(tx, data.dashboardId);
        const access = (await dashboardAccess(tx, [row.id])).get(row.id) ?? noAccess();
        return buildDetail(tx, deps, row, access);
      }
      const { row, access } = await requireDashboard(tx, data.dashboardId, 'read_reporting_dashboard');
      return buildDetail(tx, deps, row, access);
    },

    /** `PUT /reporting-dashboards/{uuid}`: workspace Full access + creator Full access (H api §1.5). */
    async create(tx: Tx, input: CreateDashboardInput): Promise<DashboardDetail> {
      const data = createDashboardInputSchema.parse(input);
      const existing = await tx.db
        .selectFrom('reporting_dashboards')
        .selectAll()
        .where('id', '=', data.id)
        .executeTakeFirst();
      if (!existing) {
        await tx.db
          .insertInto('reporting_dashboards')
          .values({
            id: data.id,
            workspace_id: tx.workspaceId,
            title: data.title,
            description: data.description,
            created_by: jsonb(tx.ctx.actor),
            created_at: tx.now,
            updated_at: tx.now,
          })
          .execute();
        await grantDefaultsOnCreate(tx, 'dashboard', data.id);
        emitDashboard(tx, data.id);
      }
      return ops.get(tx, { dashboardId: data.id });
    },

    async update(tx: Tx, input: UpdateDashboardInput): Promise<Dashboard> {
      const data = updateDashboardInputSchema.parse(input);
      const { row } = await requireDashboard(tx, data.dashboardId, 'update_reporting_dashboard');
      if (data.title === undefined && data.description === undefined) return toDashboard(row);
      const updated = await tx.db
        .updateTable('reporting_dashboards')
        .set({
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          updated_at: tx.now,
        })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      emitDashboard(tx, row.id);
      return toDashboard(updated);
    },

    /** Deletes the dashboard with its cells, reports, report filters, grants and favourites (README §3.10). */
    async delete(tx: Tx, input: DeleteDashboardInput): Promise<{ id: string }> {
      const data = deleteDashboardInputSchema.parse(input);
      const { row } = await requireDashboard(tx, data.dashboardId, 'delete_reporting_dashboard');
      const cells = await loadCells(tx, [row.id]);
      const reports = await loadReportRows(
        tx,
        cells.map((c) => c.report_id),
      );
      await deleteReports(tx, [...reports.values()]);
      await tx.db.deleteFrom('reporting_dashboards').where('id', '=', row.id).execute();
      await tx.db
        .deleteFrom('resource_permissions')
        .where('resource_kind', '=', 'dashboard')
        .where('resource_id', '=', row.id)
        .execute();
      await deleteFavoritesOfTargets(tx, 'reporting-dashboard', [row.id]);
      emitDashboard(tx, row.id);
      emitCells(tx, row.id);
      return { id: row.id };
    },

    /** A copy of the dashboard with copies of its reports (same layout); the caller gets the default grants. */
    async duplicate(tx: Tx, input: DuplicateDashboardInput): Promise<DashboardDetail> {
      const data = duplicateDashboardInputSchema.parse(input);
      const existing = await tx.db
        .selectFrom('reporting_dashboards')
        .select('id')
        .where('id', '=', data.newDashboardId)
        .executeTakeFirst();
      if (existing) return ops.get(tx, { dashboardId: data.newDashboardId });
      const { row, access } = await requireDashboard(tx, data.dashboardId, 'read_reporting_dashboard');
      const source = await buildDetail(tx, deps, row, access);
      if (source.hiddenReportCount > 0) {
        throw forbidden('This dashboard has reports you cannot access', { reporting_dashboard_id: row.id });
      }
      await tx.db
        .insertInto('reporting_dashboards')
        .values({
          id: data.newDashboardId,
          workspace_id: tx.workspaceId,
          title: data.title ?? `Copy of ${row.title}`,
          description: row.description,
          created_by: jsonb(tx.ctx.actor),
          created_at: tx.now,
          updated_at: tx.now,
        })
        .execute();
      await grantDefaultsOnCreate(tx, 'dashboard', data.newDashboardId);
      for (const c of source.cells) {
        await copyReport(
          tx,
          c.report,
          { reportId: newId(), cellId: newId() },
          { dashboardId: data.newDashboardId, width: c.width, sortOrder: c.sortOrder },
        );
      }
      emitDashboard(tx, data.newDashboardId);
      emitCells(tx, data.newDashboardId);
      return ops.get(tx, { dashboardId: data.newDashboardId });
    },

    /** `cells/shuffle`: ranks and widths of every cell in one call (README §3.3). Answers all cells in order. */
    async setLayout(tx: Tx, input: SetDashboardLayoutInput): Promise<DashboardCell[]> {
      const data = setDashboardLayoutInputSchema.parse(input);
      const { row } = await requireDashboard(tx, data.dashboardId, 'update_reporting_dashboard');
      const cells = await loadCells(tx, [row.id]);
      const known = new Set(cells.map((c) => c.id));
      const given = new Set(data.cells.map((c) => c.cellId));
      if (given.size !== data.cells.length || given.size !== known.size || [...given].some((id) => !known.has(id))) {
        throw badRequest('VALIDATION_ERROR', 'The layout must list every cell of the dashboard exactly once', {
          reporting_dashboard_id: row.id,
        });
      }
      const ranks = new Set<string>();
      for (const c of data.cells) {
        if (!isValidRank(c.sortOrder)) throw badRequest('VALIDATION_ERROR', `Invalid rank "${c.sortOrder}"`);
        if (ranks.has(c.sortOrder)) throw badRequest('VALIDATION_ERROR', 'Two cells cannot share a rank');
        ranks.add(c.sortOrder);
      }
      const byId = new Map(cells.map((c) => [c.id, c]));
      const changed: string[] = [];
      for (const c of data.cells) {
        const cur = byId.get(c.cellId) as CellRow;
        const width = clampCellWidth(c.width);
        if (cur.sort_order === c.sortOrder && cur.width === width) continue;
        await tx.db
          .updateTable('reporting_dashboard_cells')
          .set({ sort_order: c.sortOrder, width, updated_at: tx.now })
          .where('id', '=', c.cellId)
          .execute();
        changed.push(c.cellId);
      }
      if (changed.length > 0) emitCells(tx, row.id, changed);
      return (await loadCells(tx, [row.id])).map(toCell);
    },
  };
  return ops;
}

export function reportOps(deps: ReportDeps) {
  /** A report the caller can read: dashboard read access and read access to the data source. */
  async function readable(tx: Tx, reportId: string) {
    const loaded = await loadReport(tx, reportId);
    const { access } = await requireDashboard(tx, loaded.cell.dashboard_id, 'read_reporting_dashboard').catch((err) => {
      if ((err as { statusCode?: number }).statusCode === 404) throw reportNotFound(reportId);
      throw err;
    });
    if (!(await readableSources(tx, deps, [loaded.row.entity_definition_id])).has(loaded.row.entity_definition_id)) {
      throw reportNotFound(reportId);
    }
    return { ...loaded, access };
  }

  async function writable(tx: Tx, reportId: string) {
    const loaded = await readable(tx, reportId);
    if (!loaded.access.flags.update_reporting_dashboard) {
      throw forbidden('You do not have permission to edit this dashboard', {
        reporting_dashboard_id: loaded.cell.dashboard_id,
        action: 'update_reporting_dashboard',
      });
    }
    return loaded;
  }

  async function source(tx: Tx, ref: string): Promise<DefInfo> {
    const def = await loadSource(tx, ref);
    await deps.policies.assertCan(tx, def.id, 'read_entity_instance');
    return def;
  }

  const ops = {
    readable,

    async get(tx: Tx, input: GetReportInput): Promise<Report> {
      const data = getReportInputSchema.parse(input);
      return (await readable(tx, data.reportId)).report;
    },

    /** Report + filter + cell at the end of the dashboard (width 12 by default) in one transaction (api §3). */
    async create(tx: Tx, input: CreateReportInput): Promise<{ report: Report; cell: DashboardCell }> {
      const data = createReportInputSchema.parse(input);
      const existing = await tx.db
        .selectFrom('entity_reports')
        .select('id')
        .where('id', '=', data.id)
        .executeTakeFirst();
      if (existing) {
        const loaded = await readable(tx, data.id);
        if (loaded.cell.dashboard_id !== data.dashboardId) {
          throw conflict('ID_CONFLICT', 'A report with this id already exists', { entity_report_id: data.id });
        }
        return { report: loaded.report, cell: toCell(loaded.cell) };
      }
      const { row: dashboard } = await requireDashboard(tx, data.dashboardId, 'update_reporting_dashboard');
      await assertCellCapacity(tx, dashboard.id, 1);
      const def = await source(tx, data.entityDefinitionId);
      await validateFilter(tx, def, data.filter);
      const settings = await validateSettings(tx, def, data.reportType, data.settings);
      if (data.sortOrder !== undefined && !isValidRank(data.sortOrder)) {
        throw badRequest('VALIDATION_ERROR', `Invalid rank "${data.sortOrder}"`);
      }
      await insertReport(
        tx,
        {
          id: data.id,
          entityDefinitionId: def.id,
          filter: data.filter,
          title: data.title,
          description: data.description,
          reportType: data.reportType,
          visualisationType: normaliseVisualisation(data.reportType, settings, data.visualisationType ?? null),
          settings,
        },
        {
          id: data.cellId,
          dashboardId: dashboard.id,
          width: data.width,
          sortOrder: data.sortOrder ?? rankAfter(await lastRank(tx, dashboard.id), { jitter: true }),
        },
      );
      emitCells(tx, dashboard.id, [data.cellId], [data.id]);
      const loaded = await loadReport(tx, data.id);
      return { report: loaded.report, cell: toCell(loaded.cell) };
    },

    /**
     * Save: title, description, data source (clears filter and attribute settings), filter, type (resets settings
     * to the type's defaults), visualisation and settings (partial, over the current ones).
     */
    async update(tx: Tx, input: UpdateReportInput): Promise<Report> {
      const data = updateReportInputSchema.parse(input);
      const { row, report } = await writable(tx, data.reportId);
      const def = await source(tx, data.entityDefinitionId ?? row.entity_definition_id);
      const changedSource = def.id !== row.entity_definition_id;
      const type = data.reportType ?? row.report_type;
      const reset = changedSource || type !== row.report_type;
      const base = reset ? defaultReportSettings(type) : (report.settings as ReportSettings);
      const settings = await validateSettings(tx, def, type, data.settings, base);
      const filter =
        data.filter !== undefined ? data.filter : changedSource ? null : (report.filter as Predicate | null);
      await validateFilter(tx, def, filter);
      let filterId = row.entity_filter_id;
      if (data.filter !== undefined || changedSource) {
        if (filterId && filter) {
          await tx.db
            .updateTable('entity_filters')
            .set({ predicate: jsonb(filter), entity_definition_id: def.id, updated_at: tx.now })
            .where('id', '=', filterId)
            .execute();
        } else if (filterId && !filter) {
          await tx.db.updateTable('entity_reports').set({ entity_filter_id: null }).where('id', '=', row.id).execute();
          await deleteFilters(tx, [filterId]);
          filterId = null;
        } else if (!filterId && filter) {
          filterId = await insertFilter(tx, def.id, filter);
        }
      }
      const requested = data.visualisationType !== undefined ? data.visualisationType : row.visualisation_type;
      const dependencies = reportDependencies(def.id, filter, settings);
      await tx.db
        .updateTable('entity_reports')
        .set({
          entity_definition_id: def.id,
          entity_filter_id: filterId,
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          report_type: type,
          visualisation_type: normaliseVisualisation(type, settings, requested) as ReportRow['visualisation_type'],
          settings: jsonb(settings) as never,
          depends_on_definition_ids: dependencies.definitionIds,
          depends_on_attribute_ids: dependencies.attributeIds,
          updated_at: tx.now,
        })
        .where('id', '=', row.id)
        .execute();
      emitCells(tx, report.dashboardId, [report.cellId], [row.id]);
      return (await loadReport(tx, row.id)).report;
    },

    /** Delete report: its cell (the row's other cells absorb the freed width), the report and its filter. */
    async delete(tx: Tx, input: DeleteReportInput): Promise<{ id: string; cells: DashboardCell[] }> {
      const data = deleteReportInputSchema.parse(input);
      const { row, cell } = await writable(tx, data.reportId);
      const cells = await loadCells(tx, [cell.dashboard_id]);
      const widths = absorbWidths(cells, cell.id);
      await deleteReports(tx, [row]);
      for (const [id, width] of widths) {
        await tx.db
          .updateTable('reporting_dashboard_cells')
          .set({ width, updated_at: tx.now })
          .where('id', '=', id)
          .execute();
      }
      emitCells(tx, cell.dashboard_id, [cell.id, ...widths.keys()], [row.id]);
      return { id: row.id, cells: (await loadCells(tx, [cell.dashboard_id])).map(toCell) };
    },

    /** Duplicate: a copy (same title) right after the source cell, with the source's width (README §3.6). */
    async duplicate(tx: Tx, input: DuplicateReportInput): Promise<{ report: Report; cell: DashboardCell }> {
      const data = duplicateReportInputSchema.parse(input);
      const replay = await tx.db
        .selectFrom('entity_reports')
        .select('id')
        .where('id', '=', data.newReportId)
        .executeTakeFirst();
      if (replay) {
        const loaded = await readable(tx, data.newReportId);
        return { report: loaded.report, cell: toCell(loaded.cell) };
      }
      const { report, cell } = await writable(tx, data.reportId);
      await assertCellCapacity(tx, cell.dashboard_id, 1);
      const next = await tx.db
        .selectFrom('reporting_dashboard_cells')
        .select('sort_order')
        .where('dashboard_id', '=', cell.dashboard_id)
        .where('sort_order', '>', cell.sort_order)
        .orderBy('sort_order')
        .limit(1)
        .executeTakeFirst();
      await copyReport(
        tx,
        report,
        { reportId: data.newReportId, cellId: data.newCellId },
        {
          dashboardId: cell.dashboard_id,
          width: cell.width,
          sortOrder: rankBetween(cell.sort_order, next?.sort_order ?? null, { jitter: true }),
        },
      );
      emitCells(tx, cell.dashboard_id, [data.newCellId], [data.newReportId]);
      const loaded = await loadReport(tx, data.newReportId);
      return { report: loaded.report, cell: toCell(loaded.cell) };
    },

    /** Duplicate to…: a copy at the end of another dashboard the caller can edit (`daIaBT` otherwise). */
    async duplicateTo(tx: Tx, input: DuplicateReportToInput): Promise<{ report: Report; cell: DashboardCell }> {
      const data = duplicateReportToInputSchema.parse(input);
      const replay = await tx.db
        .selectFrom('entity_reports')
        .select('id')
        .where('id', '=', data.newReportId)
        .executeTakeFirst();
      if (replay) {
        const loaded = await readable(tx, data.newReportId);
        return { report: loaded.report, cell: toCell(loaded.cell) };
      }
      const { report } = await readable(tx, data.reportId);
      const { row: target } = await requireDashboard(tx, data.targetDashboardId, 'update_reporting_dashboard');
      await assertCellCapacity(tx, target.id, 1);
      await copyReport(
        tx,
        report,
        { reportId: data.newReportId, cellId: data.newCellId },
        {
          dashboardId: target.id,
          width: data.width,
          sortOrder: rankAfter(await lastRank(tx, target.id), { jitter: true }),
        },
      );
      emitCells(tx, target.id, [data.newCellId], [data.newReportId]);
      const loaded = await loadReport(tx, data.newReportId);
      return { report: loaded.report, cell: toCell(loaded.cell) };
    },
  };
  return ops;
}
