// The variable menu's model (F composer §2.6): the recipient object's attributes in order, attributes with sub-fields
// (a name's First / Last / Full, a location's City …) or a relationship (Company → its attributes) drill in place.
// A choice is a path of attribute steps plus an optional sub-field, labelled like the chip: "Name › First".
import type { AttributeDefinition } from '@agentic-crm/contracts';
import type { IconName } from '@agentic-crm/ui';

export interface PathStep {
  entityDefinitionId: string;
  attributeDefinitionId: string;
}

export interface SubField {
  /** Server sub-field key (`first_name`); null = the attribute's own value. */
  field: string | null;
  title: string;
}

const FIELDS: Partial<Record<AttributeDefinition['type'], SubField[]>> = {
  'personal-name': [
    { field: 'first_name', title: 'First' },
    { field: 'last_name', title: 'Last' },
    { field: 'full_name', title: 'Full' },
  ],
  'email-address': [
    { field: null, title: 'Email address' },
    { field: 'email_domain', title: 'Domain' },
  ],
  location: [
    { field: 'line1', title: 'Street address' },
    { field: 'locality', title: 'City' },
    { field: 'region', title: 'State' },
    { field: 'postcode', title: 'Postal code' },
    { field: 'country_code', title: 'Country' },
  ],
};

/** Sub-fields of an attribute (empty for plain values). */
export function subFieldsOf(attribute: Pick<AttributeDefinition, 'type'>): SubField[] {
  return FIELDS[attribute.type] ?? [];
}

/** The object a reference attribute points to (the relationship's other side, else a single allowed object). */
export function relatedDefinitionOf(
  attribute: Pick<AttributeDefinition, 'type' | 'relationship' | 'config'>,
): string | null {
  if (attribute.type !== 'entity-reference') return null;
  if (attribute.relationship) return attribute.relationship.relatedEntityDefinitionId;
  const allowed = attribute.config.entityReferenceConfiguration?.allowedEntityDefinitionIds;
  return allowed && allowed.length === 1 ? (allowed[0] ?? null) : null;
}

/** Deepest relationship hop the menu offers (Company › Name is two steps). */
export const MAX_PATH_DEPTH = 2;

/** Attributes the menu lists: no archived or hidden ones, no list-entries pseudo attribute. */
export function menuAttributes(attributes: readonly AttributeDefinition[]): AttributeDefinition[] {
  return attributes.filter((a) => !a.isArchived && !a.isHidden && a.systemAttributeType !== 'list-entries');
}

export type Drill = { kind: 'fields'; fields: SubField[] } | { kind: 'relation'; definitionId: string } | null;

/** How a row continues when picked: sub-fields, the related object's attributes, or nothing (it is the value). */
export function drillOf(attribute: AttributeDefinition, depth: number): Drill {
  const fields = subFieldsOf(attribute);
  if (fields.length > 0) return { kind: 'fields', fields };
  const related = relatedDefinitionOf(attribute);
  if (related && depth < MAX_PATH_DEPTH) return { kind: 'relation', definitionId: related };
  return null;
}

export interface VariableChoice {
  path: PathStep[];
  field: string | null;
  /** Chip label: titles of the steps and the sub-field joined by " › ". */
  label: string;
}

/** The choice for `attribute` (reached through `trail`: the steps and titles taken so far) and an optional field. */
export function choiceOf(
  trail: readonly { step: PathStep; title: string }[],
  attribute: Pick<AttributeDefinition, 'id' | 'title' | 'entityDefinitionId'>,
  field: SubField | null,
): VariableChoice {
  const steps = [
    ...trail.map((t) => t.step),
    { entityDefinitionId: attribute.entityDefinitionId, attributeDefinitionId: attribute.id },
  ];
  const titles = [...trail.map((t) => t.title), attribute.title, ...(field?.field ? [field.title] : [])];
  return { path: steps, field: field?.field ?? null, label: titles.join(' › ') };
}

/** Placeholder of the fallback input: a type-appropriate example ("John" for a first name). */
export function fallbackExample(attribute: Pick<AttributeDefinition, 'type' | 'title'> | null, field: string | null) {
  if (field === 'first_name') return 'John';
  if (field === 'last_name') return 'Smith';
  if (field === 'full_name') return 'John Smith';
  if (field === 'email_domain') return 'example.com';
  switch (attribute?.type) {
    case 'email-address':
      return 'john@example.com';
    case 'number':
    case 'rating':
      return '0';
    case 'currency':
      return '0 USD';
    case 'date':
    case 'timestamp':
      return '2026-01-01';
    case 'phone-number':
      return '+1 555 0100';
    case 'domain':
      return 'example.com';
    case 'location':
      return 'London';
    default:
      return attribute ? `Fallback for ${attribute.title.toLowerCase()}` : 'Fallback';
  }
}

/** Icon of a menu row (the attribute-type icon shown in Attio's menu). */
export type RowIcon = IconName;
