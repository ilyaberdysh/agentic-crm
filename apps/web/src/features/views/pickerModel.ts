// Items of the attribute path picker (CROSS-DOMAIN B.7; C1 README §3.2 Add column, filters-sorts-calcs §1, §5, §7):
// the attributes of an object in picker order, relationship drill-downs (count + chevron, first option = the
// relationship itself, ≤ 5 hops), sub-field drill-downs (location parts for columns; multi-field types for filters;
// stage order / active from for status sorts) and the search across one nested level ("Client › Created at").
import type { AttributeDefinition, Path } from '@agentic-crm/contracts';
import type { IconName } from '@agentic-crm/ui';
import {
  attributeIcon,
  columnFields,
  filterFields,
  isSortable,
  primaryFilterFields,
  type SubField,
  sortFields,
} from './operators';
import { MAX_PATH_LENGTH, type SchemaIndex } from './schemaIndex';

export type PickerPurpose = 'column' | 'filter' | 'sort';

export interface PickerSelection {
  path: Path;
  field: string | null;
  attribute: AttributeDefinition;
}

export type PickerLevel =
  | { kind: 'object'; definitionId: string; prefix: Path; via: AttributeDefinition | null }
  | { kind: 'fields'; attribute: AttributeDefinition; path: Path; fields: readonly SubField[] };

export interface PickerItem {
  key: string;
  label: string;
  icon: IconName;
  attribute: AttributeDefinition;
  /** Selecting the item (absent for pure drill-downs). */
  select?: PickerSelection;
  /** Drilling in (relationship target or sub-fields). */
  drill?: PickerLevel;
  /** Number of options behind the drill-down; undefined while the target schema loads. */
  count?: number;
  /** Children of a drilled level are indented under the guide line. */
  indent?: boolean;
  /** The relationship itself, first in its drilled level. */
  isSelf?: boolean;
  /** Click / Enter select the item; only the chevron (or →) drills (status → Lifecycle). */
  clickSelects?: boolean;
}

/** System attributes that are never offered (avatars, list memberships until lists exist). */
const NEVER = new Set(['avatar-url', 'list-entries', 'workspace-avatar-url']);

export function isOfferable(attr: AttributeDefinition): boolean {
  if (attr.isArchived) return false;
  if (attr.systemAttributeType && NEVER.has(attr.systemAttributeType)) return false;
  // Hidden system attributes stay hidden, except "Next due task" which drills into its due date (C1 §3.2).
  if (attr.isHidden && attr.systemAttributeType !== 'next-due-task') return false;
  return true;
}

const rankOf = (a: AttributeDefinition) => a.sortOrder;

/** System attributes first, then custom ones, each in attribute-definition order (C1 §3.2). */
export function orderedAttributes(attrs: readonly AttributeDefinition[]): AttributeDefinition[] {
  return attrs
    .filter(isOfferable)
    .slice()
    .sort((x, y) => {
      if (x.isSystem !== y.isSystem) return x.isSystem ? -1 : 1;
      return rankOf(x) < rankOf(y) ? -1 : rankOf(x) > rankOf(y) ? 1 : 0;
    });
}

const hopOf = (attr: AttributeDefinition) => ({
  entityDefinitionId: attr.entityDefinitionId,
  attributeDefinitionId: attr.id,
});

/** The field a direct selection carries for a purpose. */
function directField(attr: AttributeDefinition, purpose: PickerPurpose): string | null {
  if (purpose === 'filter') return filterFields(attr)[0]?.field ?? null;
  if (purpose === 'sort') return sortFields(attr)[0]?.field ?? null;
  return null;
}

/** Sub-fields an attribute drills into for a purpose (empty → selected directly). */
function subFields(attr: AttributeDefinition, purpose: PickerPurpose): readonly SubField[] {
  if (purpose === 'column') return columnFields(attr);
  if (purpose === 'sort') {
    const fields = sortFields(attr);
    return fields.length > 1 ? fields : [];
  }
  const fields = primaryFilterFields(attr);
  return fields.length > 1 ? fields.map((f) => ({ field: f.field, label: f.label ?? attr.title })) : [];
}

/** Filter fields beyond the primary ones (status "Lifecycle"): reachable through the chevron only. */
function secondaryDrill(attr: AttributeDefinition, purpose: PickerPurpose): readonly SubField[] {
  if (purpose !== 'filter') return [];
  const all = filterFields(attr);
  if (all.length === primaryFilterFields(attr).length) return [];
  return all.map((f) => ({ field: f.field, label: f.label ?? attr.title }));
}

function targetDefinition(index: SchemaIndex, attr: AttributeDefinition): string | null {
  return index.targetOf(attr);
}

