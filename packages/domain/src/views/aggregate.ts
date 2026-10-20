// Footer calculations (C1 filters-sorts-calcs §8) over a snapshot: the snapshot's resolved predicate is re-evaluated
// on the projection (S1 rule 6: cheaper than joining 1M snapshot ids), so the numbers describe the same rows the
// table shows. One query per calculation: total rows, rows with a value, and the kind's own aggregate.
import type { AggregateOutput, AggregationKind, Path, Predicate } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { badRequest } from '../errors.ts';
import type { DefInfo } from '../schema/model.ts';
import { projectionTableRef } from '../sqltext.ts';
import type { Tx } from '../tx.ts';
import { Compiler } from './compiler.ts';
import { walkPath } from './resolve.ts';

const COUNT_KINDS = new Set<AggregationKind>([
  'count_empty',
  'count_not_empty',
  'percent_empty',
  'percent_not_empty',
  'filled',
]);
const CHECK_KINDS = new Set<AggregationKind>([
  'count_checked',
  'count_unchecked',
  'percent_checked',
  'percent_unchecked',
]);
const NUMERIC_KINDS = new Set<AggregationKind>(['sum', 'mean', 'median']);
const EXTREME_KINDS = new Set<AggregationKind>(['min', 'max', 'earliest', 'latest']);

const pct = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 10_000) / 100);

export async function aggregateSnapshot(
  tx: Tx,
  def: DefInfo,
  predicate: Predicate | null,
  input: { path: Path; field?: string | undefined; aggregation: AggregationKind },
): Promise<Omit<AggregateOutput, 'accurateAt'>> {
  if (!def.projectionTable) throw badRequest('VALIDATION_ERROR', 'This entity definition has no records');
  await walkPath(tx, def, input.path);
  const compiler = new Compiler(tx);
  const where = predicate ? await compiler.predicate('p', def, predicate) : 'TRUE';
  const v = await compiler.pathValue('p', def, input.path, input.field, 'filter');
  const kind = v.field?.kind ?? 'uuid';
  const { aggregation } = input;
  const label = `${v.attr.type} attribute "${v.attr.apiSlug}"`;

  if (CHECK_KINDS.has(aggregation) && kind !== 'boolean') {
    throw badRequest('VALIDATION_ERROR', `${aggregation} needs a checkbox attribute (${label})`);
  }
  const numeric = (kind === 'number' || kind === 'rating') && !v.multi;
  const temporal = (kind === 'date' || kind === 'timestamp') && !v.multi;
  if (NUMERIC_KINDS.has(aggregation) && !numeric) {
    throw badRequest('VALIDATION_ERROR', `${aggregation} needs a number, currency or rating attribute (${label})`);
  }
  if (EXTREME_KINDS.has(aggregation)) {
    const wantsDates = aggregation === 'earliest' || aggregation === 'latest';
    if (wantsDates ? !temporal : !numeric && !temporal) {
      throw badRequest(
        'VALIDATION_ERROR',
        `${aggregation} needs ${wantsDates ? 'a date or timestamp' : 'a number, currency, rating, date or timestamp'} attribute (${label})`,
      );
    }
  }

  const ref = v.ref;
  // Rows with a value: checkbox = checked, rating = > 0, arrays = at least one value.
  const filled =
    kind === 'boolean' ? `${ref} IS TRUE` : kind === 'rating' && !v.multi ? `${ref} >= 1` : `${ref} IS NOT NULL`;
  const num = kind === 'rating' ? `NULLIF(${ref}, 0)` : ref;
  let expr = 'NULL';
  let from = `${projectionTableRef(def.projectionTable)} p ${v.joins.join(' ')}`;
  switch (aggregation) {
    case 'sum':
      expr = `coalesce(sum(${num}), 0)::text`;
      break;
    case 'mean':
      expr = `avg(${num})::text`;
      break;
    case 'median':
      expr = `(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${num}))::text`;
      break;
    case 'min':
    case 'earliest':
    case 'max':
    case 'latest': {
      const fn = aggregation === 'min' || aggregation === 'earliest' ? 'min' : 'max';
      expr =
        kind === 'timestamp'
          ? `to_char(${fn}(${ref}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
          : kind === 'date'
            ? `to_char(${fn}(${ref}), 'YYYY-MM-DD')`
            : `${fn}(${num})::text`;
      break;
    }
    case 'count_unique':
      if (v.multi) {
        from = `${from} LEFT JOIN LATERAL unnest(${ref}) u(x) ON true`;
        expr = 'count(DISTINCT u.x)::text';
      } else {
        expr = `count(DISTINCT ${ref})::text`;
      }
      break;
    default:
      break;
  }
  // With an unnest join, rows multiply: count records by distinct instance id.
  const totalExpr = v.multi && aggregation === 'count_unique' ? 'count(DISTINCT p.instance_id)' : 'count(*)';
  const filledExpr =
    v.multi && aggregation === 'count_unique'
      ? `count(DISTINCT p.instance_id) FILTER (WHERE ${filled})`
      : `count(*) FILTER (WHERE ${filled})`;
  const { rows } = await sql
    .raw<{ total: string; filled: string; value: string | null }>(
      `SELECT ${totalExpr} AS total, ${filledExpr} AS filled, ${expr} AS value FROM ${from} WHERE ${where}`,
    )
    .execute(tx.db);
  const r = rows[0] as { total: string; filled: string; value: string | null };
  const total = Number(r.total);
  const filledCount = Number(r.filled);
  const empty = total - filledCount;

  let value: number | null = null;
  let valueText: string | null = null;
  if (COUNT_KINDS.has(aggregation) || CHECK_KINDS.has(aggregation)) {
    value = {
      count_empty: empty,
      count_unchecked: empty,
      count_not_empty: filledCount,
      count_checked: filledCount,
      filled: filledCount,
      percent_empty: pct(empty, total),
      percent_unchecked: pct(empty, total),
      percent_not_empty: pct(filledCount, total),
      percent_checked: pct(filledCount, total),
    }[aggregation as string] as number;
  } else if (temporal && EXTREME_KINDS.has(aggregation)) {
    valueText = r.value;
  } else {
    value = r.value === null ? null : Number(r.value);
  }
  const currencyCode =
    v.attr.type === 'currency' && (NUMERIC_KINDS.has(aggregation) || EXTREME_KINDS.has(aggregation))
      ? (v.attr.config.currencyConfiguration?.defaultCurrencyCode ?? null)
      : null;
  return { aggregation, value, valueText, total, filled: filledCount, currencyCode };
}
