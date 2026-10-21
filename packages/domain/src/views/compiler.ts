// View compiler: resolved predicate AST + sorts → one SELECT over the definition's projection table (S1 §9 rules):
//   (1) views compile to projection SQL only — except history leaves (status "was"), which read attribute_values
//       through av_attr_hist (rule 7: the caller disables nested loops for them);
//   (2) sorts put empty values last in both directions, tie-broken by instance id (UUIDv7 ≈ creation order);
//   (3) the SELECT is executed by snapshot_create(), never inside a data-modifying statement;
//   (4) text compares on norm_key() values in COLLATE "C";
//   (5) select/status sorts join select_options.sort_order;
//   (6) aggregates re-evaluate the filter on the projection (whereClause() / aggregateQuery()).
// Leaf semantics: `must` = some current value satisfies all constraints; `must-not` = no value does. Multi-hop paths
// traverse record references into the target definition's projection; path sorts and aggregates follow the first
// referenced record. Inputs are resolved predicates (resolve.ts): every value is static.
import { actorTypes, type Constraint, type Predicate, type PredicateLeaf, type Sort } from '@agentic-crm/contracts';
import { badRequest } from '../errors.ts';
import { projectionColumn } from '../projection.ts';
import { type AttrDef, type DefInfo, loadDefinition } from '../schema/model.ts';
import { likeEscape, numLit, projectionTableRef, strLit, uuidLit } from '../sqltext.ts';
import type { Tx } from '../tx.ts';
import { normalizeDomain, normalizePhone } from '../values/normalize.ts';
import {
  type FieldKind,
  type FieldSpec,
  HISTORY_OPERATORS,
  type HistoryField,
  resolveField,
  resolveHistoryField,
} from './operators.ts';
import { attrAt } from './resolve.ts';

const unsupported = (message: string, details?: Record<string, unknown>) =>
  badRequest('UNSUPPORTED_FILTER', message, details);

const MAX_IN = 1000;
const LIFECYCLE = new Set(['ACTIVE', 'WON', 'LOST']);
const ACTOR_TYPES = new Set<string>(actorTypes);
const TEXT_KINDS = new Set<FieldKind>(['text', 'email', 'domain', 'phone']);

/** A value reached through a path: its SQL reference (raw column, arrays for multi-value), joins and field. */
export interface PathValue {
  joins: string[];
  /** Column reference (an array for multi-value attributes). */
  ref: string;
  attr: AttrDef;
  /** null for the record id attribute (ref is the instance id). */
  field: FieldSpec | null;
  multi: boolean;
}

export class Compiler {
  private aliasSeq = 0;
  constructor(private readonly tx: Tx) {}

  private alias(prefix: string): string {
    return `${prefix}${++this.aliasSeq}`;
  }

  async predicate(alias: string, def: DefInfo, p: Predicate): Promise<string> {
    if ('and' in p) {
      if (p.and.length === 0) return 'TRUE';
      const parts = await Promise.all(p.and.map((c) => this.predicate(alias, def, c)));
      return `(${parts.join(' AND ')})`;
    }
    if ('or' in p) {
      if (p.or.length === 0) return 'FALSE';
      const parts = await Promise.all(p.or.map((c) => this.predicate(alias, def, c)));
      return `(${parts.join(' OR ')})`;
    }
    const cond = await this.leaf(alias, def, p);
    return p.mode === 'must' ? `coalesce(${cond}, false)` : `NOT coalesce(${cond}, false)`;
  }

