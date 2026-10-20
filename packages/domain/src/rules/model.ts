// Requirement rules: storage shape, the requirement → filter-leaf translation and the violation messages
// (J permissions §7, A §4.13: "is required" = must have a value, "must be empty" = must-not, comparisons = must +
// {operator, field: value, value}).
import type { Predicate, PredicateLeaf, Requirement, RequirementOperator, Rule } from '@agentic-crm/contracts';
import type { AttrDef, DefInfo } from '../schema/model.ts';
import type { Tx } from '../tx.ts';

export interface RuleRow {
  id: string;
  entity_definition_id: string;
  name: string;
  sort_order: string;
  condition: unknown;
  requirements: unknown;
  applies_to: unknown;
  created_by: unknown;
  created_at: string;
  updated_at: string;
}

export function toRule(r: RuleRow): Rule {
  return {
    id: r.id,
    entityDefinitionId: r.entity_definition_id,
    name: r.name,
    sortOrder: r.sort_order,
    condition: (r.condition ?? null) as Predicate | null,
    requirements: (r.requirements ?? []) as Requirement[],
    appliesTo: (r.applies_to ?? [{ type: 'all-workspace-members' }]) as Rule['appliesTo'],
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The filter leaf a requirement demands of a record (its negation finds the violators). */
export function requirementLeaf(def: DefInfo, req: Requirement): PredicateLeaf {
  const path = [{ entityDefinitionId: def.id, attributeDefinitionId: req.attributeDefinitionId }];
  switch (req.operator) {
    case 'required':
      return { path, mode: 'must', constraints: [{ field: 'value', operator: 'not-empty' }] };
    case 'empty':
      return { path, mode: 'must-not', constraints: [{ field: 'value', operator: 'not-empty' }] };
    default:
      return { path, mode: 'must', constraints: [{ field: 'value', operator: req.operator, value: req.value }] };
  }
}

/** NOT leaf: `must` (some value satisfies all constraints) ↔ `must-not` (no value does). */
export function negate(leaf: PredicateLeaf): PredicateLeaf {
  return { ...leaf, mode: leaf.mode === 'must' ? 'must-not' : 'must' };
}

const DATE_TYPES = new Set(['date', 'timestamp']);
const ORDERED_TYPES = new Set(['number', 'currency', 'rating', 'date', 'timestamp']);

/** Operators a requirement may use on an attribute type ("must be (or) greater than" only on ordered types). */
export function requirementAllowed(attr: AttrDef, operator: RequirementOperator): boolean {
  if (operator === 'required' || operator === 'empty') return true;
  if (operator === 'eq') return attr.type !== 'interaction';
  return ORDERED_TYPES.has(attr.type);
}

/** "Must have a value", "Must be empty", "Must be greater than 10", "Must be on or after 2026-01-01", … */
export function violationMessage(attr: AttrDef, operator: RequirementOperator, display: string): string {
  const date = DATE_TYPES.has(attr.type);
  switch (operator) {
    case 'required':
      return 'Must have a value';
    case 'empty':
      return 'Must be empty';
    case 'eq':
      return date ? `Must be on ${display}` : `Must be ${display}`;
    case 'gt':
      return date ? `Must be after ${display}` : `Must be greater than ${display}`;
    case 'gte':
      return date ? `Must be on or after ${display}` : `Must be greater than or equal to ${display}`;
    case 'lt':
      return date ? `Must be before ${display}` : `Must be less than ${display}`;
    case 'lte':
      return date ? `Must be on or before ${display}` : `Must be less than or equal to ${display}`;
  }
}

/** A requirement value as people read it (option / status titles instead of ids). */
export async function displayValue(tx: Tx, attr: AttrDef, value: unknown): Promise<string> {
  if (value === undefined || value === null) return '';
  if ((attr.type === 'select' || attr.type === 'pipeline') && typeof value === 'string') {
    const row = await tx.db.selectFrom('select_options').select('title').where('id', '=', value).executeTakeFirst();
    if (row) return row.title;
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const memoKey = (defId: string) => `rules:${defId}`;

/** Live rules of a definition in order (memoised per transaction; writers call forgetRules). */
export async function liveRules(tx: Tx, defId: string): Promise<Rule[]> {
  const cached = tx.memo.get(memoKey(defId)) as Rule[] | undefined;
  if (cached) return cached;
  const rows = await tx.db
    .selectFrom('requirement_rules')
    .selectAll()
    .where('entity_definition_id', '=', defId)
    .where('deleted_at', 'is', null)
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
  const rules = rows.map(toRule);
  tx.memo.set(memoKey(defId), rules);
  return rules;
}

export function forgetRules(tx: Tx): void {
  for (const key of [...tx.memo.keys()]) if (key.startsWith('rules:')) tx.memo.delete(key);
}
