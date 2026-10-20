// reporting.dataset (BACKLOG 9.04; H api §4): one entry point for every chart. Validates the query, checks read
// access to the data source and every object a path reaches, resolves the filter's dynamic values in the viewer's
// zone, runs the query type and answers rows + meta (labels, buckets, plan, timings) + a freshness token.
import {
  type DatasetGroupInfo,
  type DatasetInput,
  type DatasetMeta,
  type DatasetOutput,
  type DatasetQuery,
  datasetInputSchema,
  datasetQueryForReport,
  IncompleteReportError,
  normaliseVisualisation,
  type Path,
  type ReportDatasetInput,
  type ReportSettings,
  reportDatasetInputSchema,
  reportDraftSchema,
  weekStartForLocale,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { actingMemberId } from '../../context.ts';
import { badRequest } from '../../errors.ts';
import type { Policies } from '../../permissions.ts';
import { localDate } from '../../time.ts';
import type { Tx } from '../../tx.ts';
import { assertTimeZone, hasHistoryLeaf, resolvePredicate } from '../../views/resolve.ts';
import { loadSource, validateSettings } from '../model.ts';
import { freshnessSeq } from '../stale.ts';
import { QueryContext } from './context.ts';
import { runHistorical } from './historical.ts';
import { type PivotResult, runInsight } from './insight.ts';
import { bucketInfos, groupInfos, optionInfos } from './labels.ts';
import { runFunnel, runStageChanged, runTimeInStage } from './stages.ts';

export interface DatasetDeps {
  policies: Policies;
}

/** The viewer's week start: explicit, else the member's preference, else their locale's, else Monday (X-10). */
async function weekStartOf(tx: Tx, explicit: number | undefined): Promise<number> {
  if (explicit !== undefined) return explicit;
  const memberId = actingMemberId(tx.ctx);
  if (!memberId) return 1;
  const row = await tx.db
    .selectFrom('member_preferences')
    .select(['week_start_day', 'locale'])
    .where('member_id', '=', memberId)
    .executeTakeFirst();
  if (row?.week_start_day !== null && row?.week_start_day !== undefined) return row.week_start_day;
  return weekStartForLocale(row?.locale ?? null);
}

async function pivotMeta(tx: Tx, r: PivotResult, variant: string): Promise<DatasetMeta['groups']> {
  const groupKeys = r.rows.map((x) => x.group).concat((r.comparisonRows ?? []).map((x) => x.group));
  const segmentKeys = r.rows.map((x) => x.segment);
  if (variant === 'insight') {
    return {
      primary: r.groups.primary ? await groupInfos(tx, r.groups.primary, groupKeys, r.samples?.[0]) : null,
      secondary: r.groups.secondary ? await groupInfos(tx, r.groups.secondary, segmentKeys, r.samples?.[1]) : null,
    };
  }
  // Time pivots: rows.group = bucket; rows.segment = the segment (historical) or the stage (stage changed).
  let secondary: DatasetGroupInfo[] | null = null;
  if (r.stageAttr) secondary = await optionInfos(tx, r.stageAttr, segmentKeys);
  else if (r.groups.primary) secondary = await groupInfos(tx, r.groups.primary, segmentKeys);
  return {
    primary: bucketInfos([...(r.buckets ?? []), ...groupKeys.filter((k): k is string => k !== null)]),
    secondary,
  };
}

/** Attribute paths of a query besides its filter (metric, groupings, status attribute). */
function queryPaths(q: DatasetQuery): Path[] {
  const paths: (Path | null | undefined)[] = [];
  if (q.type === 'pivot') {
    paths.push(
      q.metric.type === 'attribute' ? q.metric.path : null,
      q.primaryGrouping?.path,
      q.secondaryGrouping?.path,
    );
    paths.push(q.statusAttributePath);
  } else if (q.type === 'time-in-stage') {
    paths.push(q.statusAttributePath, q.primaryGrouping?.path);
  } else {
    paths.push(q.statusAttributePath, q.metric?.type === 'attribute' ? q.metric.path : null);
  }
  return paths.filter((p): p is Path => Array.isArray(p) && p.length > 0);
}

/** Runs one dataset query in the caller's transaction (read access checked here). */
export async function runDataset(tx: Tx, deps: DatasetDeps, input: DatasetInput): Promise<DatasetOutput> {
  const started = performance.now();
  const q: DatasetQuery = datasetInputSchema.parse(input);
  assertTimeZone(q.timeZone);
  const def = await loadSource(tx, q.entityDefinitionId);
  await deps.policies.assertCan(tx, def.id, 'read_entity_instance');
  const weekStart = await weekStartOf(tx, q.weekStart);
  const filter = await resolvePredicate(tx, def, q.filter, {
    now: tx.now,
    timeZone: q.timeZone,
    memberId: actingMemberId(tx.ctx),
  }).catch((err) => {
    if ((err as { code?: string }).code === 'UNSUPPORTED_FILTER') {
      throw badRequest('VALIDATION_ERROR', (err as Error).message);
    }
    throw err;
  });
  const ctx = new QueryContext(tx, def, filter, q.timeZone, weekStart);
  // Every object a path reaches must be readable by the caller (values of related records).
  for (const path of queryPaths(q)) ctx.track(path);
  for (const defId of ctx.defIds) {
    if (defId !== def.id) await deps.policies.assertCan(tx, defId, 'read_attribute_value');
  }
  // Reporting scans sort and hash a lot; history filters read the EAV (S1 rule 7: hash joins, no nested loops).
  await sql`SET LOCAL work_mem = '64MB'`.execute(tx.db);
  if (hasHistoryLeaf(filter)) await sql`SET LOCAL enable_nestloop = off`.execute(tx.db);

  let out: Record<string, unknown>;
  let groups: DatasetMeta['groups'] = { primary: null, secondary: null };
  let resolution: DatasetMeta['resolution'] = null;
  let buckets: string[] | null = null;
  let comparisonBuckets: string[] | null = null;
  switch (q.type) {
    case 'pivot': {
      const r =
        q.variant === 'historical'
          ? await runHistorical(ctx, q)
          : q.variant === 'stage-changed'
            ? await runStageChanged(ctx, q)
            : await runInsight(ctx, q);
      groups = await pivotMeta(tx, r, q.variant);
      resolution = r.resolution;
      buckets = r.buckets;
      comparisonBuckets = r.comparisonBuckets;
      out = { type: 'pivot', variant: q.variant, rows: r.rows, comparisonRows: r.comparisonRows };
      break;
    }
    case 'funnel':
    case 'funnel-metric': {
      const r = await runFunnel(ctx, q);
      groups = {
        primary: await optionInfos(
          tx,
          r.stageAttr,
          r.rows.map((x) => x.stage),
        ),
        secondary: null,
      };
      out = { type: q.type, rows: r.rows, summary: r.summary };
      break;
    }
    case 'time-in-stage': {
      const group = q.primaryGrouping ? await ctx.grouping(q.primaryGrouping, 'month') : null;
      const r = await runTimeInStage(ctx, q, group);
      groups = {
        primary: await optionInfos(
          tx,
          r.stageAttr,
          r.rows.map((x) => x.stage),
        ),
        secondary: group
          ? await groupInfos(
              tx,
              group,
              r.rows.map((x) => x.group),
            )
          : null,
      };
      out = { type: 'time-in-stage', rows: r.rows };
      break;
    }
  }
  const totalRecords = await ctx.totalRecords();
  const meta: DatasetMeta = {
    entityDefinitionId: def.id,
    timeZone: q.timeZone,
    weekStart,
    resolution,
    buckets,
    comparisonBuckets,
    groups,
    totalRecords,
    truncated: ctx.truncated,
    plan: ctx.plan,
    ...(q.debug ? { sql: ctx.sqls } : {}),
    durationMs: Math.round((performance.now() - started) * 10) / 10,
  };
  const freshness = {
    accurateAt: tx.now,
    seq: await freshnessSeq(tx),
    entityDefinitionIds: [...ctx.defIds].sort(),
    attributeDefinitionIds: [...ctx.attrIds].sort(),
  };
  return { ...out, meta, freshness } as DatasetOutput;
}

/** A saved report (dashboard read access + data source access) or an unsaved draft, compiled and run. */
export async function runReportDataset(
  tx: Tx,
  deps: DatasetDeps,
  input: ReportDatasetInput,
  loadSaved: (
    tx: Tx,
    reportId: string,
  ) => Promise<{
    entityDefinitionId: string;
    filter: DatasetQuery['filter'];
    reportType: DatasetQueryReportType;
    visualisationType: ReturnType<typeof normaliseVisualisation> | null;
    settings: ReportSettings;
  }>,
): Promise<DatasetOutput & { query: DatasetQuery }> {
  const data = reportDatasetInputSchema.parse(input);
  if (Boolean(data.reportId) === Boolean(data.draft)) {
    throw badRequest('VALIDATION_ERROR', 'Pass either reportId or draft');
  }
  assertTimeZone(data.timeZone);
  let report: Awaited<ReturnType<typeof loadSaved>>;
  if (data.reportId) report = await loadSaved(tx, data.reportId);
  else {
    const draft = reportDraftSchema.parse(data.draft);
    const def = await loadSource(tx, draft.entityDefinitionId);
    const settings = await validateSettings(tx, def, draft.reportType, draft.settings);
    report = {
      entityDefinitionId: def.id,
      filter: draft.filter,
      reportType: draft.reportType,
      visualisationType: normaliseVisualisation(draft.reportType, settings, draft.visualisationType ?? null),
      settings,
    };
  }
  const weekStart = await weekStartOf(tx, data.weekStart);
  let query: DatasetQuery;
  try {
    query = datasetQueryForReport(report, {
      today: localDate(tx.now, data.timeZone),
      weekStart,
      timeZone: data.timeZone,
    });
  } catch (err) {
    if (err instanceof IncompleteReportError) {
      throw badRequest('VALIDATION_ERROR', err.message, { reason: 'incomplete-report' });
    }
    throw err;
  }
  const result = await runDataset(tx, deps, { ...query, ...(data.debug ? { debug: true } : {}) });
  return { ...result, query };
}

type DatasetQueryReportType = Parameters<typeof datasetQueryForReport>[0]['reportType'];
