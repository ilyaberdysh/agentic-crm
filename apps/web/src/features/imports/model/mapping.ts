// Map columns (C2, §): which attributes a column can map to, the client-side auto-mapping saved with
// the draft (exact title match; dates get a detected format), chip labels, and the validation that blocks Continue.
// Destinations: an object (its writable attributes, Record ID as a match key, relationship drill-downs to the related
// object's attributes) or a list (list attributes incl. Entry ID, and the parent object's attributes through
// `parent_record`).
import type { AttributeDefinition, EntityDefinition, Path, PathHop } from '@agentic-crm/contracts';
import { orderedAttributes } from '../../views/pickerModel';
import type { SchemaIndex } from '../../views/schemaIndex';
import type { ImportColumn, ImportJob, MappingProperty, NameField, PropertyConfig } from '../data/contract';
import { detectDateFormat, EMPTY_CONFIG, isIdAttribute, isParentRecordAttribute } from './resolve';

const NOT_MAPPABLE_SYSTEM = new Set([
  'created-at',
  'created-by',
  'list-entries',
  'next-due-task',
  'avatar-url',
  'workspace-avatar-url',
]);

/** Writable attributes a column may map to (Record / Entry ID included as match keys). */
export function isMappable(attribute: AttributeDefinition): boolean {
  if (attribute.isArchived || attribute.type === 'interaction') return false;
  if (attribute.systemAttributeType && NOT_MAPPABLE_SYSTEM.has(attribute.systemAttributeType)) return false;
  if (isIdAttribute(attribute)) return true;
  if (attribute.isHidden || attribute.isReadOnly) return false;
  return true;
}

/** Picker order: Record ID first, then system attributes, then custom ones in rank order. */
export function mappableAttributes(index: SchemaIndex, entityDefinitionId: string): AttributeDefinition[] {
  const list = (index.attributes(entityDefinitionId) ?? []).filter(isMappable);
  const ordered = orderedAttributes(list);
  // `orderedAttributes` drops hidden attributes; keep the id attribute even when hidden.
  const id = list.find(isIdAttribute);
  const rest = ordered.filter((a) => a !== id && !isParentRecordAttribute(a));
  return id ? [id, ...rest] : rest;
}

export const hopOf = (attribute: AttributeDefinition): PathHop => ({
  entityDefinitionId: attribute.entityDefinitionId,
  attributeDefinitionId: attribute.id,
});

export function pathKey(path: Path, field: NameField | null = null): string {
  return `${path.map((h) => h.attributeDefinitionId).join('/')}${field ? `#${field}` : ''}`;
}

export const NAME_FIELDS: ReadonlyArray<{ field: NameField; label: string }> = [
  { field: 'first_name', label: 'First name' },
  { field: 'last_name', label: 'Last name' },
  { field: 'full_name', label: 'Full name' },
];

/** The list's parent object (target of `parent_record`), for list destinations. */
export function parentRecordAttribute(index: SchemaIndex, listId: string): AttributeDefinition | undefined {
  return index.attributes(listId)?.find((a) => isParentRecordAttribute(a) && !a.isArchived);
}

export function isListDestination(definition: Pick<EntityDefinition, 'entityType'> | undefined): boolean {
  return definition?.entityType === 'collection-entry';
}

