// The client-side formula schema lets the editor type-check with the same package as the server: attribute
// lookups over the cached attribute lists of the formula's object and of every object its reference paths reach.
import type { AttributeDefinition } from '@agentic-crm/contracts';
import {
  type CompiledFormula,
  compileEditorText,
  type FormulaAnnotation,
  type FormulaSchema,
  KINDS,
  type Kind,
  type OutputOverride,
  type SchemaAttribute,
} from '@agentic-crm/formula';

const KIND_SET: ReadonlySet<string> = new Set(KINDS);

export function isFormulaKind(type: string): type is Kind {
  return KIND_SET.has(type);
}

/** Objects a record-reference attribute points at (a relationship's other side, or its allowed objects). */
export function targetsOf(attr: AttributeDefinition): string[] | null {
  if (attr.type !== 'entity-reference') return null;
  if (attr.relationship) return [attr.relationship.relatedEntityDefinitionId];
  const allowed = attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null;
  return allowed && allowed.length > 0 ? allowed : null;
}

export function schemaAttributeOf(attr: AttributeDefinition): SchemaAttribute | null {
  if (!isFormulaKind(attr.type)) return null;
  return {
    id: attr.id,
    entityDefinitionId: attr.entityDefinitionId,
    title: attr.title,
    type: attr.type,
    isMultiselect: attr.isMultiselect,
    isArchived: attr.isArchived,
    targetEntityDefinitionIds: targetsOf(attr),
  };
}

/** Attribute lists by definition id (undefined = not loaded). */
export type AttributeLookup = (entityDefinitionId: string) => readonly AttributeDefinition[] | undefined;

export function createFormulaSchema(lookup: AttributeLookup): FormulaSchema {
  return {
    attribute(entityDefinitionId, attributeDefinitionId) {
      const attr = lookup(entityDefinitionId)?.find((a) => a.id === attributeDefinitionId);
      return attr ? schemaAttributeOf(attr) : null;
    },
  };
}

/** Definitions the reference paths of a token map traverse (their attribute lists must be loaded to check). */
export function definitionsOf(tokens: Iterable<FormulaAnnotation>): string[] {
  const ids = new Set<string>();
  for (const a of tokens) {
    if (a.type === 'entity-variable') for (const hop of a.path) ids.add(hop.entityDefinitionId);
  }
  return [...ids];
}

export function compileDraft(
  text: string,
  tokens: ReadonlyMap<string, FormulaAnnotation>,
  entityDefinitionId: string,
  lookup: AttributeLookup,
  outputTypeOverride: OutputOverride | null,
): CompiledFormula {
  return compileEditorText(text, new Map(tokens), {
    entityDefinitionId,
    schema: createFormulaSchema(lookup),
    outputTypeOverride,
  });
}
