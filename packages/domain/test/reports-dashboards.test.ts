// Slice 9 dashboards and reports (BACKLOG 9.01–9.03, 9.09, 9.10; H api §1–3, README §3): CRUD with default grants,
// per-type report defaults and save behaviour, the 12-column layout (shuffle, delete absorbs width, duplicate after the
// source), Duplicate to…, permissions (read only, no access, hidden reports), favourites, dashboard duplication,
// report datasets by id and draft, list data sources, and acceptance 3: a stage change elsewhere produces a
// report-stale invalidation for the affected cells.
import {
  type CreateReportInput,
  defaultReportSettings,
  type Path,
  packDashboardRows,
  type ReportType,
  rankBetween,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, changeRows, createRecord, lastChangeId } from './collab-fixtures.ts';
import { createDeal, type DealsFixture, dealsFixture } from './reports-fixtures.ts';
import { database, domain, expectCode, newId } from './support/harness.ts';

let f: DealsFixture;

beforeAll(async () => {
  f = await dealsFixture();
  await createDeal(f, { name: 'One', stage: f.stages.lead, amount: 10, priority: f.options.high });
  await createDeal(f, { name: 'Two', stage: f.stages.won, amount: 20 });
});

const newDashboard = async (ctx = f.ctx, title?: string) =>
  (await domain.dashboards.create(ctx, { id: newId(), ...(title ? { title } : {}) })).dashboard;

const newReport = (dashboardId: string, input: Partial<CreateReportInput> & { reportType: ReportType }) =>
  domain.reports.create(f.ctx, {
    id: newId(),
    cellId: newId(),
    dashboardId,
    entityDefinitionId: f.deals,
    ...input,
  });

