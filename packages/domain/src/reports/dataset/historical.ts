// Historical values (H api §4.1 time_domain continuous, builder §7) as an as-of series: for every time bucket of the
// window, the metric over the records as they were at the bucket's end (the current bucket: now). Value history
// (attribute_values, I6) gives every value a validity range [active_from, active_until); a value counts in bucket b
// when it was active at b's end, i.e. for buckets bucket(active_from) ≤ b < bucket(active_until). Records count from
// the bucket they were created in; the report filter applies to current values (help: historical filters evaluate
// current values), so deleted records drop out.
//
// Evaluation (integer buckets): the window's bucket start instants in the viewer's zone are computed here, and
// width_bucket() maps every timestamp to its bucket number with a binary search (no per-row time zone arithmetic).
// Every record contributes ranges (segment, metric value, first bucket, end bucket): segment ranges from the grouping
// attribute's history intersected with the metric attribute's history. Additive metrics (count, sum, mean = sum ÷
// count) are summed as +/- deltas at the range bounds and accumulated with a window SUM per segment (O(value rows +
// buckets × segments)); min, max and median unwind each range into its buckets (Attio's Unwind) and aggregate.
// The null segment (records without a value at that time) is "all records − Σ segments" for single-value attributes
// and additive metrics, otherwise the gaps between a record's value ranges ("islands").
import {
  bucketsBetween,
  type DatasetTimeConfig,
  type PivotQuery,
  type PivotRow,
  type TimeResolution,
} from '@agentic-crm/contracts';
import { localDate, localDayBounds } from '../../time.ts';
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

const HISTORY_TYPES = new Set(['pipeline', 'select', 'actor-reference', 'entity-reference']);

interface Plan {
  grouping: GroupSpec | null;
  historicGroup: boolean;
  metric: MetricSpec;
  historicMetric: boolean;
  resolution: TimeResolution;
}

type Agg = 'n' | 'sv' | 'nv';
interface SeriesRow {
  t: number;
  g: string | null;
  f: number | null;
  l: number | null;
  gf: number;
  n: string;
  sv: string;
  nv: string;
}

