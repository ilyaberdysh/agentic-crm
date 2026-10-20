// Shared state and SQL builders of one dataset query: the data source and its filter (compiled on the projection,
// S1 rule 1), path joins (first referenced record per hop, as views do), group keys, time buckets in the viewer's
// zone with the week start (B.24, X-10), the plan description and the dependency set for freshness.
import {
  addDurationToDate,
  type DatasetGrouping,
  type DatasetMetric,
  type DatasetPlanStep,
  type Path,
  type PivotRow,
  type Predicate,
  type TimeResolution,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { badRequest } from '../../errors.ts';
import { projectionColumn } from '../../projection.ts';
import { type AttrDef, type DefInfo, loadDefinition } from '../../schema/model.ts';
import { numLit, projectionTableRef, strLit, uuidLit } from '../../sqltext.ts';
import type { Tx } from '../../tx.ts';
import { Compiler, hasValue } from '../../views/compiler.ts';
import { type FieldKind, resolveField } from '../../views/operators.ts';
import { attrAt } from '../../views/resolve.ts';
import { collectPredicate } from '../model.ts';

export const invalidQuery = (message: string, details?: Record<string, unknown>) =>
  badRequest('VALIDATION_ERROR', message, details);

/** Time buckets per query (day resolution over ~3 years). */
export const MAX_BUCKETS = 1200;
/** Distinct groups returned per grouping (text group-bys over many records). */
export const MAX_GROUPS = 1000;

export const STEP: Record<TimeResolution, string> = {
  day: '1 day',
  week: '7 days',
  month: '1 month',
  quarter: '3 months',
  year: '1 year',
};
export const STEP_ISO: Record<TimeResolution, string> = {
  day: 'P1D',
  week: 'P1W',
  month: 'P1M',
  quarter: 'P3M',
  year: 'P1Y',
};

const GROUPABLE: ReadonlySet<FieldKind> = new Set([
  'text',
  'email',
  'domain',
  'phone',
  'country',
  'number',
  'rating',
  'boolean',
  'date',
  'timestamp',
  'uuid',
]);
const NUMERIC_KINDS: ReadonlySet<FieldKind> = new Set(['number', 'rating']);

/** A value reached through a path from the data source, as columns of the base query. */
export interface PathRef {
  joins: string[];
  /** Column reference (an array for multi-value attributes). */
  ref: string;
  attr: AttrDef;
  kind: FieldKind;
  suffix: string;
  multi: boolean;
  /** Instance id column of the record holding the value (the source record for one-hop paths). */
  instance: string;
}

/** A group-by: its raw reference in the base query and how a scalar raw value becomes the group key (text). */
export interface GroupSpec extends PathRef {
  grouping: DatasetGrouping;
  temporal: boolean;
  /** SQL text key of a scalar raw value. */
  key(raw: string): string;
}

export interface MetricSpec {
  metric: DatasetMetric;
  /** null for record counts. */
  path: PathRef | null;
  /** Scalar SQL of the metric value per record (ratings: 0 = no value). */
  value: string | null;
}

export class QueryContext {
  readonly compiler: Compiler;
  readonly plan: DatasetPlanStep[] = [];
  readonly sqls: string[] = [];
  readonly defIds = new Set<string>();
  readonly attrIds = new Set<string>();
  /** Set when a grouping had more than MAX_GROUPS values and the smallest groups were left out. */
  truncated = false;
  private seq = 0;

  constructor(
    readonly tx: Tx,
    readonly def: DefInfo,
    /** Resolved filter (static values only). */
    readonly filter: Predicate | null,
    readonly timeZone: string,
    readonly weekStart: number,
  ) {
    this.compiler = new Compiler(tx);
    this.defIds.add(def.id);
    collectPredicate(filter, this.defIds, this.attrIds);
  }

  get table(): string {
    return projectionTableRef(this.def.projectionTable as string);
  }

  alias(prefix: string): string {
    return `${prefix}${++this.seq}`;
  }

  step(op: string, detail: string): void {
    this.plan.push({ op, detail });
  }

  async where(alias = 'p'): Promise<string> {
    return this.filter ? this.compiler.predicate(alias, this.def, this.filter) : 'TRUE';
  }

  track(path: Path): void {
    for (const hop of path) {
      this.defIds.add(hop.entityDefinitionId);
      this.attrIds.add(hop.attributeDefinitionId);
    }
  }

  /** The value at the end of `path` from the projection row `p` (each hop joins the first referenced record). */
  async pathRef(path: Path, field: string | null | undefined, alias = 'p'): Promise<PathRef> {
    this.track(path);
    const first = path[0];
    if (!first || first.entityDefinitionId !== this.def.id) {
      throw invalidQuery('Attribute paths must start at the data source');
    }
    try {
      const v = await this.compiler.pathValue(alias, this.def, path, field, 'filter');
      if (v.attr.isArchived) throw invalidQuery(`Attribute "${v.attr.title}" is archived`);
      if (!v.field) throw invalidQuery('The record id cannot be used here');
      // pathValue answers `<alias>.<column>`; the alias is the projection row of the record holding the value.
      const instance = `${v.ref.slice(0, v.ref.indexOf('.'))}.instance_id`;
      return {
        joins: v.joins,
        ref: v.ref,
        attr: v.attr,
        kind: v.field.kind,
        suffix: v.field.suffix,
        multi: v.multi,
        instance,
      };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'UNSUPPORTED_FILTER' || code === 'UNSUPPORTED_SORT') throw invalidQuery((err as Error).message);
      throw err;
    }
  }

  /** The instance holding the last hop of `path` (the record itself for one-hop paths) and that attribute. */
  async subject(path: Path, alias = 'p'): Promise<{ joins: string[]; instance: string; attr: AttrDef }> {
    this.track(path);
    const joins: string[] = [];
    let current = this.def;
    let at = alias;
    for (let i = 0; i < path.length - 1; i++) {
      const attr = attrAt(current, path[i] as Path[number]);
      if (attr.type !== 'entity-reference') throw invalidQuery('Only record references can be traversed in a path');
      const next = await loadDefinition(this.tx, (path[i + 1] as Path[number]).entityDefinitionId);
      if (!next.projectionTable) throw invalidQuery('The path leads to an object without records');
      const col = projectionColumn(attr)?.name as string;
      const t = this.alias('sj');
      joins.push(
        `LEFT JOIN ${projectionTableRef(next.projectionTable)} ${t} ON ${t}.instance_id = ${at}.${col}${attr.isMultiselect ? '[1]' : ''}`,
      );
      current = next;
      at = t;
    }
    const last = path[path.length - 1];
    if (!last) throw invalidQuery('Empty attribute path');
    const attr = attrAt(current, last);
    return { joins, instance: `${at}.instance_id`, attr };
  }

  /** A status/select attribute reached by `path` (funnels, time in stage, stage changed). */
  async statusSubject(path: Path, alias = 'p') {
    const s = await this.subject(path, alias);
    if ((s.attr.type !== 'pipeline' && s.attr.type !== 'select') || s.attr.isMultiselect) {
      throw invalidQuery(`"${s.attr.title}" is not a status or select attribute`, {
        attribute_definition_id: s.attr.id,
      });
    }
    if (s.attr.isArchived) throw invalidQuery(`Attribute "${s.attr.title}" is archived`);
    return s;
  }

  async metric(metric: DatasetMetric): Promise<MetricSpec> {
    if (metric.type === 'record-count') return { metric, path: null, value: null };
    const path = await this.pathRef(metric.path, metric.field);
    if (metric.aggregation === 'count') {
      return { metric, path, value: null };
    }
    if (!NUMERIC_KINDS.has(path.kind) || path.multi) {
      throw invalidQuery(`"${path.attr.title}" is not a number, currency or rating attribute`, {
        attribute_definition_id: path.attr.id,
      });
    }
    return { metric, path, value: path.kind === 'rating' ? `NULLIF(${path.ref}, 0)` : path.ref };
  }

  /** SQL of `metric.aggregation` over the scalar metric value `v` (and the has-value test for counts). */
  aggregate(m: MetricSpec, v: string | null = m.value): string {
    const metric = m.metric;
    if (metric.type === 'record-count') return 'count(*)';
    if (metric.aggregation === 'count') {
      const p = m.path as PathRef;
      return `count(*) FILTER (WHERE ${hasValue(v ?? p.ref, p.kind === 'rating' && !p.multi)})`;
    }
    switch (metric.aggregation) {
      case 'sum':
        return `sum(${v})`;
      case 'mean':
        return `avg(${v})`;
      case 'min':
        return `min(${v})`;
      case 'max':
        return `max(${v})`;
      case 'median':
        return `percentile_cont(0.5) WITHIN GROUP (ORDER BY ${v})`;
    }
  }

  async grouping(g: DatasetGrouping, resolution: TimeResolution): Promise<GroupSpec> {
    const p = await this.pathRef(g.path, g.field);
    if (!GROUPABLE.has(p.kind)) {
      throw invalidQuery(`"${p.attr.title}" cannot be grouped by "${g.field ?? 'value'}"`, {
        attribute_definition_id: p.attr.id,
      });
    }
    const temporal = p.kind === 'date' || p.kind === 'timestamp';
    const key = (raw: string): string => {
      switch (p.kind) {
        case 'uuid':
          return `(${raw})::text`;
        case 'number':
          return `trim_scale(${raw})::text`;
        case 'rating':
          return `trim_scale(NULLIF(${raw}, 0))::text`;
        case 'boolean':
          return `coalesce(${raw}, false)::text`;
        case 'date':
          return `to_char(${this.bucketOfLocal(`(${raw})::timestamp`, resolution)}, 'YYYY-MM-DD')`;
        case 'timestamp':
          return `to_char(${this.bucketOf(raw, resolution)}, 'YYYY-MM-DD')`;
        default:
          return `(${raw})::text`;
      }
    };
    return { ...p, grouping: g, temporal, key };
  }

  /** Literal list of selected keys for a grouping (uuid kinds lower-cased; text kinds normalised like the column). */
  selectedKeys(spec: GroupSpec): string[] | null {
    const values = spec.grouping.selectedValues;
    if (!values) return null;
    return values.map((v) => {
      if (spec.kind === 'uuid') return strLit(v.toLowerCase());
      if (spec.kind === 'text') return `norm_key(${strLit(v)})`;
      return strLit(v);
    });
  }

  // -------------------------------------------------------------------------------------------------------------
  // Time

  /** Local wall-clock timestamp of a timestamptz expression in the viewer's zone. */
  local(expr: string): string {
    return `(${expr} AT TIME ZONE ${strLit(this.timeZone)})`;
  }

  /** Local bucket start (timestamp without zone) of a local timestamp. */
  bucketOfLocal(local: string, resolution: TimeResolution): string {
    if (resolution === 'week') {
      // Postgres weeks start on Monday; shift so they start on the viewer's week start (0 = Sunday … 6 = Saturday).
      const shift = (this.weekStart + 6) % 7;
      return shift === 0
        ? `date_trunc('week', ${local})`
        : `(date_trunc('week', ${local} - interval '${shift} days') + interval '${shift} days')`;
    }
    return `date_trunc('${resolution}', ${local})`;
  }

  /** Local bucket start of a timestamptz expression. */
  bucketOf(expr: string, resolution: TimeResolution): string {
    return this.bucketOfLocal(this.local(expr), resolution);
  }

  /** The instant a local date's midnight starts in the viewer's zone. */
  instantOf(date: string): string {
    return `(${strLit(`${date} 00:00:00`)}::timestamp AT TIME ZONE ${strLit(this.timeZone)})`;
  }

  /** The bucket after `bucket` ('YYYY-MM-DD'). */
  static nextBucket(bucket: string, resolution: TimeResolution): string {
    return addDurationToDate(bucket, STEP_ISO[resolution]);
  }

  static tsLit(date: string): string {
    return `${strLit(`${date} 00:00:00`)}::timestamp`;
  }

  /**
   * Runs one generated statement as the owner role, as search ranking does: RLS policies are evaluated per row
   * (current_setting() on every projection and value row: ~3× slower scans, and row estimates of 0.5 % that turn hash
   * joins into nested loops). Every statement is scoped by ids resolved under RLS — the projection table of a
   * definition loaded in this workspace, its attribute ids, its stage ids — so no other tenant's row can match.
   */
  async run<T>(text: string): Promise<T[]> {
    this.sqls.push(text);
    return this.tx.asOwner(async () => (await sql.raw<T>(text).execute(this.tx.db)).rows);
  }

  /** Records matching the filter. */
  async totalRecords(): Promise<number> {
    const rows = await this.run<{ n: string }>(`SELECT count(*) AS n FROM ${this.table} p WHERE ${await this.where()}`);
    return Number(rows[0]?.n ?? 0);
  }
}

export const lit = { uuid: uuidLit, str: strLit, num: numLit };

/** Comparison rows re-keyed to the main window's bucket at the same index (rows outside both windows dropped). */
export function alignRows(rows: PivotRow[], from: string[], to: string[]): PivotRow[] {
  const index = new Map(from.map((b, i) => [b, i]));
  const out: PivotRow[] = [];
  for (const r of rows) {
    const i = r.group === null ? undefined : index.get(r.group);
    const target = i === undefined ? undefined : to[i];
    if (target !== undefined) out.push({ ...r, group: target });
  }
  return out;
}

/** Number from a numeric/bigint text column (null stays null). */
export const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);
