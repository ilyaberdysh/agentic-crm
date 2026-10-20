// Attribute references shared by the formula editor and the AI autofill prompt: the attribute lists of the object,
// of the objects its record references point at and of every object a chip's path reaches; chip labels
// ("Company › Name", "{Unknown variable}") and the `{` picker options (related attributes as "Parent › Child").
import type { AttributeDefinition, PathHop } from '@agentic-crm/contracts';
import { type FormulaAnnotation, IDENTITY_FIELDS } from '@agentic-crm/formula';
import { useCallback, useMemo } from 'react';
import type { WorkspaceRef } from '../../data/trpc';
import { useAttributeLookup } from './data';
import type { ChipInfo, ChipResolver } from './editor/chips';
import type { AttributeOption, AttributeOptionsProvider } from './editor/completion';
import { rankByTitle } from './model/complete';
import { drillTargetOf, referenceableAttributes } from './model/helper';
import { type AttributeLookup, definitionsOf } from './model/schema';
import { fieldFor } from './model/source';

export interface References {
  lookup: AttributeLookup;
  isLoading: boolean;
  /** The object's attributes a formula / prompt may reference. */
  referenceable: AttributeDefinition[];
  resolveChip: ChipResolver;
  attributeOptions: AttributeOptionsProvider;
}

const hopOf = (a: Pick<AttributeDefinition, 'id' | 'entityDefinitionId'>): PathHop => ({
  entityDefinitionId: a.entityDefinitionId,
  attributeDefinitionId: a.id,
});

export function chipInfoOf(a: FormulaAnnotation, lookup: AttributeLookup): ChipInfo {
  if (a.type === 'actor-reference') return { parts: ['User'] };
  if (a.type !== 'entity-variable') return { parts: ['Option'] };
  const parts: string[] = [];
  for (const hop of a.path) {
    const list = lookup(hop.entityDefinitionId);
    if (!list) return { parts: a.path.map(() => '…') };
    const attr = list.find((x) => x.id === hop.attributeDefinitionId);
    if (!attr) return { parts: null };
    parts.push(attr.title);
  }
  return { parts, field: a.field && !IDENTITY_FIELDS.has(a.field) ? a.field : null };
}

/** `{` options: the object's attributes, and (while typing) the attributes of related objects. */
export function attributeOptionsOf(
  referenceable: readonly AttributeDefinition[],
  lookup: AttributeLookup,
  query: string,
): AttributeOption[] {
  const top = referenceable.map((a) => ({ label: a.title, path: [hopOf(a)], field: fieldFor(a.type) }));
  const nested = query.trim()
    ? referenceable.flatMap((a) => {
        const target = drillTargetOf(a);
        const list = target ? lookup(target) : undefined;
        return list
          ? referenceableAttributes(list).map((b) => ({
              label: `${a.title} › ${b.title}`,
              path: [hopOf(a), hopOf(b)],
              field: fieldFor(b.type),
            }))
          : [];
      })
    : [];
  return rankByTitle([...top, ...nested], query, (o) => o.label);
}

export function useReferences(
  workspace: WorkspaceRef,
  entityDefinitionId: string,
  options: { excludeAttributeId?: string | null; tokens?: Iterable<FormulaAnnotation>; extraDefs?: string[] } = {},
): References {
  const base = useAttributeLookup(workspace, [entityDefinitionId]);
  const referenceable = useMemo(
    () => referenceableAttributes(base.lookup(entityDefinitionId) ?? [], options.excludeAttributeId),
    [base.lookup, entityDefinitionId, options.excludeAttributeId],
  );
  const tokenDefs = options.tokens ? definitionsOf(options.tokens) : [];
  const defs = useMemo(
    () => [
      entityDefinitionId,
      ...referenceable.map(drillTargetOf).filter((d): d is string => Boolean(d)),
      ...tokenDefs,
      ...(options.extraDefs ?? []),
    ],
    [entityDefinitionId, referenceable, tokenDefs.join(','), (options.extraDefs ?? []).join(',')],
  );
  const all = useAttributeLookup(workspace, defs);
  const resolveChip = useCallback<ChipResolver>((a) => chipInfoOf(a, all.lookup), [all.lookup]);
  const attributeOptions = useCallback<AttributeOptionsProvider>(
    (q) => attributeOptionsOf(referenceable, all.lookup, q),
    [referenceable, all.lookup],
  );
  return {
    lookup: all.lookup,
    isLoading: all.isLoading || base.isLoading,
    referenceable,
    resolveChip,
    attributeOptions,
  };
}