describe('dashboards', () => {
  it('creates with the default title and grants (workspace and creator Full access), idempotently', async () => {
    const id = newId();
    const created = await domain.dashboards.create(f.ctx, { id });
    expect(created.dashboard).toMatchObject({ id, title: 'New Dashboard', description: '' });
    expect(created.cells).toEqual([]);
    expect(created.access).toMatchObject({ level: 'full-access', canManagePermissions: true });
    const replay = await domain.dashboards.create(f.ctx, { id, title: 'Other' });
    expect(replay.dashboard.title).toBe('New Dashboard');
    const grants = await domain.permissions.list(f.ctx, { resourceKind: 'dashboard', resourceId: id });
    expect(grants.resourceName).toBe('New Dashboard');
    expect(grants.grants.map((g) => [g.target.type, g.level])).toEqual([
      ['workspace', 'full-access'],
      ['member', 'full-access'],
    ]);
    expect(grants.grants[0]?.flags).toEqual({
      administrate_reporting_dashboard_permissions: true,
      read_reporting_dashboard: true,
      update_reporting_dashboard: true,
      delete_reporting_dashboard: true,
    });
  });

  it('renames, lists newest first with search, favourites and report thumbnails', async () => {
    const a = await newDashboard(f.ctx, 'Pipeline health');
    const b = await newDashboard(f.ctx, 'Revenue');
    const renamed = await domain.dashboards.update(f.ctx, { dashboardId: a.id, description: 'Weekly' });
    expect(renamed).toMatchObject({ title: 'Pipeline health', description: 'Weekly' });
    await newReport(b.id, { reportType: 'insights', title: 'Deals by stage' });
    const favoriteId = newId();
    await domain.favorites.put(f.ctx, { id: favoriteId, favoriteType: 'reporting-dashboard', targetId: b.id });
    const all = await domain.dashboards.list(f.ctx);
    const ids = all.map((d) => d.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    const rb = all.find((d) => d.id === b.id);
    expect(rb).toMatchObject({ favoriteId, reportCount: 1, access: { level: 'full-access' } });
    expect(rb?.reports).toEqual([
      expect.objectContaining({ title: 'Deals by stage', reportType: 'insights', visualisationType: 'single_metric' }),
    ]);
    const found = await domain.dashboards.list(f.ctx, { query: 'REVEN' });
    expect(found.map((d) => d.id)).toEqual([b.id]);
    const favorites = await domain.favorites.list(f.ctx);
    expect(favorites.favorites.find((x) => x.id === favoriteId)?.target).toEqual({
      state: 'ok',
      label: 'Revenue',
      secondaryLabel: null,
    });
  });

  it('deletes the dashboard with its reports, cells, filters, grants and favourites', async () => {
    const d = await newDashboard();
    const { report } = await newReport(d.id, {
      reportType: 'insights',
      filter: { path: f.path('stage'), mode: 'must', constraints: [] },
    });
    await domain.favorites.put(f.ctx, { id: newId(), favoriteType: 'reporting-dashboard', targetId: d.id });
    await domain.dashboards.delete(f.ctx, { dashboardId: d.id });
    await expectCode(domain.dashboards.get(f.ctx, { dashboardId: d.id }), 'NOT_FOUND', 404);
    await expectCode(domain.reports.get(f.ctx, { reportId: report.id }), 'NOT_FOUND', 404);
    const leftovers = await sql<{ n: string }>`
      SELECT (SELECT count(*) FROM entity_filters WHERE id = ${report.entityFilterId}::uuid)
           + (SELECT count(*) FROM resource_permissions WHERE resource_id = ${d.id}::uuid)
           + (SELECT count(*) FROM favorites WHERE target_id = ${d.id}::uuid)
           + (SELECT count(*) FROM reporting_dashboard_cells WHERE dashboard_id = ${d.id}::uuid) AS n`.execute(
      database.kysely,
    );
    expect(Number(leftovers.rows[0]?.n)).toBe(0);
  });

  it('duplicates a dashboard with copies of its reports in the same layout', async () => {
    const d = await newDashboard(f.ctx, 'Sales');
    const r1 = await newReport(d.id, { reportType: 'insights', width: 6, title: 'A' });
    await newReport(d.id, { reportType: 'funnel', width: 6, title: 'B' });
    const copyId = newId();
    const copy = await domain.dashboards.duplicate(f.ctx, { dashboardId: d.id, newDashboardId: copyId });
    expect(copy.dashboard.title).toBe('Copy of Sales');
    expect(copy.cells.map((c) => [c.report.title, c.width])).toEqual([
      ['A', 6],
      ['B', 6],
    ]);
    expect(copy.cells[0]?.report.id).not.toBe(r1.report.id);
    expect(copy.access.level).toBe('full-access');
  });
});

describe('reports', () => {
  it('creates a report and its full-width cell after the last one, with the type defaults (builder §6)', async () => {
    const d = await newDashboard();
    const first = await newReport(d.id, { reportType: 'insights' });
    expect(first.cell).toMatchObject({ width: 12, dashboardId: d.id, reportId: first.report.id });
    expect(first.report).toMatchObject({
      title: 'New report',
      description: null,
      reportType: 'insights',
      visualisationType: 'single_metric',
      filter: null,
      entityFilterId: null,
      settings: defaultReportSettings('insights'),
    });
    for (const type of ['historical', 'funnel', 'time-in-stage', 'stage-changed'] as const) {
      const r = await newReport(d.id, { reportType: type });
      expect(r.report.settings).toEqual(defaultReportSettings(type));
      expect(r.cell.sortOrder > first.cell.sortOrder).toBe(true);
    }
    const detail = await domain.dashboards.get(f.ctx, { dashboardId: d.id });
    expect(detail.cells.map((c) => c.report.visualisationType)).toEqual([
      'single_metric',
      'bar',
      'funnel',
      'bar',
      'bar',
    ]);
  });

  it('stores the filter as an entity filter of the report and validates settings against the source', async () => {
    const d = await newDashboard();
    const filter = {
      path: f.path('priority'),
      mode: 'must' as const,
      constraints: [{ field: 'select_option_id', operator: 'eq' as const, value: f.options.high }],
    };
    const { report } = await newReport(d.id, {
      reportType: 'insights',
      filter,
      settings: {
        primaryMetric: { attributePath: f.path('amount'), field: 'raw_value', aggregation: 'sum' },
        primaryGrouping: { attributePath: f.path('stage'), field: 'pipeline_stage_id' },
        secondaryGrouping: { attributePath: f.path('priority') },
      },
      visualisationType: 'pie',
    });
    // Pie is not allowed with a segment: normalised to bar.
    expect(report.visualisationType).toBe('bar');
    expect(report.filter).toEqual({ ...filter, constraints: [{ ...filter.constraints[0], valueType: 'static' }] });
    const row = await sql<{
      parent_type: string;
    }>`SELECT parent_type FROM entity_filters WHERE id = ${report.entityFilterId}::uuid`.execute(database.kysely);
    expect(row.rows[0]?.parent_type).toBe('entity-report');
    expect(report.settings).toMatchObject({
      primaryGrouping: { nullGroupVisible: true, emptyGroupsVisible: false, selectedValues: null },
    });
    const deps = await sql<{ defs: string[]; attrs: string[] }>`
      SELECT depends_on_definition_ids AS defs, depends_on_attribute_ids AS attrs FROM entity_reports WHERE id = ${report.id}::uuid`.execute(
      database.kysely,
    );
    expect(deps.rows[0]?.defs).toEqual([f.deals]);
    expect([...(deps.rows[0]?.attrs ?? [])].sort()).toEqual([f.attrs.amount, f.attrs.priority, f.attrs.stage].sort());
    await expectCode(
      newReport(d.id, {
        reportType: 'insights',
        settings: { primaryMetric: { attributePath: f.path('stage'), field: null, aggregation: 'sum' } },
      }),
      'VALIDATION_ERROR',
    );
    await expectCode(
      newReport(d.id, { reportType: 'funnel', settings: { funnelAttributePath: f.path('amount') } }),
      'VALIDATION_ERROR',
    );
    await expectCode(
      newReport(d.id, { reportType: 'insights', settings: { axisLabelVisible: 'yes' } }),
      'VALIDATION_ERROR',
    );
  });

  it('saves: partial settings merge, a type change resets settings, a source change clears the filter', async () => {
    const d = await newDashboard();
    const { report } = await newReport(d.id, {
      reportType: 'insights',
      filter: { path: f.path('stage'), mode: 'must', constraints: [] },
      settings: { primaryGrouping: { attributePath: f.path('stage') } },
    });
    const merged = await domain.reports.update(f.ctx, {
      reportId: report.id,
      title: 'Deals by stage',
      settings: { targetValue: 300000, zerosVisible: false },
    });
    expect(merged).toMatchObject({
      title: 'Deals by stage',
      visualisationType: 'bar',
      settings: { targetValue: 300000, zerosVisible: false, primaryGrouping: { attributePath: f.path('stage') } },
    });
    const switched = await domain.reports.update(f.ctx, { reportId: report.id, reportType: 'funnel' });
    expect(switched).toMatchObject({
      reportType: 'funnel',
      visualisationType: 'funnel',
      settings: defaultReportSettings('funnel'),
    });
    expect(switched.filter).not.toBeNull();
    const companies = await domain.reports.update(f.ctx, { reportId: report.id, entityDefinitionId: 'companies' });
    expect(companies).toMatchObject({ entityDefinitionId: f.companies, filter: null, entityFilterId: null });
    await expectCode(
      domain.reports.update(f.ctx, { reportId: report.id, settings: { funnelAttributePath: f.path('stage') } }),
      'VALIDATION_ERROR',
    );
  });

  it('duplicates right after the source with its width, and to the end of another dashboard', async () => {
    const d = await newDashboard();
    const a = await newReport(d.id, { reportType: 'insights', width: 4, title: 'A' });
    const b = await newReport(d.id, { reportType: 'insights', width: 4, title: 'B' });
    const copy = await domain.reports.duplicate(f.ctx, {
      reportId: a.report.id,
      newReportId: newId(),
      newCellId: newId(),
    });
    expect(copy.report.title).toBe('A');
    expect(copy.cell.width).toBe(4);
    expect(copy.cell.sortOrder > a.cell.sortOrder && copy.cell.sortOrder < b.cell.sortOrder).toBe(true);
    const target = await newDashboard();
    await newReport(target.id, { reportType: 'insights', title: 'Existing' });
    const moved = await domain.reports.duplicateTo(f.ctx, {
      reportId: b.report.id,
      targetDashboardId: target.id,
      newReportId: newId(),
      newCellId: newId(),
    });
    const t = await domain.dashboards.get(f.ctx, { dashboardId: target.id });
    expect(t.cells.map((c) => [c.report.title, c.width])).toEqual([
      ['Existing', 12],
      ['B', 12],
    ]);
    expect(moved.report.dashboardId).toBe(target.id);
  });
});

describe('layout (12-column grid)', () => {
  it('packs rows greedily, stretching the last cell of every row', () => {
    const rows = packDashboardRows([{ width: 9 }, { width: 4 }, { width: 4 }, { width: 6 }, { width: 3 }]);
    expect(rows.map((r) => r.map((c) => c.renderWidth))).toEqual([[12], [4, 8], [6, 6]]);
  });

  it('saves every cell rank and width in one shuffle and validates it', async () => {
    const d = await newDashboard();
    const cells = [];
    for (let i = 0; i < 3; i++) cells.push((await newReport(d.id, { reportType: 'insights' })).cell);
    const [c1, c2, c3] = cells as [(typeof cells)[number], (typeof cells)[number], (typeof cells)[number]];
    const result = await domain.dashboards.setLayout(f.ctx, {
      dashboardId: d.id,
      cells: [
        { cellId: c3.id, sortOrder: rankBetween(null, c1.sortOrder), width: 4 },
        { cellId: c1.id, sortOrder: c1.sortOrder, width: 2 },
        { cellId: c2.id, sortOrder: c2.sortOrder, width: 40 },
      ],
    });
    expect(result.map((c) => [c.id, c.width])).toEqual([
      [c3.id, 4],
      [c1.id, 4],
      [c2.id, 12],
    ]);
    await expectCode(
      domain.dashboards.setLayout(f.ctx, {
        dashboardId: d.id,
        cells: [{ cellId: c1.id, sortOrder: c1.sortOrder, width: 4 }],
      }),
      'VALIDATION_ERROR',
    );
    await expectCode(
      domain.dashboards.setLayout(f.ctx, {
        dashboardId: d.id,
        cells: [
          { cellId: c1.id, sortOrder: 'k', width: 4 },
          { cellId: c2.id, sortOrder: 'k', width: 4 },
          { cellId: c3.id, sortOrder: 'm', width: 4 },
        ],
      }),
      'VALIDATION_ERROR',
    );
  });

  it('lets the other cells of the row absorb the width of a deleted report', async () => {
    const d = await newDashboard();
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await newReport(d.id, { reportType: 'insights', width: i < 3 ? 4 : 12 }));
    const deleted = await domain.reports.delete(f.ctx, { reportId: r[1]?.report.id as string });
    expect(deleted.cells.map((c) => c.width)).toEqual([6, 6, 12]);
    await expectCode(domain.reports.get(f.ctx, { reportId: r[1]?.report.id as string }), 'NOT_FOUND', 404);
  });
});

