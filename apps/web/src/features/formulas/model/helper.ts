// Helper panel list: "Attributes" (the object's attributes, first 5 + "Show more"; record
// references drill into the related object's attributes with a "Back" row) and "Functions" (every function with a
// help entry, `name`). A query (typed in the search box or driven by the word at the editor cursor) filters both
// groups; an attribute query (`{…`) lists attributes only.
import type { AttributeDefinition, PathHop } from '@agentic-crm/contracts';
import { type FunctionDecl, HELP_FUNCTIONS } from '@agentic-crm/formula';
import { rankByTitle } from './complete';
import { isFormulaKind, targetsOf } from './schema';

export const COLLAPSED_ATTRIBUTE_COUNT = 5;

export type HelperItem =
  | { kind: 'back'; key: 'back'; label: string }
  | {
      kind: 'attribute';
      key: string;
      attribute: AttributeDefinition;
      /** Full path from the formula's object to this attribute. */
      path: PathHop[];
      /** Titles of the hops ("Company › Name"). */
      breadcrumb: string[];
      /** Record reference with one known target object: Enter / click drills in. */
      drillTarget: string | null;
    }
  | { kind: 'toggle'; key: 'toggle'; expanded: boolean }
  | { kind: 'function'; key: string; decl: FunctionDecl };

export interface HelperGroup {
  id: 'attributes' | 'functions';
  label: string;
  items: HelperItem[];
}

export interface DrillLevel {
  /** The record-reference attribute drilled into (path hop) and its title. */
  hop: PathHop;
  title: string;
  /** The object whose attributes this level lists. */
  entityDefinitionId: string;
}

/**
 * Attributes a formula may reference: active and visible (plus the system "Next due task"), of a
 * kind the language knows, not the formula itself (list memberships are not attribute values).
 */
export function referenceableAttributes(
  attributes: readonly AttributeDefinition[],
  excludeId?: string | null,
): AttributeDefinition[] {
  return attributes.filter(
    (a) =>
      !a.isArchived &&
      (!a.isHidden || a.systemAttributeType === 'next-due-task') &&
      a.systemAttributeType !== 'list-entries' &&
      a.id !== excludeId &&
      isFormulaKind(a.type),
  );
}

export function drillTargetOf(attr: AttributeDefinition): string | null {
  const targets = targetsOf(attr);
  return targets && targets.length === 1 ? (targets[0] as string) : null;
}

export function functionMatchesQuery(decl: FunctionDecl, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (decl.name.toLowerCase().includes(q)) return true;
  return (decl.help?.searchTerms ?? []).some((t) => t.toLowerCase().includes(q));
}

export interface HelperInput {
  /** Attributes of the current level (the formula's object, or the drilled-into object). */
  attributes: readonly AttributeDefinition[];
  drill: readonly DrillLevel[];
  query: string;
  queryKind: 'attribute' | 'word' | 'search';
  expanded: boolean;
}

export function helperGroups(input: HelperInput): HelperGroup[] {
  const { attributes, drill, query, queryKind, expanded } = input;
  const prefix = drill.map((d) => d.hop);
  const crumbs = drill.map((d) => d.title);
  const ranked = rankByTitle(attributes, query, (a) => a.title);
  const filtering = query.trim() !== '';
  const shown = filtering || expanded ? ranked : ranked.slice(0, COLLAPSED_ATTRIBUTE_COUNT);
  const attributeItems: HelperItem[] = [];
  if (drill.length > 0) attributeItems.push({ kind: 'back', key: 'back', label: 'Back' });
  for (const a of shown) {
    attributeItems.push({
      kind: 'attribute',
      key: `attr:${[...prefix.map((h) => h.attributeDefinitionId), a.id].join('/')}`,
      attribute: a,
      path: [...prefix, { entityDefinitionId: a.entityDefinitionId, attributeDefinitionId: a.id }],
      breadcrumb: [...crumbs, a.title],
      drillTarget: drill.length < 4 ? drillTargetOf(a) : null,
    });
  }
  if (!filtering && ranked.length > COLLAPSED_ATTRIBUTE_COUNT) {
    attributeItems.push({ kind: 'toggle', key: 'toggle', expanded });
  }
  const groups: HelperGroup[] = [];
  if (attributeItems.some((i) => i.kind === 'attribute') || drill.length > 0) {
    groups.push({ id: 'attributes', label: 'Attributes', items: attributeItems });
  }
  if (queryKind !== 'attribute' && drill.length === 0) {
    const fns = HELP_FUNCTIONS.filter((d) => functionMatchesQuery(d, query));
    const sorted = filtering
      ? [
          ...fns.filter((d) => d.name.toLowerCase().startsWith(query.trim().toLowerCase())),
          ...fns.filter((d) => !d.name.toLowerCase().startsWith(query.trim().toLowerCase())),
        ]
      : fns;
    if (sorted.length > 0) {
      groups.push({
        id: 'functions',
        label: 'Functions',
        items: sorted.map((decl) => ({ kind: 'function', key: `fn:${decl.name}`, decl })),
      });
    }
  }
  return groups;
}

/** The rows of all groups in order (keyboard navigation). */
export function flatItems(groups: readonly HelperGroup[]): HelperItem[] {
  return groups.flatMap((g) => g.items);
}

/** Signature `name(param, …)` of a function's help card. */
export function signature(decl: FunctionDecl): string {
  const params = decl.help?.parameters ?? decl.params.map((p) => p.name);
  return `${decl.name}(${params.join(', ')})`;
}