  /** Condition (without the must/must-not wrapper) of one leaf evaluated on `alias`. */
  private async leaf(alias: string, def: DefInfo, leaf: PredicateLeaf): Promise<string> {
    const [hop, ...rest] = leaf.path;
    if (!hop) throw unsupported('Empty filter path');
    const attr = attrAt(def, hop);
    if (rest.length > 0) {
      // Path filter: some referenced record satisfies the remainder (S1 q2a/q2b shape).
      if (attr.type !== 'entity-reference') throw unsupported('Only record references can be traversed in a path');
      const target = await loadDefinition(this.tx, (rest[0] as { entityDefinitionId: string }).entityDefinitionId);
      if (!target.projectionTable) throw unsupported('Path target has no records');
      const t = this.alias('t');
      const inner = await this.leaf(t, target, { ...leaf, path: rest });
      const col = `${alias}.${mainColumn(attr)}`;
      const sub = `SELECT ${t}.instance_id FROM ${projectionTableRef(target.projectionTable)} ${t} WHERE coalesce(${inner}, false)`;
      return attr.isMultiselect ? `(${col} && ARRAY(${sub}))` : `(${col} IN (${sub}))`;
    }
    if (leaf.history) return this.historyLeaf(alias, attr, leaf.constraints);
    const constraints = leaf.constraints.filter((c) => c.field !== 'active_until');
    if (attr.systemAttributeType === 'id') return this.recordIdCondition(alias, constraints);
    const mainRef = `${alias}.${mainColumn(attr)}`;
    if (constraints.length === 0) return hasValue(mainRef, attr.type === 'rating' && !attr.isMultiselect);

    const resolved = constraints.map((c) => {
      const field = resolveField(attr.type, c.field, 'filter');
      if (!field) throw unsupported(`Unknown field "${c.field}" for ${attr.type} attribute "${attr.apiSlug}"`);
      if (!field.operators.has(c.operator)) {
        throw unsupported(`Operator "${c.operator}" is not supported on ${attr.type}.${field.name}`);
      }
      const column = projectionColumn(attr, field.suffix);
      if (!column) throw unsupported(`Field "${c.field}" is not projected`);
      return { c, field, column: column.name };
    });

    if (!attr.isMultiselect) {
      return `(${resolved.map((r) => this.condition(`${alias}.${r.column}`, attr, r.field, r.c)).join(' AND ')})`;
    }
    // Multi-value attribute: empty / not-empty / all apply to the whole array; other constraints must hold for one
    // element (parallel unnest keeps sub-field columns of the same value aligned).
    const arrayOps = new Set(['empty', 'not-empty', 'all']);
    const arrayLevel = resolved.filter((r) => arrayOps.has(r.c.operator));
    const elementLevel = resolved.filter((r) => !arrayOps.has(r.c.operator));
    const parts = arrayLevel.map((r) => {
      const col = `${alias}.${r.column}`;
      if (r.c.operator === 'empty') return `${col} IS NULL`;
      if (r.c.operator === 'not-empty') return `${col} IS NOT NULL`;
      const lits = this.list(r.field, r.c, attr).join(', ');
      const cast = r.field.kind === 'uuid' ? '::uuid[]' : '';
      return `${col} @> ARRAY[${lits}]${cast}`;
    });
    if (elementLevel.length > 0) {
      const columns = [...new Set(elementLevel.map((r) => r.column))];
      const x = this.alias('x');
      const names = columns.map((_, i) => `c${i}`);
      const conds = elementLevel.map((r) => this.condition(`${x}.c${columns.indexOf(r.column)}`, attr, r.field, r.c));
      parts.push(
        `EXISTS (SELECT 1 FROM unnest(${columns.map((c) => `${alias}.${c}`).join(', ')}) AS ${x}(${names.join(', ')}) WHERE ${conds.join(' AND ')})`,
      );
    }
    return `(${parts.join(' AND ')})`;
  }

  /** History leaf: some value row of the attribute — current or retired — satisfies every constraint. */
  private historyLeaf(alias: string, attr: AttrDef, constraints: Constraint[]): string {
    const conds = [`h.attribute_id = ${uuidLit(attr.id)}`, 'h.v_ref IS NOT NULL'];
    for (const c of constraints) {
      const hf = resolveHistoryField(attr.type, c.field);
      if (!hf) throw unsupported(`Field "${c.field}" cannot be used in a history filter on "${attr.apiSlug}"`);
      if (!HISTORY_OPERATORS[hf.kind].has(c.operator)) {
        throw unsupported(`Operator "${c.operator}" is not supported on ${attr.type}.${c.field} history`);
      }
      conds.push(this.historyCondition(attr, hf, c));
    }
    return `(${alias}.instance_id IN (SELECT h.instance_id FROM attribute_values h WHERE ${conds.join(' AND ')}))`;
  }