describe('permissions', () => {
  it('read only members see but cannot edit; no access hides the dashboard; admins see all in settings', async () => {
    const d = await newDashboard(f.ctx, 'Board');
    const { report } = await newReport(d.id, { reportType: 'insights' });
    const member = await addMember(f);
    await domain.permissions.put(f.ctx, {
      resourceKind: 'dashboard',
      resourceId: d.id,
      target: { type: 'workspace' },
      level: 'read-only',
    });
    const seen = await domain.dashboards.get(member.ctx, { dashboardId: d.id });
    expect(seen.access).toMatchObject({ level: 'read-only', canManagePermissions: false });
    expect(seen.access.flags.update_reporting_dashboard).toBe(false);
    await expectCode(
      domain.reports.create(member.ctx, {
        id: newId(),
        cellId: newId(),
        dashboardId: d.id,
        entityDefinitionId: f.deals,
        reportType: 'insights',
      }),
      'FORBIDDEN',
      403,
    );
    await expectCode(domain.reports.update(member.ctx, { reportId: report.id, title: 'x' }), 'FORBIDDEN', 403);
    await expectCode(domain.dashboards.update(member.ctx, { dashboardId: d.id, title: 'x' }), 'FORBIDDEN', 403);
    await expectCode(domain.dashboards.delete(member.ctx, { dashboardId: d.id }), 'FORBIDDEN', 403);
    const ds = await domain.reporting.reportDataset(member.ctx, { reportId: report.id, timeZone: 'UTC' });
    expect(ds.rows[0]?.value).toBeGreaterThan(0);
    // Duplicate to… a dashboard the member cannot edit.
    const own = await newDashboard(member.ctx, 'Mine');
    await expectCode(
      domain.reports.duplicateTo(member.ctx, {
        reportId: report.id,
        targetDashboardId: d.id,
        newReportId: newId(),
        newCellId: newId(),
      }),
      'FORBIDDEN',
      403,
    );
    const copied = await domain.reports.duplicateTo(member.ctx, {
      reportId: report.id,
      targetDashboardId: own.id,
      newReportId: newId(),
      newCellId: newId(),
    });
    expect(copied.report.dashboardId).toBe(own.id);

    await domain.permissions.put(f.ctx, {
      resourceKind: 'dashboard',
      resourceId: d.id,
      target: { type: 'workspace' },
      level: 'no-access',
    });
    await expectCode(domain.dashboards.get(member.ctx, { dashboardId: d.id }), 'NOT_FOUND', 404);
    await expectCode(domain.reports.get(member.ctx, { reportId: report.id }), 'NOT_FOUND', 404);
    await expectCode(
      domain.reporting.reportDataset(member.ctx, { reportId: report.id, timeZone: 'UTC' }),
      'NOT_FOUND',
      404,
    );
    expect((await domain.dashboards.list(member.ctx)).map((x) => x.id)).not.toContain(d.id);
    await expectCode(domain.dashboards.list(member.ctx, { scope: 'admin' }), 'FORBIDDEN', 403);
    // Without a grant the admin does not see the member's dashboard; in settings they see every dashboard.
    await domain.permissions.put(f.ctx, {
      resourceKind: 'dashboard',
      resourceId: own.id,
      target: { type: 'workspace' },
      level: 'no-access',
    });
    expect((await domain.dashboards.list(f.ctx)).map((x) => x.id)).not.toContain(own.id);
    const admin = await domain.dashboards.list(f.ctx, { scope: 'admin' });
    expect(admin.find((x) => x.id === own.id)?.access.level).toBe('no-access');
    expect((await domain.dashboards.get(f.ctx, { dashboardId: own.id, scope: 'admin' })).cells).toHaveLength(1);
    // A favourite of a dashboard without access shows as a private item.
    await domain.favorites.put(member.ctx, { id: newId(), favoriteType: 'reporting-dashboard', targetId: own.id });
    await domain.permissions.put(f.ctx, {
      resourceKind: 'dashboard',
      resourceId: own.id,
      target: { type: 'member', id: member.memberId },
      level: 'no-access',
    });
    const favs = await domain.favorites.list(member.ctx);
    expect(favs.favorites.find((x) => x.targetId === own.id)?.target.state).toBe('forbidden');
  });

  it('hides reports on lists the viewer cannot read (and their data)', async () => {
    const d = await newDashboard();
    const { list } = await domain.lists.create(f.ctx, {
      name: 'Secret pipeline',
      parentEntityDefinitionIds: [f.deals],
      workspaceAccess: 'no-access',
    });
    const onList = await newReport(d.id, { reportType: 'insights', entityDefinitionId: list.id });
    await newReport(d.id, { reportType: 'insights' });
    const member = await addMember(f, 'Linus');
    const seen = await domain.dashboards.get(member.ctx, { dashboardId: d.id });
    expect(seen.cells).toHaveLength(1);
    expect(seen.hiddenReportCount).toBe(1);
    await expectCode(domain.reports.get(member.ctx, { reportId: onList.report.id }), 'NOT_FOUND', 404);
    await expectCode(
      domain.reporting.dataset(member.ctx, { type: 'pivot', entityDefinitionId: list.id }),
      'FORBIDDEN',
      403,
    );
  });
});

