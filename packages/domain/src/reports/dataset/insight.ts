// Insight pivot (H api §4.1, builder §3): metric over the current values of the records matching the filter, grouped
// by up to two attributes (multi-value attributes put a record in every group of its values; records without a value
// form the null group). Compiles to one GROUP BY over the projection (S1 rule 1).
import {
  bucketStartOf,
  bucketsBetween,
  type DatasetTimeConfig,
  type PivotQuery,
  type PivotRow,
  type TimeResolution,
} from '@agentic-crm/contracts';
import type { AttrDef } from '../../schema/model.ts';
import { alignRows, type GroupSpec, invalidQuery, lit, MAX_GROUPS, num, QueryContext } from './context.ts';

export interface PivotResult {
  rows: PivotRow[];
  comparisonRows: PivotRow[] | null;
  groups: { primary: GroupSpec | null; secondary: GroupSpec | null };
  resolution: TimeResolution | null;
  buckets: string[] | null;
  comparisonBuckets: string[] | null;
  /** Stage changed: the status attribute (its stages label the segments). */
  stageAttr?: AttrDef;
  /** Text groupings: key → a record holding the value (labels). */
  samples?: Map<string, string>[];
}

interface Built {
  from: string[];
  key: string;
  conds: string[];
}

/** FROM additions, key expression and WHERE conditions of one grouping. */
function groupSql(ctx: QueryContext, spec: GroupSpec, window: { start: string | null; end: string | null }): Built {
  const from = [...spec.joins];
  let raw = spec.ref;
  if (spec.multi) {
    const u = ctx.alias('u');
    from.push(`LEFT JOIN LATERAL unnest(${spec.ref}) AS ${u}(v) ON true`);
    raw = `${u}.v`;
  }
  const key = spec.key(raw);
  const conds: string[] = [];
  if (!spec.grouping.includeNullGroup) conds.push(`${key} IS NOT NULL`);
  const selected = ctx.selectedKeys(spec);
  if (selected) conds.push(`(${key} IS NULL OR ${key} IN (${selected.join(', ')}))`);
  if (spec.temporal && (window.start || window.end)) {
    // Range of a date grouping: records whose bucket falls inside it (records without a date stay in the null group).
    const lo = window.start ? `${key} >= ${lit.str(window.start)}` : null;
    const hi = window.end ? `${key} <= ${lit.str(window.end)}` : null;
    conds.push(`(${key} IS NULL OR (${[lo, hi].filter(Boolean).join(' AND ')}))`);
  }
  return { from, key, conds };
}

async function query(
  ctx: QueryContext,
  primary: GroupSpec | null,
  secondary: GroupSpec | null,
  metric: Awaited<ReturnType<QueryContext['metric']>>,
  window: { start: string | null; end: string | null },
  resolution: TimeResolution,
  samples?: Map<string, string>[],
): Promise<PivotRow[]> {
  const from = [`${ctx.table} p`, ...(metric.path?.joins ?? [])];
  const where = [await ctx.where()];
  const keys: string[] = [];
  const sampleCols: string[] = [];
  for (const spec of [primary, secondary]) {
    // Text groups carry one record holding the value: labels show its original spelling (labels.ts).
    sampleCols.push(spec?.kind === 'text' ? `min(${spec.instance}::text)` : 'NULL::text');
    if (!spec) {
      keys.push('NULL::text');
      continue;
    }
    // Bucket bounds are compared as 'YYYY-MM-DD' keys of the same resolution.
    const bounded = {
      start: window.start ? bucketStartOf(window.start, resolution, ctx.weekStart) : null,
      end: window.end ? bucketStartOf(window.end, resolution, ctx.weekStart) : null,
    };
    const g = groupSql(ctx, spec, bounded);
    from.push(...g.from);
    where.push(...g.conds);
    keys.push(g.key);
  }
  const limit = MAX_GROUPS * (secondary ? 20 : 1);
  const text = `SELECT ${keys[0]} AS g1, ${keys[1]} AS g2, count(*) AS n, ${ctx.aggregate(metric)} AS value,
      ${sampleCols[0]} AS s1, ${sampleCols[1]} AS s2
    FROM ${[...new Set(from)].join(' ')}
    WHERE ${where.join(' AND ')}
    GROUP BY 1, 2
    ORDER BY count(*) DESC, 1, 2
    LIMIT ${limit + 1}`;
  const all = await ctx.run<{
    g1: string | null;
    g2: string | null;
    n: string;
    value: string | null;
    s1: string | null;
    s2: string | null;
  }>(text);
  // Too many groups (e.g. text values): keep the largest ones and say so.
  if (all.length > limit) ctx.truncated = true;
  const rows = all.slice(0, limit);
  for (const r of rows) {
    if (r.g1 !== null && r.s1 !== null) samples?.[0]?.set(r.g1, r.s1);
    if (r.g2 !== null && r.s2 !== null) samples?.[1]?.set(r.g2, r.s2);
  }
  return rows.map((r) => {
    const n = Number(r.n);
    let value = num(r.value);
    if (metric.metric.type === 'attribute' && metric.metric.aggregation === 'sum' && value === null) value = 0;
    if (metric.metric.type === 'record-count') value = n;
    return { group: r.g1, segment: r.g2, value, count: n };
  });
}