  private historyCondition(attr: AttrDef, hf: HistoryField, c: Constraint): string {
    const values = c.operator === 'in' ? this.rawList(c) : [c.value];
    switch (hf.kind) {
      case 'uuid': {
        const lits = values.map((v) => uuidLit(this.uuidValue(v)));
        return lits.length === 1 ? `h.v_ref = ${lits[0]}` : `h.v_ref IN (${lits.join(', ')})`;
      }
      case 'lifecycle':
        return `h.v_ref IN (SELECT so.id FROM select_options so WHERE so.attribute_id = ${uuidLit(attr.id)} AND so.lifecycle_phase IN (${values.map((v) => this.lifecycle(v)).join(', ')}))`;
      case 'actor-type':
        return `h.v_text IN (${values.map((v) => this.actorType(v)).join(', ')})`;
      case 'timestamp': {
        const col = `h.${hf.column}`;
        if (c.operator === 'empty') return `${col} IS NULL`;
        if (c.operator === 'not-empty') return `${col} IS NOT NULL`;
        return `${col} ${SQL_OPS[c.operator as keyof typeof SQL_OPS]} ${this.timestamp(c.value)}`;
      }
    }
  }

  private recordIdCondition(alias: string, constraints: Constraint[]): string {
    if (constraints.length === 0) return 'TRUE';
    return `(${constraints
      .map((c) => {
        if (c.operator === 'eq') return `${alias}.instance_id = ${uuidLit(this.uuidValue(c.value))}`;
        if (c.operator === 'in') {
          return `${alias}.instance_id IN (${this.rawList(c)
            .map((v) => uuidLit(this.uuidValue(v)))
            .join(', ')})`;
        }
        if (c.operator === 'not-empty') return 'TRUE';
        if (c.operator === 'empty') return 'FALSE';
        throw unsupported(`Operator "${c.operator}" is not supported on record ids`);
      })
      .join(' AND ')})`;
  }

  /** One constraint on a scalar column reference (or an unnested element). */
  private condition(ref: string, attr: AttrDef, field: FieldSpec, c: Constraint): string {
    const value = this.valueExpr(ref, field);
    switch (c.operator) {
      case 'empty':
        return field.kind === 'rating' ? `coalesce(${ref}, 0) = 0` : `${value} IS NULL`;
      case 'not-empty':
        return field.kind === 'rating' ? `${ref} >= 1` : `${value} IS NOT NULL`;
      case 'in':
        return `${value} IN (${this.list(field, c, attr).join(', ')})`;
      case 'all':
        return this.list(field, c, attr)
          .map((lit) => `${value} = ${lit}`)
          .join(' AND ');
      case 'contains':
      case 'starts-with':
      case 'ends-with':
        return this.like(ref, field, c);
      default: {
        const op = SQL_OPS[c.operator as keyof typeof SQL_OPS];
        if (field.kind === 'boolean')
          return `coalesce(${ref}, false) ${op} ${this.literal(field, c.value, c.operator)}`;
        return `${value} ${op} ${this.literal(field, c.value, c.operator)}`;
      }
    }
  }

  /** contains / starts with / ends with on text-like fields (literal LIKE wildcards are escaped). */
  private like(ref: string, field: FieldSpec, c: Constraint): string {
    if (!TEXT_KINDS.has(field.kind)) throw unsupported(`Operator "${c.operator}" needs a text field`);
    const raw = this.text(c.value);
    let target = ref;
    let needle: string;
    if (field.kind === 'phone') {
      needle = strLit(likeEscape(raw.replace(/\D/g, '')));
      target = `ltrim(${ref}, '+')`;
      if (needle === "''") return 'FALSE';
    } else {
      const escaped = strLit(likeEscape(raw));
      needle = field.kind === 'text' ? `norm_key(${escaped})` : `lower(${escaped})`;
    }
    const pattern =
      c.operator === 'contains'
        ? `'%' || ${needle} || '%'`
        : c.operator === 'starts-with'
          ? `${needle} || '%'`
          : `'%' || ${needle}`;
    return `${target} LIKE ${pattern}`;
  }

  /** Column expression compared for a field (derived kinds look up the referenced option / record). */
  private valueExpr(ref: string, field: FieldSpec): string {
    switch (field.kind) {
      case 'option-order':
        return `(SELECT so.sort_order FROM select_options so WHERE so.id = ${ref})`;
      case 'lifecycle':
        return `(SELECT so.lifecycle_phase FROM select_options so WHERE so.id = ${ref})`;
      case 'ref-def':
        return `(SELECT ei.entity_definition_id FROM entity_instances ei WHERE ei.id = ${ref})`;
      default:
        return ref;
    }
  }

  private rawList(c: Constraint): unknown[] {
    if (!Array.isArray(c.value) || c.value.length === 0 || c.value.length > MAX_IN) {
      throw unsupported(`Operator "${c.operator}" expects a non-empty array of at most ${MAX_IN} values`);
    }
    return c.value;
  }

