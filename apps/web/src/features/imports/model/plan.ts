// Import plan (C2 import.md §I5, §I9): one strategy per object the import writes — the destination, each linked object
// reached through a relationship column (Client › Domains), or for lists the entries plus the parent object — with the
// unique attribute rows are matched by, and per row the outcome (create / update / skip) and the values to write.
// Pure; the fake backend runs the existing-record lookups and hands the results in.
import type { AttributeDefinition, Path, PathHop } from '@agentic-crm/contracts';
import { normalizeDomain, normalizeEmail, normalizePhone } from '../../attributes/values/normalize';
import type { SchemaIndex } from '../../views/schemaIndex';
import type {
  ImportJob,
  ImportPlan,
  InvalidRow,
  ListStrategy,
  MappingProperty,
  PlanOutcome,
  PlanRow,
  PlanStrategy,
} from '../data/contract';
import { isListDestination, parentRecordAttribute } from './mapping';
import { isIdAttribute } from './resolve';

export interface StrategyShape {
  /** 'root', 'parent' (list's parent object) or `link:<attributeId>`. */
  id: string;
  entityDefinitionId: string;
  kind: 'records' | 'entries';
  /** Hop from the destination to this object (null for the destination). */
  path: Path | null;
  /** Destination attribute pointing at this object's records (linked / parent strategies). */
  linkAttribute: AttributeDefinition | null;
  properties: MappingProperty[];
  matching: MappingProperty | null;
  matchingAttribute: AttributeDefinition | null;
}

const leafOf = (index: SchemaIndex, p: MappingProperty) => index.attribute(p.path[p.path.length - 1] as PathHop);

function pickMatching(index: SchemaIndex, properties: MappingProperty[]) {
  const scored = properties
    .map((p) => ({ p, a: leafOf(index, p) }))
    .filter((x): x is { p: MappingProperty; a: AttributeDefinition } =>
      Boolean(x.a?.isUnique || (x.a && isIdAttribute(x.a))),
    );
  // Record ID / Entry ID first, then the first unique attribute in column order.
  const best = scored.find((x) => isIdAttribute(x.a)) ?? scored[0];
  return { matching: best?.p ?? null, matchingAttribute: best?.a ?? null };
}

/** Strategies of a job in tab order (destination / entries first). */
export function planShapes(
  job: Pick<ImportJob, 'mapping' | 'entityDefinitionId'>,
  index: SchemaIndex,
): StrategyShape[] {
  const destination = index.definition(job.entityDefinitionId);
  const list = isListDestination(destination);
  const parent = list ? parentRecordAttribute(index, job.entityDefinitionId) : undefined;
  const rootProps = job.mapping.filter((p) => p.path.length === 1);
  const root: StrategyShape = {
    id: 'root',
    entityDefinitionId: job.entityDefinitionId,
    kind: list ? 'entries' : 'records',
    path: null,
    linkAttribute: null,
    properties: rootProps,
    ...pickMatching(index, rootProps),
  };
  const shapes: StrategyShape[] = [root];
  const groups = new Map<string, MappingProperty[]>();
  for (const p of job.mapping) {
    if (p.path.length !== 2) continue;
    const hop = p.path[0] as PathHop;
    groups.set(hop.attributeDefinitionId, [...(groups.get(hop.attributeDefinitionId) ?? []), p]);
  }
  for (const [attributeId, properties] of groups) {
    const first = properties[0] as MappingProperty;
    const link = index.attribute(first.path[0] as PathHop);
    const target = link ? index.targetOf(link) : null;
    if (!link || !target) continue;
    const isParent = Boolean(parent && parent.id === attributeId);
    shapes.push({
      id: isParent ? 'parent' : `link:${attributeId}`,
      entityDefinitionId: target,
      kind: 'records',
      path: [first.path[0] as PathHop],
      linkAttribute: link,
      properties,
      ...pickMatching(index, properties),
    });
  }
  return shapes;
}