export async function runInsight(ctx: QueryContext, q: PivotQuery): Promise<PivotResult> {
  const resolution: TimeResolution = q.timeConfig?.resolution ?? 'month';
  const metric = await ctx.metric(q.metric);
  const primary = q.primaryGrouping ? await ctx.grouping(q.primaryGrouping, resolution) : null;
  if (!primary && q.secondaryGrouping) throw invalidQuery('"Segment by" needs a "Group by" attribute');
  const secondary = q.secondaryGrouping ? await ctx.grouping(q.secondaryGrouping, resolution) : null;
  const tc: DatasetTimeConfig | null = q.timeConfig;
  const temporal = Boolean(primary?.temporal || secondary?.temporal);
  ctx.step('LookUp', `records of ${ctx.def.pluralNoun} (projection ${ctx.def.projectionTable}), current values`);
  if (ctx.filter) ctx.step('FilterSet', 'report filter on current values (semi-join on record id)');
  if (metric.path) ctx.step('Join', `metric "${metric.path.attr.title}" via ${metric.path.joins.length} hop join(s)`);
  for (const g of [primary, secondary]) {
    if (!g) continue;
    ctx.step(
      g.temporal ? 'AddKey' : 'Group',
      g.temporal
        ? `StartOfDateInterval("${g.attr.title}", ${resolution}, ${g.kind === 'timestamp' ? ctx.timeZone : 'no zone'}, week start ${ctx.weekStart})`
        : `by "${g.attr.title}"${g.multi ? ' (unwound: one row per value)' : ''}`,
    );
  }
  ctx.step('Aggregation', describeMetric(metric.metric));
  const window = { start: tc?.start ?? null, end: tc?.end ?? null };
  const samples = [new Map<string, string>(), new Map<string, string>()];
  const rows = await query(ctx, primary, secondary, metric, window, resolution, samples);
  let comparisonRows: PivotRow[] | null = null;
  let buckets: string[] | null = null;
  let comparisonBuckets: string[] | null = null;
  if (temporal) {
    const keys = rows
      .flatMap((r) => [primary?.temporal ? r.group : null, secondary?.temporal ? r.segment : null])
      .filter((x): x is string => x !== null)
      .sort();
    const start = window.start ?? keys[0] ?? null;
    const end = window.end ?? keys[keys.length - 1] ?? null;
    buckets = start && end ? bucketsBetween(start, end, resolution, ctx.weekStart) : [];
    if (tc?.comparison && primary?.temporal) {
      comparisonBuckets = bucketsBetween(tc.comparison.start, tc.comparison.end, resolution, ctx.weekStart);
      const prev = await query(ctx, primary, secondary, metric, tc.comparison, resolution);
      comparisonRows = alignRows(prev, comparisonBuckets, buckets ?? []);
      ctx.step('Parallel', `comparison window ${tc.comparison.start} – ${tc.comparison.end}, aligned by bucket index`);
    }
  }
  const counts = metric.metric.type === 'record-count';
  // Options / stages without records ("show empty groups", builder §6 empty_groups_visible).
  let options: string[] | null = null;
  if (
    primary &&
    !primary.temporal &&
    primary.grouping.includeEmptyGroups &&
    primary.kind === 'uuid' &&
    (primary.attr.type === 'pipeline' || primary.attr.type === 'select')
  ) {
    const rowsOf = await ctx.tx.db
      .selectFrom('select_options')
      .select('id')
      .where('attribute_id', '=', primary.attr.id)
      .where('is_archived', '=', false)
      .orderBy('sort_order')
      .execute();
    const selected = primary.grouping.selectedValues?.map((v) => v.toLowerCase()) ?? null;
    options = rowsOf.map((r) => r.id).filter((id) => !selected || selected.includes(id));
  }
  return {
    rows: fillEmpty(rows, primary, options ?? buckets, counts),
    comparisonRows,
    groups: { primary, secondary },
    samples,
    resolution: temporal ? resolution : null,
    buckets,
    comparisonBuckets,
  };
}

/**
 * With includeEmptyGroups, every time bucket of the window (date groupings) or every option / stage (select and status
 * groupings) without records gets a zero row.
 */
function fillEmpty(rows: PivotRow[], primary: GroupSpec | null, keys: string[] | null, counts: boolean): PivotRow[] {
  if (!primary || !primary.grouping.includeEmptyGroups || !keys) return rows;
  const have = new Set(rows.map((r) => r.group));
  const extra = keys
    .filter((b) => !have.has(b))
    .map((b) => ({ group: b, segment: null, value: counts ? 0 : null, count: 0 }));
  return [...rows, ...extra];
}

export function describeMetric(m: PivotQuery['metric']): string {
  if (m.type === 'record-count') return 'count of records (aggregation_type 1)';
  const codes = { count: 1, sum: 2, mean: 3, min: 4, max: 5, median: 6 } as const;
  return `${m.aggregation} (aggregation_type ${codes[m.aggregation]}) of the metric attribute`;
}