  private list(field: FieldSpec, c: Constraint, _attr: AttrDef): string[] {
    return this.rawList(c).map((v) => this.literal(field, v, 'eq'));
  }

  private text(value: unknown): string {
    if (typeof value !== 'string' && typeof value !== 'number') throw unsupported('Expected a text value');
    return String(value);
  }

  private uuidValue(value: unknown): string {
    const s = this.text(value);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw unsupported('Expected an id');
    return s;
  }

  private timestamp(value: unknown): string {
    const s = this.text(value);
    if (Number.isNaN(Date.parse(s))) throw unsupported('Expected a timestamp');
    return `${strLit(s)}::timestamptz`;
  }

  private lifecycle(value: unknown): string {
    const s = this.text(value).toUpperCase();
    if (!LIFECYCLE.has(s)) throw unsupported('Expected a lifecycle phase: ACTIVE, WON or LOST');
    return strLit(s);
  }

  private actorType(value: unknown): string {
    const s = this.text(value);
    if (!ACTOR_TYPES.has(s)) throw unsupported(`Unknown actor type "${s}"`);
    return strLit(s);
  }

  /** Typed SQL literal for a static constraint value. */
  private literal(field: FieldSpec, value: unknown, operator: string): string {
    switch (field.kind) {
      case 'text':
        return `norm_key(${strLit(this.text(value))})`;
      case 'email':
        return `lower(${strLit(this.text(value).trim())})`;
      case 'domain': {
        const s = this.text(value).trim();
        return strLit(operator === 'eq' ? (normalizeDomain(s)?.normalizedDomain ?? s.toLowerCase()) : s.toLowerCase());
      }
      case 'phone': {
        const s = this.text(value);
        const n = normalizePhone(s, null);
        return strLit(n.ok ? n.normalizedPhoneNumber : `+${s.replace(/\D/g, '')}`);
      }
      case 'country': {
        const s = this.text(value).toUpperCase();
        if (!/^[A-Z]{2}$/.test(s)) throw unsupported('Expected an ISO 3166-1 alpha-2 country code');
        return strLit(s);
      }
      case 'number':
      case 'rating': {
        const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
        if (typeof n !== 'number' || !Number.isFinite(n)) throw unsupported('Expected a number');
        return numLit(n);
      }
      case 'boolean': {
        const b = value === 'true' ? true : value === 'false' ? false : value;
        if (typeof b !== 'boolean') throw unsupported('Expected true or false');
        return b ? 'TRUE' : 'FALSE';
      }
      case 'date': {
        const s = this.text(value);
        if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw unsupported('Expected a date (YYYY-MM-DD)');
        return `${strLit(s.slice(0, 10))}::date`;
      }
      case 'timestamp':
        return this.timestamp(value);
      case 'uuid':
      case 'ref-def':
        return uuidLit(this.uuidValue(value));
      case 'option-order':
        return `(SELECT sort_order FROM select_options WHERE id = ${uuidLit(this.uuidValue(value))})`;
      case 'lifecycle':
        return this.lifecycle(value);
      case 'actor-type':
        return this.actorType(value);
    }
  }

  /**
   * The value at the end of a path, starting at `alias` on `def`: each relationship hop LEFT JOINs the target
   * projection on the first referenced record.
   */
  async pathValue(
    alias: string,
    def: DefInfo,
    path: { entityDefinitionId: string; attributeDefinitionId: string }[],
    fieldName: string | undefined | null,
    purpose: 'filter' | 'sort',
  ): Promise<PathValue> {
    const joins: string[] = [];
    let current = def;
    let at = alias;
    for (let i = 0; i < path.length - 1; i++) {
      const attr = attrAt(current, path[i] as { entityDefinitionId: string; attributeDefinitionId: string });
      if (attr.type !== 'entity-reference') {
        throw badRequest('UNSUPPORTED_SORT', 'Only record references can be traversed in a path');
      }
      const next = await loadDefinition(
        this.tx,
        (path[i + 1] as { entityDefinitionId: string; attributeDefinitionId: string }).entityDefinitionId,
      );
      if (!next.projectionTable) throw badRequest('UNSUPPORTED_SORT', 'The path leads to an object without records');
      const t = this.alias('j');
      const col = `${at}.${mainColumn(attr)}${attr.isMultiselect ? '[1]' : ''}`;
      joins.push(`LEFT JOIN ${projectionTableRef(next.projectionTable)} ${t} ON ${t}.instance_id = ${col}`);
      current = next;
      at = t;
    }
    const last = path[path.length - 1];
    if (!last) throw badRequest('VALIDATION_ERROR', 'Empty attribute path');
    const attr = attrAt(current, last);
    if (attr.systemAttributeType === 'id') return { joins, ref: `${at}.instance_id`, attr, field: null, multi: false };
    const field = resolveField(attr.type, fieldName, purpose);
    if (!field || (purpose === 'sort' && !field.sortable)) {
      throw badRequest(
        purpose === 'sort' ? 'UNSUPPORTED_SORT' : 'VALIDATION_ERROR',
        `Attribute "${attr.apiSlug}" cannot be ${purpose === 'sort' ? 'sorted' : 'used'} by "${fieldName ?? 'value'}"`,
      );
    }
    const column = projectionColumn(attr, field.suffix);
    if (!column) throw badRequest('UNSUPPORTED_SORT', `Attribute "${attr.apiSlug}" has no column for that field`);
    return { joins, ref: `${at}.${column.name}`, attr, field, multi: attr.isMultiselect };
  }

