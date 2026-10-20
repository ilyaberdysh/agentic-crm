// Resolution of a predicate before compilation: walks every leaf's path (validating the hops), and replaces dynamic
// values with static ones so the compiled SQL and the snapshot's stored predicate are fixed at `now`:
//   • date        ISO-8601 duration → the local calendar date of now + duration in the viewer's zone
//   • timestamp   duration → now + duration floored to the local hour; `eq` → that whole local day
//                 static 'YYYY-MM-DD' → compares by local day (eq: [start, end); gt: >= end; lte: < end; …)
//   • member ids  'current-member' → the acting member (no member → an id that matches nothing)
//   • ref-def     an object's api slug → its id
// Aggregates re-evaluate the stored resolved predicate (S1 rule 6), so they need neither the zone nor the member.
import type { Constraint, Predicate, PredicateLeaf } from '@agentic-crm/contracts';
import { badRequest } from '../errors.ts';
import { type AttrDef, type DefInfo, isUuid, loadDefinition } from '../schema/model.ts';
import { isIsoDuration, isValidTimeZone, localDayBounds, relativeInstant, relativeLocalDate } from '../time.ts';
import type { Tx } from '../tx.ts';
import { type FieldKind, HISTORY_TYPES, resolveField, resolveHistoryField } from './operators.ts';

export interface ResolveEnv {
  /** Reference instant (the snapshot's accurate_at). */
  now: string;
  /** IANA zone of the viewer. */
  timeZone: string;
  /** Member id for 'current-member' (null for non-member actors). */
  memberId: string | null;
}

/** Matches no member: 'current-member' for an API token or the system. */
export const NO_MEMBER = '00000000-0000-0000-0000-000000000000';
export const MAX_PATH_HOPS = 5;
const MAX_DEPTH = 6;
const MAX_LEAVES = 200;

const unsupported = (message: string, details?: Record<string, unknown>) =>
  badRequest('UNSUPPORTED_FILTER', message, details);

export function assertTimeZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) throw badRequest('VALIDATION_ERROR', `Unknown time zone "${timeZone}"`);
}

/** The attribute at a hop of `def` (the hop must name `def`). */
export function attrAt(def: DefInfo, hop: { entityDefinitionId: string; attributeDefinitionId: string }): AttrDef {
  if (hop.entityDefinitionId !== def.id) {
    throw unsupported('Attribute path does not continue at this object', {
      entity_definition_id: hop.entityDefinitionId,
    });
  }
  const attr = def.byId.get(hop.attributeDefinitionId);
  if (!attr) throw unsupported('Unknown attribute in path', { attribute_definition_id: hop.attributeDefinitionId });
  return attr;
}

/**
 * Walks a path from `def`: every hop but the last must be a record reference (relationship) whose next hop names a
 * definition it may reference. Returns the definitions and attributes along the path.
 */
export async function walkPath(
  tx: Tx,
  def: DefInfo,
  path: { entityDefinitionId: string; attributeDefinitionId: string }[],
): Promise<{ defs: DefInfo[]; attrs: AttrDef[] }> {
  if (path.length === 0) throw unsupported('Empty attribute path');
  if (path.length > MAX_PATH_HOPS) throw unsupported(`A path can have at most ${MAX_PATH_HOPS} hops`);
  const defs: DefInfo[] = [];
  const attrs: AttrDef[] = [];
  let current = def;
  for (let i = 0; i < path.length; i++) {
    const hop = path[i] as { entityDefinitionId: string; attributeDefinitionId: string };
    const attr = attrAt(current, hop);
    defs.push(current);
    attrs.push(attr);
    const next = path[i + 1];
    if (!next) break;
    if (attr.type !== 'entity-reference') {
      throw unsupported(`Only record references can be traversed in a path ("${attr.apiSlug}" is ${attr.type})`);
    }
    const allowed = attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null;
    const target = attr.relatedEntityDefinitionId ? [attr.relatedEntityDefinitionId] : allowed;
    if (target && target.length > 0 && !target.includes(next.entityDefinitionId)) {
      throw unsupported(`"${attr.apiSlug}" cannot reference that object`, {
        entity_definition_id: next.entityDefinitionId,
      });
    }
    current = await loadDefinition(tx, next.entityDefinitionId);
    if (!current.projectionTable) throw unsupported('The path leads to an object without records');
  }
  return { defs, attrs };
}

class Resolver {
  private leaves = 0;
  constructor(
    private readonly tx: Tx,
    private readonly env: ResolveEnv,
  ) {}

  async predicate(def: DefInfo, p: Predicate, depth = 0): Promise<Predicate> {
    if (depth > MAX_DEPTH) throw unsupported('Filter is nested too deeply');
    if ('and' in p) return { and: await Promise.all(p.and.map((c) => this.predicate(def, c, depth + 1))) };
    if ('or' in p) return { or: await Promise.all(p.or.map((c) => this.predicate(def, c, depth + 1))) };
    if (++this.leaves > MAX_LEAVES) throw unsupported(`A filter can have at most ${MAX_LEAVES} conditions`);
    return this.leaf(def, p);
  }

