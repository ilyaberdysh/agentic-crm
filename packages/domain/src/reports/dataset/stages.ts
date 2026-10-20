// Status-history reports (H api §4.1 stage changed, §4.2 funnel / funnel metric, §4.3 time in stage; builder §8–10).
// All read every value row of the status attribute (current and retired, I6) through av_report_hist, joined to the
// records matching the filter. A status path may traverse record references (a list entry's parent record, a deal's
// company): the status history of the referenced record is used for each source record.
import {
  bucketsBetween,
  type FunnelQuery,
  type FunnelRow,
  type PivotQuery,
  type PivotRow,
  type TimeInStageQuery,
  type TimeInStageRow,
} from '@agentic-crm/contracts';
import type { AttrDef } from '../../schema/model.ts';
import { localDate } from '../../time.ts';
import {
  alignRows,
  type GroupSpec,
  invalidQuery,
  lit,
  MAX_BUCKETS,
  type MetricSpec,
  num,
  QueryContext,
} from './context.ts';
import { describeMetric, type PivotResult } from './insight.ts';

/** Every stage/option of the attribute in its order (archived ones included: history may hold them). */
async function stagesOf(ctx: QueryContext, attr: AttrDef): Promise<{ id: string; ord: number }[]> {
  const rows = await ctx.tx.db
    .selectFrom('select_options')
    .select(['id'])
    .where('attribute_id', '=', attr.id)
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
  return rows.map((r, i) => ({ id: r.id, ord: i }));
}

function assertStages(all: { id: string }[], selected: string[] | null, attr: AttrDef): void {
  if (!selected) return;
  const known = new Set(all.map((s) => s.id));
  const unknown = selected.filter((s) => !known.has(s.toLowerCase()));
  if (unknown.length > 0) {
    throw invalidQuery(`Unknown stages of "${attr.title}"`, { attribute_definition_id: attr.id, stage_ids: unknown });
  }
}

/** Base CTE: records matching the filter, the instance holding the status, the current metric / group values. */
async function base(
  ctx: QueryContext,
  subject: { joins: string[]; instance: string },
  metric: MetricSpec | null,
  group: GroupSpec | null,
): Promise<string> {
  const from = [`${ctx.table} p`, ...subject.joins];
  const cols = ['p.instance_id AS id', `${subject.instance} AS sid`];
  if (metric?.path) {
    from.push(...metric.path.joins);
    const p = metric.path;
    const m = metric.metric;
    cols.push(
      m.type === 'attribute' && m.aggregation === 'count'
        ? `CASE WHEN ${p.multi ? `${p.ref} IS NOT NULL` : p.kind === 'rating' ? `${p.ref} >= 1` : `${p.ref} IS NOT NULL`} THEN 1 END AS cm`
        : `${metric.value} AS cm`,
    );
  }
  if (group) {
    from.push(...group.joins);
    cols.push(`${group.ref} AS cg`);
  }
  return `base AS MATERIALIZED (SELECT ${cols.join(', ')} FROM ${[...new Set(from)].join(' ')} WHERE ${await ctx.where()})`;
}

