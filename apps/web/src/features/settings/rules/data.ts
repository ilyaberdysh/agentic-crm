// Requirement rules data (BACKLOG 6.06; J objects-lists §3.2, J permissions §7): `rules.*` for one object, and the
// requirement vocabulary of the editor ("is required", "must be empty", "must be (or) greater / less than", dates:
// before / after) with the value conversions between the filter value editors and the stored requirement values.
import type {
  AttributeDefinition,
  CreateRuleInput,
  RequirementOperator,
  Rule,
  UpdateRuleInput,
} from '@agentic-crm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../../data/keys';
import { queryClient } from '../../../data/queryClient';
import { api, inWorkspace, type WorkspaceRef } from '../../../data/trpc';
import type { ActorValue, RecordValue, ValueKind } from '../../views/operators';
import { written } from '../admin/parts';

export const rulesQuery = (ws: WorkspaceRef, entityDefinitionId: string) =>
  queryOptions({
    queryKey: keys.rules(ws.id, entityDefinitionId),
    queryFn: () => api.rules.list.query({ entityDefinitionId }, inWorkspace(ws)) as Promise<Rule[]>,
  });

export function useRules(ws: WorkspaceRef, entityDefinitionId: string | null | undefined) {
  return useQuery({ ...rulesQuery(ws, entityDefinitionId ?? ''), enabled: Boolean(entityDefinitionId) });
}

function refresh(ws: WorkspaceRef, entityDefinitionId: string) {
  void queryClient.invalidateQueries({ queryKey: keys.rules(ws.id, entityDefinitionId) });
}

export async function createRule(ws: WorkspaceRef, input: CreateRuleInput): Promise<Rule> {
  const { rule } = await written(ws, api.rules.create.mutate(input, inWorkspace(ws)));
  refresh(ws, String(input.entityDefinitionId));
  return rule as Rule;
}

export async function updateRule(ws: WorkspaceRef, entityDefinitionId: string, input: UpdateRuleInput): Promise<Rule> {
  const { rule } = await written(ws, api.rules.update.mutate(input, inWorkspace(ws)));
  refresh(ws, entityDefinitionId);
  return rule as Rule;
}

export async function deleteRule(ws: WorkspaceRef, entityDefinitionId: string, ruleId: string) {
  await written(ws, api.rules.delete.mutate({ ruleId }, inWorkspace(ws)));
  refresh(ws, entityDefinitionId);
}

// ---- requirement vocabulary ----------------------------------------------------------------------------------------

const ORDERED = new Set(['number', 'currency', 'rating', 'date', 'timestamp']);
const DATES = new Set(['date', 'timestamp']);

export const isDateAttribute = (a: Pick<AttributeDefinition, 'type'>) => DATES.has(a.type);

/** Requirement operators an attribute offers (the server rejects the others), in menu order. */
export function requirementOperatorsFor(attribute: Pick<AttributeDefinition, 'type'> | null): RequirementOperator[] {
  if (!attribute) return ['required', 'empty', 'eq', 'lt', 'lte', 'gt', 'gte'];
  const ops: RequirementOperator[] = ['required', 'empty'];
  if (attribute.type !== 'interaction') ops.push('eq');
  if (ORDERED.has(attribute.type)) ops.push('lt', 'lte', 'gt', 'gte');
  return ops;
}

const LABELS: Record<RequirementOperator, string> = {
  required: 'is required',
  empty: 'must be empty',
  eq: 'must be',
  lt: 'must be less than',
  lte: 'must be or less than',
  gt: 'must be greater than',
  gte: 'must be or greater than',
};
const DATE_LABELS: Partial<Record<RequirementOperator, string>> = {
  lt: 'must be before',
  lte: 'must be on or before',
  gt: 'must be after',
  gte: 'must be on or after',
};

export function requirementLabel(
  operator: RequirementOperator,
  attribute: Pick<AttributeDefinition, 'type'> | null,
): string {
  return (attribute && isDateAttribute(attribute) ? DATE_LABELS[operator] : undefined) ?? LABELS[operator];
}

/** True when the operator takes a value. */
export const needsValue = (operator: RequirementOperator) => operator !== 'required' && operator !== 'empty';

/** The value editor a requirement on this attribute uses (null: no comparison value is offered). */
export function requirementValueKind(attribute: Pick<AttributeDefinition, 'type'>): ValueKind | null {
  switch (attribute.type) {
    case 'number':
    case 'currency':
      return 'number';
    case 'rating':
      return 'rating';
    case 'date':
    case 'timestamp':
      return 'date';
    case 'select':
      return 'option';
    case 'pipeline':
      return 'status';
    case 'entity-reference':
      return 'record';
    case 'actor-reference':
      return 'actor';
    case 'text':
    case 'email-address':
    case 'domain':
    case 'phone-number':
    case 'personal-name':
    case 'location':
      return 'text';
    default:
      return null;
  }
}

/** Editor value → stored requirement value (undefined: not a usable value, keep the editor open). */
export function toStoredValue(kind: ValueKind, value: unknown): unknown {
  switch (kind) {
    case 'date': {
      const date =
        (value as { kind?: string; date?: string } | null)?.kind === 'exact' ? (value as { date: string }).date : null;
      return date ?? undefined;
    }
    case 'record':
      return (value as RecordValue | null)?.entityInstanceId;
    case 'actor': {
      const actor = value as ActorValue | null;
      return actor?.kind === 'member' ? actor.id : undefined;
    }
    default:
      return value;
  }
}

/** Stored requirement value → what the editor and its label expect. */
export function toEditorValue(kind: ValueKind, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  switch (kind) {
    case 'date':
      return { kind: 'exact', date: String(value) };
    case 'record':
      return { entityInstanceId: String(value) } satisfies RecordValue;
    case 'actor':
      return { kind: 'member', id: String(value) } satisfies ActorValue;
    default:
      return value;
  }
}
