// In-transaction model of dashboards, cells and reports: row loading, API mapping, settings validation and the
// dependency sets (definitions + attributes a report reads) used by report-stale invalidations.
import {
  type Actor,
  type Dashboard,
  type DashboardCell,
  type Path,
  type Predicate,
  parseReportSettings,
  type Report,
  type ReportGrouping,
  type ReportMetric,
  type ReportSettings,
  type ReportType,
  type VisualisationType,
} from '@agentic-crm/contracts';
import type {
  EntityReportsTable,
  ReportingDashboardCellsTable,
  ReportingDashboardsTable,
  Selectable,
} from '@agentic-crm/db';
import { ZodError } from 'zod';
import { badRequest, notFound } from '../errors.ts';
import { type AttrDef, type DefInfo, loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { walkPath } from '../views/resolve.ts';

export type DashboardRow = Selectable<ReportingDashboardsTable>;
export type ReportRow = Selectable<EntityReportsTable>;
export type CellRow = Selectable<ReportingDashboardCellsTable>;

export const dashboardNotFound = (id: string) =>
  notFound('This dashboard either doesn’t exist or you don’t have permission to access it', {
    reporting_dashboard_id: id,
  });
export const reportNotFound = (id: string) =>
  notFound('This report either doesn’t exist or you don’t have permission to access it', { entity_report_id: id });

const toActor = (value: unknown): Actor => {
  const v = (value ?? {}) as { type?: string; id?: string | null };
  return { type: (v.type ?? 'system') as Actor['type'], id: v.id ?? null };
};

export function toDashboard(row: DashboardRow): Dashboard {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    createdBy: toActor(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCell(row: CellRow): DashboardCell {
  return {
    id: row.id,
    dashboardId: row.dashboard_id,
    reportId: row.report_id,
    width: row.width,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export function toReport(row: ReportRow, cell: CellRow, filter: Predicate | null): Report {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    dashboardId: cell.dashboard_id,
    cellId: cell.id,
    entityDefinitionId: row.entity_definition_id,
    entityFilterId: row.entity_filter_id,
    filter,
    title: row.title,
    description: row.description,
    reportType: row.report_type,
    visualisationType: (row.visualisation_type ?? 'bar') as VisualisationType,
    settings: row.settings as unknown as ReportSettings,
    createdBy: toActor(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as Report;
}

export async function loadDashboardRow(tx: Tx, id: string): Promise<DashboardRow> {
  const row = await tx.db.selectFrom('reporting_dashboards').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw dashboardNotFound(id);
  return row;
}

export async function loadCells(tx: Tx, dashboardIds: string[]): Promise<CellRow[]> {
  if (dashboardIds.length === 0) return [];
  return tx.db
    .selectFrom('reporting_dashboard_cells')
    .selectAll()
    .where('dashboard_id', 'in', dashboardIds)
    .orderBy('dashboard_id')
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
}

export async function loadReportRows(tx: Tx, ids: string[]): Promise<Map<string, ReportRow>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.db.selectFrom('entity_reports').selectAll().where('id', 'in', ids).execute();
  return new Map(rows.map((r) => [r.id, r]));
}

export async function loadFilters(tx: Tx, filterIds: (string | null)[]): Promise<Map<string, Predicate | null>> {
  const ids = [...new Set(filterIds.filter((x): x is string => x !== null))];
  if (ids.length === 0) return new Map();
  const rows = await tx.db.selectFrom('entity_filters').select(['id', 'predicate']).where('id', 'in', ids).execute();
  return new Map(rows.map((r) => [r.id, (r.predicate ?? null) as Predicate | null]));
}

/** A report with its cell and filter; 404 when missing. */
export async function loadReport(tx: Tx, reportId: string): Promise<{ row: ReportRow; cell: CellRow; report: Report }> {
  const row = await tx.db.selectFrom('entity_reports').selectAll().where('id', '=', reportId).executeTakeFirst();
  const cell = row
    ? await tx.db.selectFrom('reporting_dashboard_cells').selectAll().where('report_id', '=', row.id).executeTakeFirst()
    : undefined;
  if (!row || !cell) throw reportNotFound(reportId);
  const filters = await loadFilters(tx, [row.entity_filter_id]);
  return { row, cell, report: toReport(row, cell, filters.get(row.entity_filter_id ?? '') ?? null) };
}

// ---------------------------------------------------------------------------------------------------------------
// Settings validation

const NUMERIC = new Set(['number', 'currency', 'rating']);
const DISCRETE = new Set(['pipeline', 'select']);

const invalid = (message: string, details?: Record<string, unknown>) =>
  badRequest('VALIDATION_ERROR', message, details);

async function pathLeaf(tx: Tx, def: DefInfo, path: Path, what: string): Promise<AttrDef> {
  const first = path[0];
  if (!first || first.entityDefinitionId !== def.id) {
    throw invalid(`The ${what} path must start at the report's data source`);
  }
  try {
    const { attrs } = await walkPath(tx, def, path);
    return attrs[attrs.length - 1] as AttrDef;
  } catch (err) {
    if ((err as { code?: string }).code === 'UNSUPPORTED_FILTER') throw invalid(`${what}: ${(err as Error).message}`);
    throw err;
  }
}

async function validateMetric(tx: Tx, def: DefInfo, metric: ReportMetric | null, what = 'metric'): Promise<void> {
  if (!metric || metric.attributePath === null) {
    if (metric && metric.aggregation !== 'count') throw invalid('Count Records uses the count aggregation');
    return;
  }
  const leaf = await pathLeaf(tx, def, metric.attributePath, what);
  if (metric.aggregation !== 'count' && (!NUMERIC.has(leaf.type) || leaf.isMultiselect)) {
    throw invalid(`"${leaf.title}" is not a number, currency or rating attribute`, {
      attribute_definition_id: leaf.id,
    });
  }
}

async function validateGrouping(tx: Tx, def: DefInfo, g: ReportGrouping | null, what: string): Promise<void> {
  if (!g) return;
  await pathLeaf(tx, def, g.attributePath, what);
}

async function validateStatusPath(tx: Tx, def: DefInfo, path: Path | null): Promise<void> {
  if (!path) return;
  const leaf = await pathLeaf(tx, def, path, 'status attribute');
  if (!DISCRETE.has(leaf.type) || leaf.isMultiselect) {
    throw invalid(`"${leaf.title}" is not a status or select attribute`, { attribute_definition_id: leaf.id });
  }
}

/** Parses partial settings over `base` and checks every attribute path against the data source. */
export async function validateSettings<T extends ReportType>(
  tx: Tx,
  def: DefInfo,
  type: T,
  partial: Record<string, unknown> | undefined,
  base?: ReportSettings,
): Promise<ReportSettings> {
  let settings: ReportSettings;
  try {
    settings = parseReportSettings(type, partial, base as never);
  } catch (err) {
    if (err instanceof ZodError) {
      throw invalid('Invalid report settings', {
        validation_errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    throw err;
  }
  const s = settings as Record<string, unknown>;
  if ('primaryMetric' in s) await validateMetric(tx, def, s.primaryMetric as ReportMetric);
  if ('metric' in s) await validateMetric(tx, def, s.metric as ReportMetric | null);
  if ('primaryGrouping' in s) await validateGrouping(tx, def, s.primaryGrouping as ReportGrouping | null, 'group by');
  if ('secondaryGrouping' in s)
    await validateGrouping(tx, def, s.secondaryGrouping as ReportGrouping | null, 'segment by');
  if ('statusAttributePath' in s) await validateStatusPath(tx, def, s.statusAttributePath as Path | null);
  if ('funnelAttributePath' in s) await validateStatusPath(tx, def, s.funnelAttributePath as Path | null);
  return settings;
}

// ---------------------------------------------------------------------------------------------------------------
// Dependencies

function collectPath(path: Path | null | undefined, defs: Set<string>, attrs: Set<string>): void {
  for (const hop of path ?? []) {
    defs.add(hop.entityDefinitionId);
    attrs.add(hop.attributeDefinitionId);
  }
}

export function collectPredicate(p: Predicate | null, defs: Set<string>, attrs: Set<string>): void {
  if (!p) return;
  if ('and' in p) for (const c of p.and) collectPredicate(c, defs, attrs);
  else if ('or' in p) for (const c of p.or) collectPredicate(c, defs, attrs);
  else collectPath(p.path, defs, attrs);
}

/** Definitions and attributes a report reads (data source, filter, metric, groupings, status attribute). */
export function reportDependencies(
  entityDefinitionId: string,
  filter: Predicate | null,
  settings: ReportSettings,
): { definitionIds: string[]; attributeIds: string[] } {
  const defs = new Set<string>([entityDefinitionId]);
  const attrs = new Set<string>();
  collectPredicate(filter, defs, attrs);
  const s = settings as Record<string, unknown>;
  for (const key of ['primaryMetric', 'metric'])
    collectPath((s[key] as ReportMetric | null)?.attributePath, defs, attrs);
  for (const key of ['primaryGrouping', 'secondaryGrouping'])
    collectPath((s[key] as ReportGrouping | null)?.attributePath, defs, attrs);
  for (const key of ['statusAttributePath', 'funnelAttributePath']) collectPath(s[key] as Path | null, defs, attrs);
  return { definitionIds: [...defs].sort(), attributeIds: [...attrs].sort() };
}

/** The report's data source; 400 when it is not an object or list with records. */
export async function loadSource(tx: Tx, ref: string): Promise<DefInfo> {
  const def = await loadDefinition(tx, ref);
  if (!def.projectionTable || def.isArchived) {
    throw invalid('Reports can only use objects and lists as data sources', { entity_definition_id: ref });
  }
  return def;
}