/** Aggregate SQL over the base's current metric column `cm` (record counts: count(*)). */
function metricAgg(metric: MetricSpec): string {
  const m = metric.metric;
  if (m.type === 'record-count') return 'count(*)';
  switch (m.aggregation) {
    case 'count':
      return 'count(cm)';
    case 'sum':
      return 'coalesce(sum(cm), 0)';
    case 'mean':
      return 'avg(cm)';
    case 'min':
      return 'min(cm)';
    case 'max':
      return 'max(cm)';
    case 'median':
      return 'percentile_cont(0.5) WITHIN GROUP (ORDER BY cm)';
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Stage changed: (bucket of active_from, stage) → metric over the status values that started in the bucket.

export async function runStageChanged(ctx: QueryContext, q: PivotQuery): Promise<PivotResult> {
  if (!q.statusAttributePath) throw invalidQuery('Stage changed reports need a status attribute');
  const tc = q.timeConfig ?? { resolution: 'month' as const, start: null, end: null, comparison: null };
  const resolution = tc.resolution;
  const subject = await ctx.statusSubject(q.statusAttributePath);
  const stages = await stagesOf(ctx, subject.attr);
  assertStages(stages, q.selectedStageIds, subject.attr);
  const metric = await ctx.metric(q.metric);
  ctx.step('LookUp', `records of ${ctx.def.pluralNoun} (projection ${ctx.def.projectionTable})`);
  if (ctx.filter) ctx.step('FilterSet', 'report filter on current values (semi-join on record id)');
  ctx.step('LookUp', `value history of "${subject.attr.title}" (attribute-value: v_ref, active_from)`);
  ctx.step('AddKey', `StartOfDateInterval(active_from, ${resolution}, ${ctx.timeZone}, week start ${ctx.weekStart})`);
  ctx.step('Group', `by bucket, stage; ${describeMetric(metric.metric)}`);
  const baseCte = await base(ctx, subject, metric, null);

  const window = async (range: { start: string | null; end: string | null }): Promise<PivotRow[]> => {
    const conds = [`h.attribute_id = ${lit.uuid(subject.attr.id)}`, 'h.v_ref IS NOT NULL'];
    if (range.start) conds.push(`h.active_from >= ${ctx.instantOf(range.start)}`);
    if (range.end) conds.push(`h.active_from < ${ctx.instantOf(QueryContext.nextBucket(range.end, 'day'))}`);
    if (q.selectedStageIds) conds.push(`h.v_ref IN (${q.selectedStageIds.map((s) => lit.uuid(s)).join(', ')})`);
    const rows = await ctx.run<{ b: string; stage: string; n: string; value: string | null }>(
      `WITH ${baseCte}
       SELECT to_char(${ctx.bucketOf('h.active_from', resolution)}, 'YYYY-MM-DD') AS b, h.v_ref::text AS stage,
              count(*) AS n, ${metricAgg(metric)} AS value
       FROM attribute_values h JOIN base ON base.sid = h.instance_id
       WHERE ${conds.join(' AND ')}
       GROUP BY 1, 2`,
    );
    return rows.map((r) => ({
      group: r.b,
      segment: r.stage,
      value: metric.metric.type === 'record-count' ? Number(r.n) : num(r.value),
      count: Number(r.n),
    }));
  };

  const rows = await window(tc);
  const span = (rs: PivotRow[], range: { start: string | null; end: string | null }) => {
    const keys = rs.map((r) => r.group as string).sort();
    const today = localDate(ctx.tx.now, ctx.timeZone);
    const start = range.start ?? keys[0] ?? null;
    const end = range.end ?? (keys.length ? today : null);
    if (!start || !end) return [];
    const b = bucketsBetween(start, end, resolution, ctx.weekStart);
    if (b.length > MAX_BUCKETS) throw invalidQuery(`Too many time buckets (${b.length})`);
    return b;
  };
  const buckets = span(rows, tc);
  let comparisonRows: PivotRow[] | null = null;
  let comparisonBuckets: string[] | null = null;
  if (tc.comparison) {
    const prev = await window(tc.comparison);
    comparisonBuckets = span(prev, tc.comparison);
    comparisonRows = alignRows(prev, comparisonBuckets, buckets);
  }
  return {
    rows,
    comparisonRows,
    groups: { primary: null, secondary: null },
    resolution,
    buckets,
    comparisonBuckets,
    stageAttr: subject.attr,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Funnel: records that reached or passed each stage (non-strict progression over the attribute's stage order).

export async function runFunnel(
  ctx: QueryContext,
  q: FunnelQuery,
): Promise<{
  rows: FunnelRow[];
  summary: {
    steps: { from: string | null; to: string; conversion: number | null }[];
    overallConversion: number | null;
  } | null;
  stageAttr: AttrDef;
}> {
  const subject = await ctx.statusSubject(q.statusAttributePath);
  const stages = await stagesOf(ctx, subject.attr);
  const selected = [...new Set(q.stageIds.map((s) => s.toLowerCase()))];
  assertStages(stages, selected, subject.attr);
  const ord = new Map(stages.map((s) => [s.id, s.ord]));
  const steps = selected.sort((a, b) => (ord.get(a) as number) - (ord.get(b) as number));
  const metric = q.metric ? await ctx.metric(q.metric) : await ctx.metric({ type: 'record-count' });
  const m = metric.metric;
  ctx.step('LookUp', `records of ${ctx.def.pluralNoun} (projection ${ctx.def.projectionTable})`);
  if (ctx.filter) ctx.step('FilterSet', 'report filter on current values (semi-join on record id)');
  ctx.step('LookUp', `every value of "${subject.attr.title}" (current and retired)`);
  ctx.step(
    'Funnel',
    `steps [${steps.join(', ')}], step_key v, identifier_key i, include_all_identifiers_step ${q.includeAllRecords}, strict_stage_progression false`,
  );
  if (metric.path) ctx.step('Aggregation', `${describeMetric(m)} over current values`);
  const baseCte = await base(ctx, subject, metric, null);
  const pos = `(VALUES ${stages.map((s) => `(${lit.uuid(s.id)}, ${s.ord})`).join(', ')}) AS pos(stage, ord)`;
  const reach = `reach AS (
      SELECT base.id, max(pos.ord) AS mo
      FROM base JOIN attribute_values h ON h.instance_id = base.sid
        AND h.attribute_id = ${lit.uuid(subject.attr.id)} AND h.v_ref IS NOT NULL
      JOIN ${pos} ON pos.stage = h.v_ref
      GROUP BY base.id)`;
  const valueCols = metric.path ? ', sum(cm) AS sv, count(cm) AS nv, min(cm) AS mn, max(cm) AS mx' : '';
  type Agg = { n: string; sv?: string | null; nv?: string; mn?: string | null; mx?: string | null };
  const byOrd = stages.length
    ? await ctx.run<Agg & { mo: number }>(
        `WITH ${baseCte}, ${reach}
         SELECT reach.mo, count(*) AS n${valueCols} FROM reach JOIN base ON base.id = reach.id GROUP BY reach.mo`,
      )
    : [];
  const all = (await ctx.run<Agg>(`WITH ${baseCte} SELECT count(*) AS n${valueCols} FROM base`))[0] as Agg;
  let medians: Map<string | null, number | null> | null = null;
  if (m.type === 'attribute' && m.aggregation === 'median') {
    const stepRows = `(VALUES ${steps.map((s) => `(${lit.uuid(s)}, ${ord.get(s)})`).join(', ')}) AS st(stage, ord)`;
    const rows = await ctx.run<{ stage: string; value: string | null }>(
      `WITH ${baseCte}, ${reach}
       SELECT st.stage::text AS stage, percentile_cont(0.5) WITHIN GROUP (ORDER BY base.cm) AS value
       FROM ${stepRows} JOIN reach ON reach.mo >= st.ord JOIN base ON base.id = reach.id GROUP BY st.stage`,
    );
    const allMedian = await ctx.run<{ value: string | null }>(
      `WITH ${baseCte} SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY cm) AS value FROM base`,
    );
    medians = new Map<string | null, number | null>(rows.map((r) => [r.stage, num(r.value)]));
    medians.set(null, num(allMedian[0]?.value));
  }
  const valueOf = (
    stage: string | null,
    a: { n: number; sv: number; nv: number; mn: number | null; mx: number | null },
  ) => {
    if (m.type === 'record-count') return a.n;
    switch (m.aggregation) {
      case 'count':
        return a.nv;
      case 'sum':
        return a.sv;
      case 'mean':
        return a.nv > 0 ? a.sv / a.nv : null;
      case 'min':
        return a.mn;
      case 'max':
        return a.mx;
      case 'median':
        return medians?.get(stage) ?? null;
    }
  };
  const cumulative = (fromOrd: number) => {
    const acc = { n: 0, sv: 0, nv: 0, mn: null as number | null, mx: null as number | null };
    for (const r of byOrd) {
      if (Number(r.mo) < fromOrd) continue;
      acc.n += Number(r.n);
      acc.sv += Number(r.sv ?? 0);
      acc.nv += Number(r.nv ?? 0);
      const mn = num(r.mn);
      const mx = num(r.mx);
      if (mn !== null) acc.mn = acc.mn === null ? mn : Math.min(acc.mn, mn);
      if (mx !== null) acc.mx = acc.mx === null ? mx : Math.max(acc.mx, mx);
    }
    return acc;
  };
  const rows: FunnelRow[] = [];
  if (q.includeAllRecords) {
    const a = { n: Number(all.n), sv: Number(all.sv ?? 0), nv: Number(all.nv ?? 0), mn: num(all.mn), mx: num(all.mx) };
    rows.push({
      stage: null,
      count: a.n,
      value: valueOf(null, a),
      conversionFromPrevious: null,
      conversionFromFirst: null,
    });
  }
  for (const s of steps) {
    const a = cumulative(ord.get(s) as number);
    rows.push({ stage: s, count: a.n, value: valueOf(s, a), conversionFromPrevious: null, conversionFromFirst: null });
  }
  const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
  const first = rows[0]?.value ?? null;
  rows.forEach((r, i) => {
    if (i === 0) return;
    r.conversionFromPrevious = ratio(r.value, rows[i - 1]?.value ?? null);
    r.conversionFromFirst = ratio(r.value, first);
  });
  const summary =
    q.type === 'funnel-metric'
      ? {
          steps: rows.slice(1).map((r, i) => ({
            from: rows[i]?.stage ?? null,
            to: r.stage as string,
            conversion: r.conversionFromPrevious,
          })),
          overallConversion: rows.length > 1 ? ratio(rows[rows.length - 1]?.value ?? null, first) : null,
        }
      : null;
  return { rows, summary, stageAttr: subject.attr };
}

// ---------------------------------------------------------------------------------------------------------------
// Time in stage: durations of the status values (stays), per stage and group.

export async function runTimeInStage(
  ctx: QueryContext,
  q: TimeInStageQuery,
  group: GroupSpec | null,
): Promise<{ rows: TimeInStageRow[]; stageAttr: AttrDef }> {
  const subject = await ctx.statusSubject(q.statusAttributePath);
  const stages = await stagesOf(ctx, subject.attr);
  assertStages(stages, q.selectedStageIds, subject.attr);
  ctx.step('LookUp', `records of ${ctx.def.pluralNoun} (projection ${ctx.def.projectionTable})`);
  if (ctx.filter) ctx.step('FilterSet', 'report filter on current values (semi-join on record id)');
  ctx.step(
    'LookUp',
    `every value of "${subject.attr.title}" with activity_duration = coalesce(active_until, now) − active_from`,
  );
  if (group) ctx.step('Join', `left join current "${group.attr.title}" (join_type 1)`);
  const codes = { mean: 3, min: 4, max: 5, median: 6 } as const;
  ctx.step('Group', `by stage${group ? ', group' : ''}; ${q.aggregation} (aggregation_type ${codes[q.aggregation]})`);
  const baseCte = await base(ctx, subject, null, group);
  const from = ['base JOIN attribute_values h ON h.instance_id = base.sid'];
  let key = 'NULL::text';
  if (group) {
    if (group.multi) {
      from.push('LEFT JOIN LATERAL unnest(base.cg) AS u(v) ON true');
      key = group.key('u.v');
    } else key = group.key('base.cg');
  }
  const conds = [`h.attribute_id = ${lit.uuid(subject.attr.id)}`, 'h.v_ref IS NOT NULL'];
  if (q.selectedStageIds) conds.push(`h.v_ref IN (${q.selectedStageIds.map((s) => lit.uuid(s)).join(', ')})`);
  if (q.range?.start) conds.push(`h.active_from >= ${ctx.instantOf(q.range.start)}`);
  if (q.range?.end) conds.push(`h.active_from < ${ctx.instantOf(QueryContext.nextBucket(q.range.end, 'day'))}`);
  if (group) {
    if (!group.grouping.includeNullGroup) conds.push(`${key} IS NOT NULL`);
    const keys = ctx.selectedKeys(group);
    if (keys) conds.push(`(${key} IS NULL OR ${key} IN (${keys.join(', ')}))`);
  }
  const ms = `(extract(epoch FROM (coalesce(h.active_until, ${lit.str(ctx.tx.now)}::timestamptz) - h.active_from)) * 1000)`;
  const agg =
    q.aggregation === 'median'
      ? `percentile_cont(0.5) WITHIN GROUP (ORDER BY ${ms})`
      : `${q.aggregation === 'mean' ? 'avg' : q.aggregation}(${ms})`;
  const rows = await ctx.run<{ stage: string; g: string | null; n: string; value: string | null }>(
    `WITH ${baseCte}
     SELECT h.v_ref::text AS stage, ${key} AS g, count(*) AS n, ${agg} AS value
     FROM ${from.join(' ')}
     WHERE ${conds.join(' AND ')}
     GROUP BY 1, 2`,
  );
  return {
    rows: rows.map((r) => ({ stage: r.stage, group: r.g, value: num(r.value), count: Number(r.n) })),
    stageAttr: subject.attr,
  };
}