describe('report datasets', () => {
  it('runs a saved report or a draft through datasetQueryForReport', async () => {
    const d = await newDashboard();
    const { report } = await newReport(d.id, {
      reportType: 'insights',
      settings: {
        primaryMetric: { attributePath: f.path('amount'), field: 'raw_value', aggregation: 'sum' },
        primaryGrouping: { attributePath: f.path('stage') },
      },
    });
    const saved = await domain.reporting.reportDataset(f.ctx, { reportId: report.id, timeZone: 'Europe/Moscow' });
    expect(saved.query).toMatchObject({ type: 'pivot', variant: 'insight', timeZone: 'Europe/Moscow' });
    expect(saved.type).toBe('pivot');
    expect(saved.rows.map((r) => ['group' in r ? r.group : null, r.value])).toEqual(
      expect.arrayContaining([
        [f.stages.lead, 10],
        [f.stages.won, 20],
      ]),
    );
    const draft = await domain.reporting.reportDataset(f.ctx, {
      draft: {
        entityDefinitionId: f.deals,
        reportType: 'funnel',
        settings: {
          funnelAttributePath: f.path('stage'),
          funnelSelectedPipelineStageIds: [f.stages.lead, f.stages.won],
        },
      },
      timeZone: 'UTC',
      debug: true,
    });
    expect(draft.type).toBe('funnel');
    expect(draft.rows.map((r) => ('stage' in r ? r.count : null))).toEqual([2, 1]);
    expect(draft.meta.sql?.length).toBeGreaterThan(0);
    const incomplete = await expectCode(
      domain.reporting.reportDataset(f.ctx, {
        draft: { entityDefinitionId: f.deals, reportType: 'time-in-stage' },
        timeZone: 'UTC',
      }),
      'VALIDATION_ERROR',
    );
    expect(incomplete.details).toMatchObject({ reason: 'incomplete-report' });
    await expectCode(domain.reporting.reportDataset(f.ctx, { timeZone: 'UTC' }), 'VALIDATION_ERROR');
  });

  it('reports on list entries with paths to the parent record (list data sources)', async () => {
    const { list } = await domain.lists.create(f.ctx, { name: 'Hot deals', parentEntityDefinitionIds: [f.deals] });
    const confidence = await domain.schema.createAttribute(f.ctx, {
      id: newId(),
      entityDefinitionId: list.id,
      title: 'Confidence',
      type: 'number',
    });
    const deals = await sql<{ id: string }>`
      SELECT instance_id AS id FROM attribute_values WHERE attribute_id = ${f.attrs.name}::uuid AND active_until IS NULL`.execute(
      database.kysely,
    );
    for (const [i, row] of deals.rows.entries()) {
      await domain.entries.add(f.ctx, {
        listId: list.id,
        parentRecords: [{ entityDefinitionId: f.deals, entityInstanceId: row.id }],
        values: { [confidence.id]: [{ value: (i + 1) * 10 }] },
      });
    }
    const parentStage: Path = [
      { entityDefinitionId: list.id, attributeDefinitionId: list.parentRecordAttributeId },
      { entityDefinitionId: f.deals, attributeDefinitionId: f.attrs.stage },
    ];
    const r = await domain.reporting.dataset(f.ctx, {
      type: 'pivot',
      entityDefinitionId: list.id,
      metric: {
        type: 'attribute',
        path: [{ entityDefinitionId: list.id, attributeDefinitionId: confidence.id }],
        aggregation: 'sum',
      },
      primaryGrouping: { path: parentStage },
    });
    expect(r.meta.totalRecords).toBe(2);
    expect(r.rows.reduce((s, x) => s + (x.value ?? 0), 0)).toBe(30);
    expect(r.meta.groups.primary?.map((g) => g.label).sort()).toEqual(['Lead', 'Won']);
    expect(r.freshness.entityDefinitionIds).toEqual([f.deals, list.id].sort());
    const funnel = await domain.reporting.dataset(f.ctx, {
      type: 'funnel',
      entityDefinitionId: list.id,
      statusAttributePath: parentStage,
      stageIds: [f.stages.lead, f.stages.won],
    });
    expect(funnel.rows.map((x) => ('stage' in x ? x.count : null))).toEqual([2, 1]);
  });
});

