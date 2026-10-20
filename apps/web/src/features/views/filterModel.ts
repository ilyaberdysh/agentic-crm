// The filter editing model (C1 filters-sorts-calcs §1–2, §6) and its mapping to the predicate AST.
//
// The bar and the advanced editor edit a tree of groups and conditions. Conditions may be incomplete (attribute picked,
// operator or value missing): they stay in the draft but are not part of the AST, so an incomplete draft never changes
// the results (§1 step 4). Leaves the operator table cannot display are kept verbatim (`raw`) so saving never loses
// them. The root is an AND group; plain conditions under it render as pills and at most one child group renders as the
// "Advanced filter {n}" pill — any other shape renders as one "Advanced filter" pill for the whole tree.
import type { AttributeDefinition, Constraint, Path, Predicate, PredicateLeaf } from '@agentic-crm/contracts';
import { buildLeaf, matchLeaf, type OperatorId } from './operators';
import type { FilterAst } from './types';

export interface ConditionNode {
  kind: 'condition';
  id: string;
  path: Path;
  /** The filter field (sub-field of multi-field types; the type's main field otherwise). */
  field: string | null;
  operator: OperatorId | null;
  value: unknown;
  /** A leaf kept verbatim: its attribute is gone or no operator of the table encodes it. */
  raw?: PredicateLeaf;
}

export interface GroupNode {
  kind: 'group';
  id: string;
  mode: 'and' | 'or';
  children: FilterNode[];
}

export type FilterNode = ConditionNode | GroupNode;
/** The root group of a filter. */
export type FilterModel = GroupNode;

/** Attribute at the end of a path (null when it no longer exists). */
export type LeafResolver = (
  path: Path,
) => Pick<AttributeDefinition, 'type' | 'isMultiselect' | 'systemAttributeType'> | null | undefined;

let seq = 0;
export function nodeId(prefix = 'n'): string {
  seq += 1;
  return `${prefix}${seq.toString(36)}`;
}

export function emptyFilterModel(): FilterModel {
  return { kind: 'group', id: nodeId('g'), mode: 'and', children: [] };
}

export function newCondition(path: Path, field: string | null, operator: OperatorId | null = null): ConditionNode {
  return { kind: 'condition', id: nodeId('c'), path, field, operator, value: undefined };
}

// ---- AST → model ------------------------------------------------------------------------------------------------

function isLeaf(p: Predicate): p is PredicateLeaf {
  return 'path' in p;
}

function parseNode(p: Predicate, resolve: LeafResolver): FilterNode {
  if (!isLeaf(p)) {
    const mode = 'and' in p ? 'and' : 'or';
    const children = 'and' in p ? p.and : p.or;
    return { kind: 'group', id: nodeId('g'), mode, children: children.map((c) => parseNode(c, resolve)) };
  }
  const attr = resolve(p.path);
  const hit = attr ? matchLeaf(attr, p) : null;
  if (!hit) {
    return { kind: 'condition', id: nodeId('c'), path: p.path, field: null, operator: null, value: undefined, raw: p };
  }
  return {
    kind: 'condition',
    id: nodeId('c'),
    path: p.path,
    field: hit.field,
    operator: hit.operator,
    value: hit.value,
  };
}

/** Parses a saved/drafted AST into the editing model (the root is always an AND or OR group). */
export function parseFilter(ast: FilterAst, resolve: LeafResolver): FilterModel {
  if (!ast) return emptyFilterModel();
  const node = parseNode(ast, resolve);
  if (node.kind === 'group') return node;
  return { kind: 'group', id: nodeId('g'), mode: 'and', children: [node] };
}

// ---- model → AST ------------------------------------------------------------------------------------------------

export function conditionLeaf(cond: ConditionNode, resolve: LeafResolver): PredicateLeaf | null {
  if (cond.raw) return cond.raw;
  if (!cond.operator) return null;
  const attr = resolve(cond.path);
  if (!attr) return null;
  return buildLeaf(attr, cond.path, cond.field, cond.operator, cond.value);
}

export function isConditionComplete(cond: ConditionNode, resolve: LeafResolver): boolean {
  return conditionLeaf(cond, resolve) !== null;
}