/** One as-of series over `buckets` (local bucket starts, oldest first). */
async function series(ctx: QueryContext, plan: Plan, buckets: string[]): Promise<PivotRow[]> {
  if (buckets.length === 0) return [];
  const { grouping, metric, resolution } = plan;
  const m = metric.metric;
  const B = buckets.length;
  const END = B + 1;
  // Thresholds: the start of every bucket and the end of the last one, as instants in the viewer's zone.
  const thresholds = [...buckets, QueryContext.nextBucket(buckets[B - 1] as string, resolution)].map(
    (d) => localDayBounds(d, ctx.timeZone).start,
  );
  const T = `${lit.str(`{${thresholds.join(',')}}`)}::timestamptz[]`;
  const WB = (e: string) => `width_bucket(${e}, ${T})`;
  const windowEnd = `${lit.str(thresholds[B] as string)}::timestamptz`;

  const additive = m.type === 'record-count' || ['count', 'sum', 'mean'].includes(m.aggregation);
  const wantNull = Boolean(grouping?.grouping.includeNullGroup);
  const strategy: 'none' | 'current' | 'subtract' | 'islands' | 'values' = !grouping
    ? 'none'
    : !plan.historicGroup
      ? 'current'
      : !wantNull
        ? 'values'
        : additive && !grouping.attr.isMultiselect
          ? 'subtract'
          : 'islands';

  // Base: live records matching the filter, created before the window's end, with their creation bucket and the
  // current values the query uses (cg = current segment value, cm = current metric value).
  const where = await ctx.where();
  const counting = m.type === 'attribute' && m.aggregation === 'count';
  const currentMetric = metric.path !== null && !plan.historicMetric;
  const from =
    ctx.filter || strategy === 'current' || currentMetric
      ? [`${ctx.table} p`, 'JOIN entity_instances i ON i.id = p.instance_id']
      : null;
  const cols = [`${from ? 'p.instance_id' : 'i.id'} AS id`, `${WB('i.created_at')} AS cb`];
  if (grouping && strategy === 'current') {
    from?.push(...grouping.joins);
    cols.push(`${grouping.ref} AS cg`);
  }
  if (currentMetric) {
    const p = metric.path as NonNullable<MetricSpec['path']>;
    from?.push(...p.joins);
    cols.push(
      counting
        ? `CASE WHEN ${p.multi ? `${p.ref} IS NOT NULL` : p.kind === 'rating' ? `${p.ref} >= 1` : `${p.ref} IS NOT NULL`} THEN 1 END AS cm`
        : `${metric.value} AS cm`,
    );
  }
  const baseSql = from
    ? `SELECT ${cols.join(', ')} FROM ${[...new Set(from)].join(' ')} WHERE ${where} AND i.created_at < ${windowEnd}`
    : // No filter and no current values: the definition's live records straight from their headers.
      `SELECT ${cols.join(', ')} FROM entity_instances i
       WHERE i.entity_definition_id = ${lit.uuid(ctx.def.id)} AND i.archived_at IS NULL AND i.merged_at IS NULL
         AND i.created_at < ${windowEnd}`;
  const ctes: string[] = [`base AS MATERIALIZED (${baseSql})`];

  /** Value rows of an attribute as bucket ranges [f, l), joined to the base records (base columns available). */
  const valueRanges = (attrId: string, select: string, extra = '') =>
    `SELECT h.instance_id AS id, ${select}, ${WB('h.active_from')} AS f,
            CASE WHEN h.active_until IS NULL THEN ${END} ELSE ${WB('h.active_until')} END AS l
     FROM attribute_values h JOIN base ON base.id = h.instance_id
     WHERE h.attribute_id = ${lit.uuid(attrId)} AND h.active_from < ${windowEnd}${extra}`;
  const currentKey = (raw: string) => (grouping as GroupSpec).key(raw);
  const multiCurrent = strategy === 'current' && (grouping as GroupSpec).multi;

  // R: record ranges per segment (t = 0) and, for "subtract", every record's range (t = 1): (t, g, f, l).
  const R: string[] = [];
  switch (strategy) {
    case 'none':
      R.push(`SELECT 0 AS t, NULL::text AS g, cb AS f, ${END} AS l FROM base`);
      break;
    case 'current':
      R.push(
        multiCurrent
          ? `SELECT 0 AS t, ${currentKey('u.v')} AS g, b.cb AS f, ${END} AS l
             FROM base b LEFT JOIN LATERAL unnest(b.cg) AS u(v) ON true`
          : `SELECT 0 AS t, ${currentKey('cg')} AS g, cb AS f, ${END} AS l FROM base`,
      );
      break;
    default: {
      const g = grouping as GroupSpec;
      ctes.push(
        `gv AS (${valueRanges(g.attr.id, `h.v_ref::text AS g${currentMetric ? ', base.cm' : ''}`, ' AND h.v_ref IS NOT NULL')})`,
      );
      R.push('SELECT 0 AS t, g, f, l FROM gv');
      if (strategy === 'subtract') R.push(`SELECT 1 AS t, NULL::text AS g, cb AS f, ${END} AS l FROM base`);
      if (strategy === 'islands') {
        ctes.push(
          // Coverage islands per record (overlapping or adjacent ranges merged), then the gaps between them.
          `gk AS (SELECT id, f, l, sum(CASE WHEN pl IS NULL OR f > pl THEN 1 ELSE 0 END)
                    OVER (PARTITION BY id ORDER BY f, l) AS k
                  FROM (SELECT id, f, l, max(l) OVER (PARTITION BY id ORDER BY f, l
                          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pl FROM gv WHERE f < l) o)`,
          `isl AS (SELECT id, min(f) AS f, max(l) AS l FROM gk GROUP BY id, k)`,
          `gaps AS (SELECT b.id, coalesce(lag(isl.l) OVER (PARTITION BY b.id ORDER BY isl.f), b.cb) AS f,
                      coalesce(isl.f, ${END}) AS l${currentMetric ? ', b.cm' : ''}
                    FROM base b LEFT JOIN isl ON isl.id = b.id
                    UNION ALL
                    SELECT isl.id, max(isl.l), ${END}${currentMetric ? ', max(b.cm)' : ''}
                    FROM isl${currentMetric ? ' JOIN base b ON b.id = isl.id' : ''}
                    GROUP BY isl.id HAVING max(isl.l) < ${END})`,
        );
        R.push('SELECT 0 AS t, NULL::text AS g, f, l FROM gaps');
      }
    }
  }

  // V: metric value ranges (t, g, val, f, l).
  const V: string[] = [];
  if (metric.path) {
    if (plan.historicMetric) {
      const attr = (metric.path as NonNullable<MetricSpec['path']>).attr;
      const zero = attr.type === 'rating' ? ' AND h.v_num <> 0' : '';
      const mvCols = `${counting ? '1::numeric' : 'h.v_num'} AS val${strategy === 'current' ? ', base.cg' : ''}`;
      ctes.push(`mv AS (${valueRanges(attr.id, mvCols, ` AND h.v_num IS NOT NULL${zero}`)})`);
      if (strategy === 'none') V.push('SELECT 0 AS t, NULL::text AS g, val, f, l FROM mv');
      else if (strategy === 'current') {
        V.push(
          multiCurrent
            ? `SELECT 0 AS t, ${currentKey('u.v')} AS g, mv.val, mv.f, mv.l
               FROM mv LEFT JOIN LATERAL unnest(mv.cg) AS u(v) ON true`
            : `SELECT 0 AS t, ${currentKey('cg')} AS g, val, f, l FROM mv`,
        );
      } else {
        V.push(
          `SELECT 0 AS t, gv.g, mv.val, greatest(gv.f, mv.f) AS f, least(gv.l, mv.l) AS l
           FROM gv JOIN mv ON mv.id = gv.id`,
        );
        if (strategy === 'subtract') V.push('SELECT 1 AS t, NULL::text AS g, val, f, l FROM mv');
        if (strategy === 'islands') {
          V.push(
            `SELECT 0 AS t, NULL::text AS g, mv.val, greatest(gaps.f, mv.f) AS f, least(gaps.l, mv.l) AS l
             FROM gaps JOIN mv ON mv.id = gaps.id`,
          );
        }
      }
    } else if (strategy === 'none') {
      // Current metric value over every range of the record.
      V.push(`SELECT 0 AS t, NULL::text AS g, cm AS val, cb AS f, ${END} AS l FROM base WHERE cm IS NOT NULL`);
    } else if (strategy === 'current') {
      V.push(
        multiCurrent
          ? `SELECT 0 AS t, ${currentKey('u.v')} AS g, b.cm AS val, b.cb AS f, ${END} AS l
             FROM base b LEFT JOIN LATERAL unnest(b.cg) AS u(v) ON true WHERE b.cm IS NOT NULL`
          : `SELECT 0 AS t, ${currentKey('cg')} AS g, cm AS val, cb AS f, ${END} AS l FROM base WHERE cm IS NOT NULL`,
      );
    } else {
      V.push('SELECT 0 AS t, g, cm AS val, f, l FROM gv WHERE cm IS NOT NULL');
      if (strategy === 'subtract')
        V.push(`SELECT 1 AS t, NULL::text AS g, cm AS val, cb AS f, ${END} AS l FROM base WHERE cm IS NOT NULL`);
      if (strategy === 'islands')
        V.push('SELECT 0 AS t, NULL::text AS g, cm AS val, f, l FROM gaps WHERE cm IS NOT NULL');
    }
  }

  // One pass: record ranges (k = 0) and value ranges (k = 1) clamped to the window [1, END), aggregated per range
  // start and per range end at once (GROUPING SETS); the client-side cumulative sums turn them into as-of values.
  const ranges = [
    ...R.map((r) => `SELECT 0 AS k, t, g, NULL::numeric AS val, f, l FROM (${r}) r`),
    ...V.map((v) => `SELECT 1 AS k, t, g, val, f, l FROM (${v}) v`),
  ];
  const clamped = `SELECT k, t, g, val, greatest(f, 1) AS f, least(l, ${END}) AS l FROM (${ranges.join(' UNION ALL ')}) x`;
  const rows = await ctx.run<SeriesRow>(
    `WITH ${ctes.join(',\n')}
     SELECT t, g, f, l, grouping(f) AS gf,
       count(*) FILTER (WHERE k = 0) AS n, coalesce(sum(val) FILTER (WHERE k = 1), 0) AS sv,
       count(val) FILTER (WHERE k = 1) AS nv
     FROM (${clamped}) c WHERE f < l
     GROUP BY GROUPING SETS ((t, g, f), (t, g, l))`,
  );

  // Non-additive metrics: unwind value ranges into their buckets.
  let extremes: Map<string, number | null> | null = null;
  if (!additive && m.type === 'attribute' && V.length > 0) {
    const agg =
      m.aggregation === 'median' ? 'percentile_cont(0.5) WITHIN GROUP (ORDER BY val)' : `${m.aggregation}(val)`;
    const unwound = await ctx.run<{ b: number; g: string | null; value: string | null }>(
      `WITH ${ctes.join(',\n')}
       SELECT s.b, g, ${agg} AS value
       FROM (SELECT t, g, val, greatest(f, 1) AS f, least(l, ${END}) AS l
             FROM (${V.join(' UNION ALL ')}) v) c
       CROSS JOIN LATERAL generate_series(c.f, c.l - 1) AS s(b)
       WHERE c.t = 0 AND c.f < c.l
       GROUP BY 1, 2`,
    );
    extremes = new Map(unwound.map((r) => [`${r.b}|${r.g ?? ''}`, num(r.value)]));
  }

  // Deltas (+ at range starts, − at range ends inside the window) → cumulative sums per segment.
  const series = new Map<string, { t: number; g: string | null; d: Record<Agg, number>[] }>();
  for (const r of rows) {
    const key = `${r.t}|${r.g === null ? '\u0000' : r.g}`;
    let entry = series.get(key);
    if (!entry) {
      entry = { t: Number(r.t), g: r.g, d: Array.from({ length: END + 1 }, () => ({ n: 0, sv: 0, nv: 0 })) };
      series.set(key, entry);
    }
    const start = Number(r.gf) === 0;
    const b = start ? Number(r.f) : Number(r.l);
    if (!start && b >= END) continue;
    const sign = start ? 1 : -1;
    const slot = entry.d[b] as Record<Agg, number>;
    slot.n += sign * Number(r.n);
    slot.sv += sign * Number(r.sv);
    slot.nv += sign * Number(r.nv);
  }
  const bySeg = new Map<string | null, Record<Agg, number>[]>();
  let totals: Record<Agg, number>[] | null = null;
  for (const { t, g, d } of series.values()) {
    const acc = { n: 0, sv: 0, nv: 0 };
    const cumulative: Record<Agg, number>[] = [];
    for (let b = 1; b <= B; b++) {
      const v = d[b] as Record<Agg, number>;
      acc.n += v.n;
      acc.sv += v.sv;
      acc.nv += v.nv;
      cumulative.push({ ...acc });
    }
    if (t === 1) totals = cumulative;
    else bySeg.set(g, cumulative);
  }
  if (strategy === 'subtract' && totals) {
    const rest = (totals as Record<Agg, number>[]).map((v) => ({ ...v }));
    for (const [g, s] of bySeg) {
      if (g === null) continue;
      s.forEach((v, i) => {
        const r = rest[i] as Record<Agg, number>;
        r.n -= v.n;
        r.sv -= v.sv;
        r.nv -= v.nv;
      });
    }
    bySeg.set(null, rest);
  }
  // Segment selection (selected values; the null segment only when asked for).
  const selected = grouping?.grouping.selectedValues
    ? new Set(grouping.grouping.selectedValues.map((s) => s.toLowerCase()))
    : null;
  const out: PivotRow[] = [];
  for (const [g, s] of bySeg) {
    if (grouping && g === null && !wantNull) continue;
    if (selected && g !== null && !selected.has(g)) continue;
    s.forEach((v, i) => {
      let value: number | null;
      if (m.type === 'record-count') value = v.n;
      else if (m.aggregation === 'count') value = v.nv;
      else if (m.aggregation === 'sum') value = v.sv;
      else if (m.aggregation === 'mean') value = v.nv > 0 ? v.sv / v.nv : null;
      else value = extremes?.get(`${i + 1}|${g ?? ''}`) ?? null;
      out.push({ group: buckets[i] as string, segment: g, value, count: v.n });
    });
  }
  return out;
}