  /** ORDER BY items (+ joins) for the sorts. */
  async sorts(alias: string, def: DefInfo, sorts: Sort[]): Promise<{ joins: string[]; orderBy: string[] }> {
    const joins: string[] = [];
    const orderBy: string[] = [];
    for (const s of sorts) {
      if (s.path.length === 0) continue;
      const v = await this.pathValue(alias, def, s.path, s.field, 'sort');
      joins.push(...v.joins);
      const dir = s.direction === 'desc' ? 'DESC' : 'ASC';
      const ref = v.multi ? `${v.ref}[1]` : v.ref;
      const kind = v.field?.kind;
      if (kind === 'option-order') {
        const j = this.alias('s');
        joins.push(`LEFT JOIN select_options ${j} ON ${j}.id = ${ref}`);
        orderBy.push(`${j}.sort_order ${dir} NULLS LAST`);
      } else if (kind === 'boolean') {
        orderBy.push(`coalesce(${ref}, false) ${dir}`);
      } else if (v.field?.member) {
        // Members sort by name (`referenced_actor_id`); other actors after them, by id.
        const m = this.alias('m');
        joins.push(`LEFT JOIN workspace_members ${m} ON ${m}.id = ${ref}`);
        orderBy.push(`norm_key(${m}.first_name || ' ' || ${m}.last_name) COLLATE "C" ${dir} NULLS LAST`);
        orderBy.push(`${ref} ${dir} NULLS LAST`);
      } else {
        orderBy.push(`${ref} ${dir} NULLS LAST`);
      }
    }
    const first = sorts[0]?.direction === 'desc' ? 'DESC' : 'ASC';
    orderBy.push(`${alias}.instance_id ${first}`);
    return { joins, orderBy };
  }
}

const SQL_OPS = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

function mainColumn(attr: AttrDef): string {
  const col = projectionColumn(attr);
  if (!col) throw unsupported(`Attribute "${attr.apiSlug}" cannot be filtered`);
  return col.name;
}

/** "Has a value" on a column (ratings: 0 counts as empty, C1 filters-sorts-calcs §3). */
export function hasValue(ref: string, rating: boolean): string {
  return rating ? `(${ref} >= 1)` : `(${ref} IS NOT NULL)`;
}

/** WHERE clause of a resolved predicate on the projection aliased `p` (no predicate → TRUE). */
export async function whereClause(tx: Tx, def: DefInfo, predicate: Predicate | null): Promise<string> {
  if (!predicate) return 'TRUE';
  return new Compiler(tx).predicate('p', def, predicate);
}

/** The ordered id SELECT for a snapshot: `SELECT p.instance_id AS id FROM proj.p_x p … ORDER BY …`. */
export async function compileQuery(tx: Tx, def: DefInfo, predicate: Predicate | null, sorts: Sort[]): Promise<string> {
  if (!def.projectionTable) throw badRequest('VALIDATION_ERROR', 'This entity definition has no records');
  const compiler = new Compiler(tx);
  const where = predicate ? await compiler.predicate('p', def, predicate) : 'TRUE';
  const { joins, orderBy } = await compiler.sorts('p', def, sorts);
  return `SELECT p.instance_id AS id FROM ${projectionTableRef(def.projectionTable)} p ${joins.join(' ')} WHERE ${where} ORDER BY ${orderBy.join(', ')}`;
}