function buildNode(node: FilterNode, resolve: LeafResolver): Predicate | null {
  if (node.kind === 'condition') return conditionLeaf(node, resolve);
  const children = node.children.map((c) => buildNode(c, resolve)).filter((c): c is Predicate => c !== null);
  if (children.length === 0) return null;
  return node.mode === 'and' ? { and: children } : { or: children };
}

/** The AST of the complete conditions; `null` when nothing is complete. */
export function buildFilter(model: FilterModel, resolve: LeafResolver): FilterAst {
  return buildNode(model, resolve);
}

// ---- canonical form (dirty checks) --------------------------------------------------------------------------------

function canonicalConstraint(c: Constraint): Constraint {
  const out: Constraint = { field: c.field, operator: c.operator, valueType: c.valueType ?? 'static' };
  if (c.value !== undefined) out.value = c.value;
  return out;
}

function canonicalNode(p: Predicate): Predicate | null {
  if (isLeaf(p)) {
    return {
      path: p.path.map((h) => ({
        entityDefinitionId: h.entityDefinitionId,
        attributeDefinitionId: h.attributeDefinitionId,
      })),
      mode: p.mode,
      constraints: p.constraints
        .filter((c) => !(c.field === 'active_until' && c.operator === 'empty'))
        .map(canonicalConstraint),
      ...(p.history ? { history: true } : {}),
    };
  }
  const isAnd = 'and' in p;
  const children = (isAnd ? p.and : p.or).map(canonicalNode).filter((c): c is Predicate => c !== null);
  if (children.length === 0) return null;
  return isAnd ? { and: children } : { or: children };
}