function windowOf(
  ctx: QueryContext,
  range: { start: string | null; end: string | null },
  earliest: string | null,
  resolution: TimeResolution,
): string[] {
  const today = localDate(ctx.tx.now, ctx.timeZone);
  const end = range.end && range.end < today ? range.end : today;
  const start = range.start ?? earliest;
  if (!start || start > end) return [];
  const buckets = bucketsBetween(start, end, resolution, ctx.weekStart);
  if (buckets.length > MAX_BUCKETS) {
    throw invalidQuery(`Too many time buckets (${buckets.length}); choose a shorter range or a coarser resolution`);
  }
  return buckets;
}

export async function runHistorical(ctx: QueryContext, q: PivotQuery): Promise<PivotResult> {
  const tc: DatasetTimeConfig = q.timeConfig ?? { resolution: 'month', start: null, end: null, comparison: null };
  const resolution = tc.resolution;
  if (q.secondaryGrouping) throw invalidQuery('Historical values reports have a single "Segment by"');
  const metric = await ctx.metric(q.metric);
  const grouping = q.primaryGrouping ? await ctx.grouping(q.primaryGrouping, resolution) : null;
  const historicGroup = Boolean(
    grouping &&
      grouping.grouping.historic &&
      grouping.grouping.path.length === 1 &&
      grouping.kind === 'uuid' &&
      HISTORY_TYPES.has(grouping.attr.type),
  );
  const historicMetric = Boolean(
    metric.path && q.metricIsHistoric && metric.metric.type === 'attribute' && metric.metric.path.length === 1,
  );
  const plan: Plan = { grouping, historicGroup, metric, historicMetric, resolution };

  ctx.step('LookUp', `records of ${ctx.def.pluralNoun} with created_at (entity-instance)`);
  if (ctx.filter) ctx.step('FilterSet', 'report filter on current values (semi-join on record id)');
  if (grouping) {
    ctx.step(
      'LookUp',
      historicGroup
        ? `value history of "${grouping.attr.title}" (attribute-value: active_from, active_until)`
        : `current value of "${grouping.attr.title}"`,
    );
  }
  if (metric.path) {
    ctx.step(
      'LookUp',
      historicMetric ? `value history of "${metric.path.attr.title}"` : `current value of "${metric.path.attr.title}"`,
    );
  }
  ctx.step(
    'AddKey',
    `DateDiffInterval(active_from, active_until | now, ${resolution}, ${ctx.timeZone}, week start ${ctx.weekStart}) as bucket numbers (width_bucket)`,
  );
  ctx.step('Unwind', 'as of each bucket end: +/- deltas at range bounds, cumulative SUM per segment');
  ctx.step('Aggregation', describeMetric(metric.metric));

  // "All": from the bucket of the oldest record matching the filter.
  let earliest: string | null = null;
  if (!tc.start || (tc.comparison && !tc.comparison.start)) {
    const where = await ctx.where();
    const rows = await ctx.run<{ d: string | null }>(
      ctx.filter
        ? `SELECT min(i.created_at) AS d FROM ${ctx.table} p JOIN entity_instances i ON i.id = p.instance_id WHERE ${where}`
        : `SELECT min(i.created_at) AS d FROM entity_instances i
           WHERE i.entity_definition_id = ${lit.uuid(ctx.def.id)} AND i.archived_at IS NULL AND i.merged_at IS NULL`,
    );
    earliest = rows[0]?.d ? localDate(rows[0].d, ctx.timeZone) : null;
  }
  const buckets = windowOf(ctx, { start: tc.start, end: tc.end }, earliest, resolution);
  const rows = await series(ctx, plan, buckets);
  let comparisonRows: PivotRow[] | null = null;
  let comparisonBuckets: string[] | null = null;
  if (tc.comparison) {
    comparisonBuckets = windowOf(ctx, tc.comparison, earliest, resolution);
    const prev = await series(ctx, plan, comparisonBuckets);
    comparisonRows = alignRows(prev, comparisonBuckets, buckets);
    ctx.step('Parallel', `comparison window ${tc.comparison.start} – ${tc.comparison.end}, aligned by bucket index`);
  }
  return {
    rows,
    comparisonRows,
    groups: { primary: grouping, secondary: null },
    resolution,
    buckets,
    comparisonBuckets,
  };
}