/** Items of one picker level, in display order. */
export function levelItems(index: SchemaIndex, level: PickerLevel, purpose: PickerPurpose): PickerItem[] {
  if (level.kind === 'fields') {
    return level.fields.map((f) => ({
      key: `${pathKeyOf(level.path)}#${f.field}`,
      label: f.label,
      icon: attributeIcon(level.attribute),
      attribute: level.attribute,
      select: { path: level.path, field: f.field, attribute: level.attribute },
      indent: true,
    }));
  }
  const attrs = index.attributes(level.definitionId);
  if (!attrs) return [];
  const out: PickerItem[] = [];
  const via = level.via;
  if (via && purpose !== 'sort') {
    out.push({
      key: `${pathKeyOf(level.prefix)}#self`,
      label: via.title,
      icon: attributeIcon(via),
      attribute: via,
      select: { path: level.prefix, field: directField(via, purpose), attribute: via },
      isSelf: true,
    });
  }
  let candidates = orderedAttributes(attrs);
  // "Next due task" offers only the task's due date (C1 §3.2).
  if (via?.systemAttributeType === 'next-due-task') {
    candidates = candidates.filter((a) => a.systemAttributeType === 'task-deadline');
  }
  for (const attr of candidates) {
    const item = attributeItem(index, attr, level.prefix, purpose);
    if (item) out.push(via ? { ...item, indent: true } : item);
  }
  return out;
}

function attributeItem(
  index: SchemaIndex,
  attr: AttributeDefinition,
  prefix: Path,
  purpose: PickerPurpose,
): PickerItem | null {
  const path = [...prefix, hopOf(attr)];
  const base = { key: pathKeyOf(path), label: attr.title, icon: attributeIcon(attr), attribute: attr };
  if (attr.type === 'entity-reference') {
    const target = targetDefinition(index, attr);
    if (target && path.length < MAX_PATH_LENGTH) {
      const drill: PickerLevel = { kind: 'object', definitionId: target, prefix: path, via: attr };
      const loaded = index.attributes(target) !== undefined;
      const count = loaded ? levelItems(index, drill, purpose).filter((i) => !i.isSelf).length : undefined;
      if (purpose === 'sort' && count === 0) return null;
      return {
        ...base,
        drill,
        count,
        ...(purpose === 'sort' ? {} : { select: { path, field: directField(attr, purpose), attribute: attr } }),
      };
    }
    if (purpose === 'sort') return null;
    return { ...base, select: { path, field: directField(attr, purpose), attribute: attr } };
  }
  if (purpose === 'sort' && !isSortable(attr)) return null;
  const fields = subFields(attr, purpose);
  if (fields.length > 0) {
    return { ...base, drill: { kind: 'fields', attribute: attr, path, fields }, count: fields.length };
  }
  const select = { path, field: directField(attr, purpose), attribute: attr };
  const secondary = secondaryDrill(attr, purpose);
  if (secondary.length > 0) {
    return { ...base, select, clickSelects: true, drill: { kind: 'fields', attribute: attr, path, fields: secondary } };
  }
  return { ...base, select };
}

/** Definitions whose attributes a level needs for its counts (relationship targets). */
export function levelTargets(index: SchemaIndex | null, level: PickerLevel): string[] {
  if (!index || level.kind !== 'object') return [];
  const attrs = index.attributes(level.definitionId) ?? [];
  const out = new Set<string>();
  for (const a of attrs) {
    if (a.type !== 'entity-reference' || !isOfferable(a)) continue;
    const t = index.targetOf(a);
    if (t) out.add(t);
  }
  return [...out];
}

/** Search across the level and one nested level: flat results labelled with their relative path. */
export function searchItems(
  index: SchemaIndex,
  level: PickerLevel,
  purpose: PickerPurpose,
  query: string,
): PickerItem[] {
  const q = query.trim().toLowerCase();
  const items = levelItems(index, level, purpose);
  if (!q) return items;
  const out: PickerItem[] = [];
  for (const item of items) {
    if (item.label.toLowerCase().includes(q)) out.push({ ...item, indent: false });
    if (!item.drill || item.isSelf) continue;
    for (const child of levelItems(index, item.drill, purpose)) {
      if (child.isSelf) continue;
      const label = `${item.label} › ${child.label}`;
      if (child.label.toLowerCase().includes(q) || label.toLowerCase().includes(q)) {
        out.push({ ...child, key: `${child.key}@search`, label, indent: false });
      }
    }
  }
  return out;
}

function pathKeyOf(path: Path): string {
  return path.map((h) => h.attributeDefinitionId).join('/');
}