describe('freshness and report-stale (acceptance 3)', () => {
  it('a stage change in another context invalidates reports depending on the stage', async () => {
    const d = await newDashboard();
    const { report } = await newReport(d.id, {
      reportType: 'insights',
      settings: { primaryGrouping: { attributePath: f.path('stage') } },
    });
    const ds = await domain.reporting.reportDataset(f.ctx, { reportId: report.id, timeZone: 'UTC' });
    const deal = await createDeal(f, { name: 'Fresh', stage: f.stages.lead });
    let since = await lastChangeId(f.workspaceId);
    expect(BigInt(ds.freshness.seq) < BigInt(since)).toBe(true);
    expect(ds.freshness.entityDefinitionIds).toEqual([f.deals]);
    expect(ds.freshness.attributeDefinitionIds).toEqual([f.attrs.stage]);

    // Another member moves the deal (another tab / context).
    const other = await addMember(f, 'Tim');
    await domain.values.put(other.ctx, {
      entityDefinitionId: f.deals,
      entityInstanceId: deal,
      attributeDefinitionId: f.attrs.stage,
      attributeValueId: newId(),
      value: { pipelineStageId: f.stages.qualified },
    });
    let stale = (await changeRows(f.workspaceId, since)).filter((r) => r.resource === 'report-stale');
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({
      resource_id: f.deals,
      scope: { entityDefinitionId: f.deals, attributeDefinitionIds: [f.attrs.stage] },
      audience: null,
    });
    expect(BigInt(stale[0]?.id as string) > BigInt(ds.freshness.seq)).toBe(true);

    // An attribute no report reads: no invalidation.
    since = await lastChangeId(f.workspaceId);
    await domain.values.put(other.ctx, {
      entityDefinitionId: f.deals,
      entityInstanceId: deal,
      attributeDefinitionId: f.attrs.score,
      attributeValueId: newId(),
      value: 7,
    });
    stale = (await changeRows(f.workspaceId, since)).filter((r) => r.resource === 'report-stale');
    expect(stale).toEqual([]);

    // Records added: every report over the definition (attributeDefinitionIds null).
    since = await lastChangeId(f.workspaceId);
    await createDeal(f, { name: 'Another' });
    stale = (await changeRows(f.workspaceId, since)).filter((r) => r.resource === 'report-stale');
    expect(stale.map((r) => r.scope)).toEqual([{ entityDefinitionId: f.deals, attributeDefinitionIds: null }]);

    // Stage renamed (definition change).
    since = await lastChangeId(f.workspaceId);
    await domain.schema.updateStage(f.ctx, {
      entityDefinitionId: f.deals,
      attributeDefinitionId: f.attrs.stage,
      pipelineStageId: f.stages.lost,
      title: 'Closed lost',
    });
    stale = (await changeRows(f.workspaceId, since)).filter((r) => r.resource === 'report-stale');
    expect(stale.map((r) => r.scope)).toEqual([
      { entityDefinitionId: f.deals, attributeDefinitionIds: [f.attrs.stage] },
    ]);

    // People: no report depends on them.
    since = await lastChangeId(f.workspaceId);
    await createRecord(f, 'people', { name: [{ value: { firstName: 'No', lastName: 'Report' } }] });
    stale = (await changeRows(f.workspaceId, since)).filter((r) => r.resource === 'report-stale');
    expect(stale).toEqual([]);

    // Structure changes invalidate the dashboard's cells and the index.
    since = await lastChangeId(f.workspaceId);
    await domain.reports.update(f.ctx, { reportId: report.id, title: 'Renamed' });
    const rows = await changeRows(f.workspaceId, since);
    expect(rows.map((r) => r.resource).sort()).toEqual(['reporting-dashboard-cells', 'reporting-dashboard-list']);
    expect(rows.find((r) => r.resource === 'reporting-dashboard-cells')).toMatchObject({
      resource_id: d.id,
      scope: { dashboardId: d.id, reportIds: [report.id], cellIds: [report.cellId] },
    });
  });
});