/** Normalised AST: empty groups dropped, default value types explicit, `active_until` noise removed. */
export function canonicalFilter(ast: FilterAst | undefined): FilterAst {
  if (!ast) return null;
  return canonicalNode(ast);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function filterKey(ast: FilterAst | undefined): string {
  return stableStringify(canonicalFilter(ast));
}

export function sameFilter(a: FilterAst | undefined, b: FilterAst | undefined): boolean {
  return filterKey(a) === filterKey(b);
}

/** True when the AST holds relative dates or `current-member` (re-resolve hourly, C1 §4). */
export function hasDynamicValues(ast: FilterAst | undefined): boolean {
  if (!ast) return false;
  if (isLeaf(ast)) return ast.constraints.some((c) => c.valueType === 'dynamic');
  return ('and' in ast ? ast.and : ast.or).some(hasDynamicValues);
}

/** Paths referenced by an AST (schema loading for path filters). */
export function filterPaths(ast: FilterAst | undefined): Path[] {
  if (!ast) return [];
  if (isLeaf(ast)) return [ast.path];
  return ('and' in ast ? ast.and : ast.or).flatMap(filterPaths);
}

// ---- tree queries -------------------------------------------------------------------------------------------------

export function countConditions(node: FilterNode): number {
  return node.kind === 'condition' ? 1 : node.children.reduce((n, c) => n + countConditions(c), 0);
}

export function findNode(root: FilterNode, id: string): FilterNode | undefined {
  if (root.id === id) return root;
  if (root.kind === 'group') {
    for (const c of root.children) {
      const hit = findNode(c, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function findParent(root: GroupNode, id: string): GroupNode | undefined {
  for (const c of root.children) {
    if (c.id === id) return root;
    if (c.kind === 'group') {
      const hit = findParent(c, id);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Whether the root renders as pills plus at most one "Advanced filter n" pill (§1 pill rendering rule). */
export function isPillLayout(model: FilterModel): boolean {
  return model.mode === 'and' && model.children.filter((c) => c.kind === 'group').length <= 1;
}

export interface PillLayout {
  /** The group shown as the "Advanced filter" pill (the child group, or the whole root), if any. */
  advanced: GroupNode | null;
  /** Plain conditions shown as their own pills. */
  pills: ConditionNode[];
}

export function pillLayout(model: FilterModel): PillLayout {
  if (!isPillLayout(model)) return { advanced: model, pills: [] };
  const group = model.children.find((c): c is GroupNode => c.kind === 'group') ?? null;
  return { advanced: group, pills: model.children.filter((c): c is ConditionNode => c.kind === 'condition') };
}

/** First incomplete condition in the tree (the advanced editor disables "Add filter" while one exists). */
export function firstIncomplete(node: FilterNode, resolve: LeafResolver): ConditionNode | undefined {
  if (node.kind === 'condition') return isConditionComplete(node, resolve) ? undefined : node;
  for (const c of node.children) {
    const hit = firstIncomplete(c, resolve);
    if (hit) return hit;
  }
  return undefined;
}

// ---- immutable edits ------------------------------------------------------------------------------------------------

function mapTree(node: FilterNode, fn: (n: FilterNode) => FilterNode | null): FilterNode | null {
  const mapped = fn(node);
  if (!mapped || mapped.kind === 'condition') return mapped;
  const children = mapped.children.map((c) => mapTree(c, fn)).filter((c): c is FilterNode => c !== null);
  return { ...mapped, children };
}

/** Drops empty non-root groups (after deletes). */
function prune(root: GroupNode): GroupNode {
  const walk = (g: GroupNode): GroupNode => ({
    ...g,
    children: g.children
      .map((c) => (c.kind === 'group' ? walk(c) : c))
      .filter((c) => c.kind === 'condition' || c.children.length > 0),
  });
  return walk(root);
}

export function updateCondition(
  model: FilterModel,
  id: string,
  patch: Partial<Pick<ConditionNode, 'path' | 'field' | 'operator' | 'value'>>,
): FilterModel {
  return mapTree(model, (n) =>
    n.id === id && n.kind === 'condition' ? { ...n, ...patch, raw: undefined } : n,
  ) as FilterModel;
}

export function removeNode(model: FilterModel, id: string): FilterModel {
  if (model.id === id) return { ...model, children: [] };
  return prune(mapTree(model, (n) => (n.id === id ? null : n)) as FilterModel);
}

export function setGroupMode(model: FilterModel, groupId: string, mode: 'and' | 'or'): FilterModel {
  return mapTree(model, (n) => (n.id === groupId && n.kind === 'group' ? { ...n, mode } : n)) as FilterModel;
}

export function appendToGroup(model: FilterModel, groupId: string, node: FilterNode): FilterModel {
  return mapTree(model, (n) =>
    n.id === groupId && n.kind === 'group' ? { ...n, children: [...n.children, node] } : n,
  ) as FilterModel;
}

/** Adds a condition as a pill (root level). */
export function addCondition(model: FilterModel, cond: ConditionNode): FilterModel {
  return { ...model, children: [...model.children, cond] };
}

/**
 * "Convert to advanced filter" / "Add to advanced filter" (§1): moves a pill into the advanced group, creating the
 * group (placed first) when there is none. Returns the model and the group id.
 */
export function moveToAdvanced(model: FilterModel, conditionId: string): { model: FilterModel; groupId: string } {
  const cond = model.children.find((c) => c.id === conditionId);
  if (!cond || cond.kind !== 'condition') return { model, groupId: model.id };
  const rest = model.children.filter((c) => c.id !== conditionId);
  const existing = rest.find((c): c is GroupNode => c.kind === 'group');
  if (existing) {
    const group: GroupNode = { ...existing, children: [...existing.children, cond] };
    return { model: { ...model, children: rest.map((c) => (c.id === existing.id ? group : c)) }, groupId: group.id };
  }
  const group: GroupNode = { kind: 'group', id: nodeId('g'), mode: 'and', children: [cond] };
  return { model: { ...model, children: [group, ...rest] }, groupId: group.id };
}

/** "Convert to group" (§2 row menu, depth 0): wraps a condition into a nested AND group. */
export function wrapInGroup(model: FilterModel, conditionId: string): FilterModel {
  const walk = (g: GroupNode): GroupNode => ({
    ...g,
    children: g.children.map((c) =>
      c.kind === 'group'
        ? walk(c)
        : c.id === conditionId
          ? ({ kind: 'group', id: nodeId('g'), mode: 'and', children: [c] } satisfies GroupNode)
          : c,
    ),
  });
  return walk(model);
}

/** "Clear all filters" inside the advanced editor: removes the advanced group (or empties the root). */
export function clearGroup(model: FilterModel, groupId: string): FilterModel {
  if (model.id === groupId) return { ...model, children: [] };
  return removeNode(model, groupId);
}

/** Depth of a node below the root (pills and the advanced group's direct rows are 1 and 2). */
export function depthOf(root: GroupNode, id: string, depth = 0): number {
  for (const c of root.children) {
    if (c.id === id) return depth + 1;
    if (c.kind === 'group') {
      const d = depthOf(c, id, depth + 1);
      if (d >= 0) return d;
    }
  }
  return -1;
}