/** "Code", "Client › Domains", "Parent Record › Code", "Name › First name". */
export function mappingLabel(index: SchemaIndex | null, path: Path, field: NameField | null): string {
  const parts = path.map((h) => index?.attribute(h)?.title ?? 'Deleted attribute');
  const sub = field ? NAME_FIELDS.find((f) => f.field === field)?.label : undefined;
  return [...parts, ...(sub ? [sub] : [])].join(' › ');
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function defaultConfig(attribute: AttributeDefinition, column: ImportColumn): PropertyConfig {
  if (attribute.type === 'date') return { ...EMPTY_CONFIG, dateFormat: detectDateFormat(column.exampleValues) };
  if (attribute.type === 'timestamp')
    return { ...EMPTY_CONFIG, timestampFormat: detectDateFormat(column.exampleValues, 'timestamp') };
  if (attribute.type === 'number' || attribute.type === 'currency')
    return { ...EMPTY_CONFIG, decimalSeparator: 'point' };
  return { ...EMPTY_CONFIG };
}

/** A new mapping property for a column → attribute path. */
export function newProperty(
  id: string,
  column: ImportColumn,
  path: Path,
  leaf: AttributeDefinition,
  field: NameField | null,
): MappingProperty {
  return { id, columnIndex: column.index, path, field, config: defaultConfig(leaf, column) };
}

/** Name-part headers ("First name", "Last name") that map onto a personal-name attribute. */
function nameFieldOf(title: string, attribute: AttributeDefinition): NameField | null | undefined {
  if (attribute.type !== 'personal-name') return undefined;
  const t = norm(title);
  if (t === 'first name' || t === 'firstname') return 'first_name';
  if (t === 'last name' || t === 'lastname' || t === 'surname') return 'last_name';
  if (t === norm(attribute.title) || t === 'full name') return 'full_name';
  return undefined;
}

/**
 * Auto-mapping on create: a column maps to the attribute with the same title (list imports: list attributes first,
 * then the parent object's attributes through `parent_record`); every attribute (or name part) is used once.
 */
export function autoMap(
  columns: readonly ImportColumn[],
  index: SchemaIndex,
  destinationId: string,
  newId: () => string,
): MappingProperty[] {
  const destination = index.definition(destinationId);
  const candidates: Array<{ path: Path; attribute: AttributeDefinition }> = mappableAttributes(
    index,
    destinationId,
  ).map((a) => ({ path: [hopOf(a)], attribute: a }));
  if (isListDestination(destination)) {
    const parent = parentRecordAttribute(index, destinationId);
    const target = parent ? index.targetOf(parent) : null;
    if (parent && target) {
      for (const a of mappableAttributes(index, target))
        candidates.push({ path: [hopOf(parent), hopOf(a)], attribute: a });
    }
  }
  const used = new Set<string>();
  const out: MappingProperty[] = [];
  for (const column of columns) {
    for (const c of candidates) {
      const field = nameFieldOf(column.title, c.attribute);
      const titleMatch = norm(c.attribute.title) === norm(column.title);
      if (!titleMatch && field === undefined) continue;
      const f: NameField | null = c.attribute.type === 'personal-name' ? (field ?? 'full_name') : null;
      const key = pathKey(c.path, f);
      if (used.has(key)) continue;
      used.add(key);
      out.push(newProperty(newId(), column, c.path, c.attribute, f));
      break;
    }
  }
  return out;
}

// ---- validation -------------------------------------------------------------------------------------------------------

export interface MappingValidation {
  /** Blocks Continue (message shown above the footer). */
  error: string | null;
  /** Rows highlighted with their problem. */
  columnErrors: Map<number, string>;
}

export const MAPPING_MESSAGES = {
  none: 'You need to map at least one column to continue',
  duplicate: 'Multiple mappings have been added for the same attribute. Remove one of them to continue.',
  depth: 'Some mapped attributes are nested too deeply.',
  listParent: 'Please map an attribute on the parent record, or map the entry ID attribute, to continue.',
} as const;

export function validateMapping(
  job: Pick<ImportJob, 'mapping' | 'entityDefinitionId'>,
  index: SchemaIndex | null,
): MappingValidation {
  const columnErrors = new Map<number, string>();
  if (job.mapping.length === 0) return { error: MAPPING_MESSAGES.none, columnErrors };
  const seen = new Map<string, number>();
  let duplicate = false;
  let deep = false;
  for (const p of job.mapping) {
    const key = pathKey(p.path, p.field);
    const other = seen.get(key);
    if (other !== undefined) {
      duplicate = true;
      columnErrors.set(p.columnIndex, MAPPING_MESSAGES.duplicate);
      columnErrors.set(other, MAPPING_MESSAGES.duplicate);
    } else seen.set(key, p.columnIndex);
    if (p.path.length > 2) {
      deep = true;
      columnErrors.set(p.columnIndex, MAPPING_MESSAGES.depth);
    }
  }
  if (duplicate) return { error: MAPPING_MESSAGES.duplicate, columnErrors };
  if (deep) return { error: MAPPING_MESSAGES.depth, columnErrors };
  const destination = index?.definition(job.entityDefinitionId);
  if (index && isListDestination(destination)) {
    const parent = parentRecordAttribute(index, job.entityDefinitionId);
    const ok = job.mapping.some((p) => {
      const first = index.attribute(p.path[0] as PathHop);
      return (
        (p.path.length === 2 && parent && p.path[0]?.attributeDefinitionId === parent.id) ||
        (p.path.length === 1 && first && isIdAttribute(first))
      );
    });
    if (!ok) return { error: MAPPING_MESSAGES.listParent, columnErrors };
  }
  return { error: null, columnErrors };
}

/** Unique attributes of the object that writes records (the list's parent object for lists), for the duplicate dialog. */
export function uniqueAttributesFor(index: SchemaIndex, destinationId: string): AttributeDefinition[] {
  const destination = index.definition(destinationId);
  let target = destinationId;
  if (isListDestination(destination)) {
    const parent = parentRecordAttribute(index, destinationId);
    target = (parent && index.targetOf(parent)) || destinationId;
  }
  return mappableAttributes(index, target).filter((a) => a.isUnique);
}

/** Whether some mapped column can match existing records (a unique attribute of the record-writing object). */
export function hasUniqueMapping(job: Pick<ImportJob, 'mapping' | 'entityDefinitionId'>, index: SchemaIndex): boolean {
  const unique = new Set(uniqueAttributesFor(index, job.entityDefinitionId).map((a) => a.id));
  const destination = index.definition(job.entityDefinitionId);
  const list = isListDestination(destination);
  return job.mapping.some((p) => {
    const leaf = p.path[p.path.length - 1];
    if (!leaf) return false;
    if (list) {
      if (p.path.length === 2) return unique.has(leaf.attributeDefinitionId);
      const attribute = index.attribute(leaf);
      return p.path.length === 1 && attribute !== undefined && isIdAttribute(attribute);
    }
    return p.path.length === 1 && unique.has(leaf.attributeDefinitionId);
  });
}