/** Comparable key of a matching value (case / format insensitive like the server's unique lookups). */
export function matchKey(attribute: AttributeDefinition, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (isIdAttribute(attribute)) return String(value).toLowerCase();
  switch (attribute.type) {
    case 'email-address': {
      const e = normalizeEmail(
        typeof value === 'string' ? value : String((value as { emailAddress?: string }).emailAddress ?? ''),
      );
      return e ? e.normalizedEmailAddress : null;
    }
    case 'domain': {
      const d = normalizeDomain(
        typeof value === 'string' ? value : String((value as { domain?: string }).domain ?? ''),
      );
      return d ? d.normalizedDomain : null;
    }
    case 'phone-number': {
      const v = value as { originalPhoneNumber?: string; countryCode?: string | null } | string;
      const r =
        typeof v === 'string' ? normalizePhone(v, null) : normalizePhone(v.originalPhoneNumber ?? '', v.countryCode);
      return r.ok ? r.normalizedPhoneNumber : null;
    }
    case 'number':
      return typeof value === 'number' ? String(value) : null;
    default:
      return typeof value === 'string' ? value.trim().toLowerCase() : JSON.stringify(value);
  }
}

/** Values of several columns writing one attribute: name parts merge, single-value attributes keep the first. */
export function mergeValues(attribute: AttributeDefinition, lists: unknown[][]): unknown[] {
  const all = lists.flat();
  if (all.length === 0) return [];
  if (attribute.type === 'personal-name') {
    const name = { firstName: '', lastName: '', fullName: '' };
    for (const v of all) {
      const part = v as { firstName?: string; lastName?: string; fullName?: string };
      if (part.firstName) name.firstName = part.firstName;
      if (part.lastName) name.lastName = part.lastName;
      if (part.fullName) name.fullName = part.fullName;
    }
    if (!name.fullName) name.fullName = [name.firstName, name.lastName].filter(Boolean).join(' ');
    return name.fullName ? [name] : [];
  }
  const multi = attribute.isMultiselect || ['domain', 'email-address', 'phone-number'].includes(attribute.type);
  if (!multi) return all.slice(0, 1);
  const seen = new Set<string>();
  return all.filter((v) => {
    const k = JSON.stringify(v);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface PlanContext {
  rows: readonly string[][];
  /** Effective write-form values of a cell (overrides applied; unknown options and invalid values dropped). */
  valuesFor(property: MappingProperty, raw: string): unknown[];
  /** Messages of a cell that needs review ("Invalid number", "Value doesn't exist…"). */
  issuesFor(property: MappingProperty, raw: string): string[];
  /** Existing records per strategy id: match key → instance id. */
  existing: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** List imports: existing entry of a parent record (Update existing). */
  existingEntries?: ReadonlyMap<string, string>;
  listStrategy: ListStrategy;
  columnTitle(columnIndex: number): string;
}

/** The row's value per attribute id of a strategy. */
function rowValues(index: SchemaIndex, shape: StrategyShape, row: readonly string[], ctx: PlanContext) {
  const byAttr = new Map<string, { attribute: AttributeDefinition; lists: unknown[][] }>();
  for (const p of shape.properties) {
    const attribute = leafOf(index, p);
    if (!attribute) continue;
    const entry = byAttr.get(attribute.id) ?? { attribute, lists: [] };
    entry.lists.push(ctx.valuesFor(p, row[p.columnIndex] ?? ''));
    byAttr.set(attribute.id, entry);
  }
  const out: Record<string, unknown[]> = {};
  for (const [id, { attribute, lists }] of byAttr) {
    const merged = mergeValues(attribute, lists);
    if (merged.length > 0) out[id] = merged;
  }
  return out;
}

function matchOf(shape: StrategyShape, values: Record<string, unknown[]>): string | null {
  if (!shape.matchingAttribute) return null;
  return matchKey(shape.matchingAttribute, values[shape.matchingAttribute.id]?.[0]);
}

/** Match keys of every row for one strategy (what the caller looks up before `buildPlan`). */
export function matchKeysOf(index: SchemaIndex, shape: StrategyShape, ctx: Pick<PlanContext, 'rows' | 'valuesFor'>) {
  const keys = new Set<string>();
  if (!shape.matchingAttribute) return keys;
  for (const row of ctx.rows) {
    const values = rowValues(index, shape, row, {
      ...ctx,
      issuesFor: () => [],
      existing: new Map(),
      listStrategy: 'create',
      columnTitle: () => '',
    });
    const k = matchOf(shape, values);
    if (k) keys.add(k);
  }
  return keys;
}

const empty = (o: Record<string, unknown[]>) => Object.keys(o).length === 0;

/** The full plan (every row) — the backend pages `rows` per strategy. */
export function buildPlan(index: SchemaIndex, shapes: StrategyShape[], ctx: PlanContext): ImportPlan {
  const root = shapes[0] as StrategyShape;
  const others = shapes.slice(1);
  const rowsByShape = new Map<string, PlanRow[]>(shapes.map((s) => [s.id, []]));
  const invalidRows: InvalidRow[] = [];

  ctx.rows.forEach((row, r) => {
    const linked = new Map<string, { outcome: PlanOutcome; id: string | null }>();
    for (const shape of others) {
      const values = rowValues(index, shape, row, ctx);
      const key = matchOf(shape, values);
      const existing = key ? ctx.existing.get(shape.id)?.get(key) : undefined;
      const outcome: PlanOutcome = empty(values) ? 'skip' : existing ? 'update' : 'create';
      linked.set(shape.id, { outcome, id: existing ?? null });
      rowsByShape.get(shape.id)?.push({
        row: r,
        outcome,
        entityInstanceId: existing ?? null,
        values,
        status: 'planned',
        failureReason: null,
      });
    }
    const values = rowValues(index, root, row, ctx);
    // Linked / parent records referenced by the root row.
    for (const shape of others) {
      const l = linked.get(shape.id);
      if (!shape.linkAttribute || !l || l.outcome === 'skip') continue;
      if (l.id)
        values[shape.linkAttribute.id] = [{ entityInstanceId: l.id, entityDefinitionId: shape.entityDefinitionId }];
    }
    let outcome: PlanOutcome;
    let entityInstanceId: string | null = null;
    const hasLinked = others.some((s) => linked.get(s.id)?.outcome !== 'skip');
    if (root.kind === 'entries') {
      const parent = others.find((s) => s.id === 'parent');
      const p = parent ? linked.get(parent.id) : undefined;
      const entryKey = matchOf(root, values);
      const byId = entryKey ? ctx.existing.get(root.id)?.get(entryKey) : undefined;
      if (byId) {
        outcome = 'update';
        entityInstanceId = byId;
      } else if (!p || p.outcome === 'skip') {
        outcome = 'skip';
      } else if (ctx.listStrategy === 'create-or-update' && p.id && ctx.existingEntries?.get(p.id)) {
        outcome = 'update';
        entityInstanceId = ctx.existingEntries.get(p.id) ?? null;
      } else outcome = 'create';
    } else {
      const key = matchOf(root, values);
      const existing = key ? ctx.existing.get(root.id)?.get(key) : undefined;
      if (empty(values) && !hasLinked) outcome = 'skip';
      else if (existing) {
        outcome = 'update';
        entityInstanceId = existing;
      } else outcome = 'create';
    }
    rowsByShape
      .get(root.id)
      ?.push({ row: r, outcome, entityInstanceId, values, status: 'planned', failureReason: null });

    const issues: string[] = [];
    for (const p of [...root.properties, ...others.flatMap((s) => s.properties)]) {
      for (const message of ctx.issuesFor(p, row[p.columnIndex] ?? ''))
        issues.push(`${ctx.columnTitle(p.columnIndex)}: ${message}`);
    }
    if (outcome === 'skip') {
      invalidRows.push({
        row: r,
        reason:
          root.kind === 'entries' ? 'No parent record to add to the list' : 'Every mapped value is empty or invalid',
      });
    } else if (issues.length > 0) invalidRows.push({ row: r, reason: issues.join(' · ') });
  });

  const strategies: PlanStrategy[] = shapes.map((shape) => {
    const rows = rowsByShape.get(shape.id) ?? [];
    const counts = { create: 0, update: 0, skip: 0 };
    for (const row of rows) counts[row.outcome] += 1;
    const attributeIds: string[] = [];
    for (const p of shape.properties) {
      const id = (p.path[p.path.length - 1] as PathHop).attributeDefinitionId;
      if (!attributeIds.includes(id)) attributeIds.push(id);
    }
    if (shape.kind === 'entries') {
      const parent = others.find((s) => s.id === 'parent');
      if (parent?.linkAttribute) attributeIds.unshift(parent.linkAttribute.id);
    }
    return {
      id: shape.id,
      entityDefinitionId: shape.entityDefinitionId,
      kind: shape.kind,
      path: shape.path,
      matchingAttributeId: shape.matchingAttribute?.id ?? null,
      attributeIds,
      counts,
      total: rows.length,
      rows,
    };
  });
  return { status: 'ready', strategies, invalidRows };
}