  private async leaf(def: DefInfo, leaf: PredicateLeaf): Promise<PredicateLeaf> {
    const { attrs } = await walkPath(this.tx, def, leaf.path);
    const attr = attrs[attrs.length - 1] as AttrDef;
    const history = leaf.history === true;
    if (history && !HISTORY_TYPES.has(attr.type)) {
      throw unsupported(`History filters ("was") are not available on ${attr.type} attribute "${attr.apiSlug}"`);
    }
    const constraints: Constraint[] = [];
    for (const c of leaf.constraints) {
      // The implicit `active_until empty` is dropped for current-value leaves.
      if (!history && c.field === 'active_until') continue;
      constraints.push(...(await this.constraint(attr, history, c)));
    }
    return { path: leaf.path, mode: leaf.mode, constraints, ...(history ? { history: true } : {}) };
  }

  private kindOf(attr: AttrDef, history: boolean, c: Constraint): { kind: FieldKind; member: boolean } {
    if (attr.systemAttributeType === 'id') return { kind: 'uuid', member: false };
    if (history) {
      const h = resolveHistoryField(attr.type, c.field);
      if (!h) throw unsupported(`Field "${c.field}" cannot be used in a history filter on "${attr.apiSlug}"`);
      return { kind: h.kind, member: h.kind === 'uuid' && h.member };
    }
    const field = resolveField(attr.type, c.field, 'filter');
    if (!field) throw unsupported(`Unknown field "${c.field}" for ${attr.type} attribute "${attr.apiSlug}"`);
    return { kind: field.kind, member: field.member === true };
  }

  private async constraint(attr: AttrDef, history: boolean, c: Constraint): Promise<Constraint[]> {
    const { kind, member } = this.kindOf(attr, history, c);
    const dynamic = c.valueType === 'dynamic';
    const out = (value: unknown, operator = c.operator): Constraint => ({
      field: c.field,
      operator,
      ...(value === undefined ? {} : { value }),
      valueType: 'static',
    });
    if (c.operator === 'empty' || c.operator === 'not-empty') return [out(undefined)];
    switch (kind) {
      case 'date': {
        if (!dynamic) return [out(c.value)];
        return [
          out(this.mapValues(c.value, (v) => relativeLocalDate(this.env.now, this.duration(v), this.env.timeZone))),
        ];
      }
      case 'timestamp': {
        if (dynamic) {
          if (c.operator === 'eq') {
            const day = relativeLocalDate(this.env.now, this.duration(c.value), this.env.timeZone);
            return this.dayRange(c, day);
          }
          return [
            out(this.mapValues(c.value, (v) => relativeInstant(this.env.now, this.duration(v), this.env.timeZone))),
          ];
        }
        if (typeof c.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.value)) return this.dayRange(c, c.value);
        return [out(c.value)];
      }
      case 'uuid': {
        if (!member) {
          if (dynamic) throw unsupported(`Dynamic values are not supported on "${attr.apiSlug}"`);
          return [out(c.value)];
        }
        return [
          out(
            this.mapValues(c.value, (v) => {
              if (v === 'current-member') return this.env.memberId ?? NO_MEMBER;
              // A dynamic list may mix 'current-member' with member ids.
              if (dynamic && !(typeof v === 'string' && isUuid(v))) {
                throw unsupported(`Unknown dynamic value "${String(v)}"`);
              }
              return v;
            }),
          ),
        ];
      }
      case 'ref-def': {
        const resolved: unknown[] = [];
        for (const v of Array.isArray(c.value) ? c.value : [c.value]) {
          if (typeof v === 'string' && !isUuid(v)) resolved.push((await loadDefinition(this.tx, v)).id);
          else resolved.push(v);
        }
        return [out(Array.isArray(c.value) ? resolved : resolved[0])];
      }
      default:
        if (dynamic) throw unsupported(`Dynamic values are not supported on "${attr.apiSlug}"`);
        return [out(c.value)];
    }
  }

  private duration(v: unknown): string {
    if (typeof v !== 'string' || !isIsoDuration(v)) throw unsupported('Relative dates are ISO-8601 durations');
    return v;
  }

  private mapValues(value: unknown, fn: (v: unknown) => unknown): unknown {
    return Array.isArray(value) ? value.map(fn) : fn(value);
  }

  /** A timestamp constraint against a whole local day. */
  private dayRange(c: Constraint, day: string): Constraint[] {
    const { start, end } = localDayBounds(day, this.env.timeZone);
    const k = (operator: Constraint['operator'], value: string): Constraint => ({
      field: c.field,
      operator,
      value,
      valueType: 'static',
    });
    switch (c.operator) {
      case 'eq':
        return [k('gte', start), k('lt', end)];
      case 'gt':
        return [k('gte', end)];
      case 'gte':
        return [k('gte', start)];
      case 'lt':
        return [k('lt', start)];
      case 'lte':
        return [k('lt', end)];
      default:
        throw unsupported(`Operator "${c.operator}" does not take a date on a timestamp`);
    }
  }
}

/** Resolves dynamic values and validates paths; the result contains static values only. */
export async function resolvePredicate(
  tx: Tx,
  def: DefInfo,
  predicate: Predicate | null,
  env: ResolveEnv,
): Promise<Predicate | null> {
  if (!predicate) return null;
  assertTimeZone(env.timeZone);
  return new Resolver(tx, env).predicate(def, predicate);
}

/** Whether a (resolved) predicate has history leaves (they read the EAV: S1 rule 7 applies). */
export function hasHistoryLeaf(p: Predicate | null): boolean {
  if (!p) return false;
  if ('and' in p) return p.and.some(hasHistoryLeaf);
  if ('or' in p) return p.or.some(hasHistoryLeaf);
  return p.history === true;
}
