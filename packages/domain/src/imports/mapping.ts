// Column mapping (import.md I3, I9): which attributes a column can map to, the auto-mapping on create, and the
// compilation of a mapping into strategies — one per object the import writes:
//   • the destination (object records, or a list's entries),
//   • records linked through a record reference ("Company › Domains"), created or matched per row,
//   • for lists, the parent records reached through the entry's `parent_record` attribute.
// A strategy matches rows on Record ID / Entry ID (update only), on a unique attribute (create or update), for list
// entries with "Update existing" on the parent record, or not at all (every row creates).
import type {
  ImportListStrategy,
  ImportNameField,
  ImportStrategyMode,
  ImportValidation,
  ImportValidationIssue,
  MappableAttribute,
  Path,
} from '@agentic-crm/contracts';
import { type AttrDef, type DefInfo, loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import type { PropertyRow } from './model.ts';
import type { ParseContext } from './parse.ts';

/** Paths may traverse two references below the destination (list → parent record → linked record → attribute). */
export const MAX_IMPORT_PATH_HOPS = 3;

/** Types a column can never be written to. */
const UNSUPPORTED_TYPES = new Set(['interaction']);
/** System attributes written by the system only (never mapped). */
const SYSTEM_MANAGED = new Set(['created-at', 'created-by', 'list-entries', 'next-due-task']);
/** Types "+ Create new attribute" offers in the importer. */
export const CREATABLE_TYPES = [
  'text',
  'number',
  'checkbox',
  'currency',
  'date',
  'timestamp',
  'rating',
  'pipeline',
  'select',
  'actor-reference',
  'location',
  'phone-number',
] as const;

export const isParentRecordAttr = (attr: AttrDef) =>
  attr.apiSlug === 'parent_record' || attr.systemAttributeType === 'entry-parent-record';
export const isIdAttr = (attr: AttrDef) => attr.systemAttributeType === 'id';
export const isListDefinition = (def: DefInfo) => def.entityType === 'collection-entry';

/** Can a column write this (final) attribute? Record / Entry ID are accepted as match keys. */
export function isMappableValueAttr(attr: AttrDef): boolean {
  if (attr.isArchived || attr.isHidden) return false;
  if (isIdAttr(attr)) return true;
  if (UNSUPPORTED_TYPES.has(attr.type) || attr.type === 'entity-reference') return false;
  if (attr.systemAttributeType && SYSTEM_MANAGED.has(attr.systemAttributeType)) return false;
  return !attr.isReadOnly;
}

/** Definitions a reference attribute can point at (one for relationships). */
export function referenceTargets(attr: AttrDef): string[] {
  if (attr.relatedEntityDefinitionId) return [attr.relatedEntityDefinitionId];
  return attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? [];
}

function isTraversable(attr: AttrDef): boolean {
  if (attr.type !== 'entity-reference' || attr.isArchived || attr.isHidden) return false;
  if (attr.systemAttributeType && SYSTEM_MANAGED.has(attr.systemAttributeType)) return false;
  if (attr.isReadOnly && !isParentRecordAttr(attr)) return false;
  return referenceTargets(attr).length >= 1;
}

/** Splits a cell on "," for these types when the attribute holds several values. */
const SPLITTABLE = new Set(['select', 'domain', 'email-address', 'phone-number', 'actor-reference']);

// ---------------------------------------------------------------------------------------------------------------
// Mappable attributes (the picker)

async function mappableAttributes(
  tx: Tx,
  def: DefInfo,
  prefix: Path,
  depthLeft: number,
  onlyUnique: boolean,
): Promise<MappableAttribute[]> {
  const out: MappableAttribute[] = [];
  for (const attr of def.attrs) {
    const path: Path = [...prefix, { entityDefinitionId: def.id, attributeDefinitionId: attr.id }];
    if (isParentRecordAttr(attr)) continue; // the list group exposes the parent's attributes separately
    if (attr.type === 'entity-reference') {
      if (!isTraversable(attr) || depthLeft <= 1) continue;
      const targets = referenceTargets(attr);
      if (targets.length !== 1) continue;
      const target = await loadDefinition(tx, targets[0] as string);
      if (target.isArchived) continue;
      const children = await mappableAttributes(tx, target, path, depthLeft - 1, attr.isMultiselect);
      if (children.length === 0) continue;
      out.push({
        ...describe(def, attr, path),
        related: {
          entityDefinitionId: target.id,
          singularNoun: target.singularNoun,
          pluralNoun: target.pluralNoun,
          attributes: children,
        },
      });
      continue;
    }
    if (!isMappableValueAttr(attr)) continue;
    if (onlyUnique && !(attr.isUnique || isIdAttr(attr))) continue;
    out.push(describe(def, attr, path));
  }
  return out;
}

function describe(def: DefInfo, attr: AttrDef, path: Path): MappableAttribute {
  return {
    path,
    entityDefinitionId: def.id,
    attributeDefinitionId: attr.id,
    title: attr.title,
    type: attr.type,
    isMultiselect: attr.isMultiselect,
    isUnique: attr.isUnique,
    isRequired: attr.isRequired,
    isSystem: attr.isSystem,
    isMatchKey: isIdAttr(attr),
    fields: attr.type === 'personal-name' ? ['full-name', 'first-name', 'last-name'] : null,
    related: null,
  };
}

export interface MappableGroup {
  key: 'record' | 'parent-record' | 'list';
  title: string;
  entityDefinitionId: string;
  attributes: MappableAttribute[];
}

export async function mappableGroups(tx: Tx, root: DefInfo): Promise<MappableGroup[]> {
  if (!isListDefinition(root)) {
    return [
      {
        key: 'record',
        title: `${root.singularNoun} attributes`,
        entityDefinitionId: root.id,
        attributes: await mappableAttributes(tx, root, [], MAX_IMPORT_PATH_HOPS, false),
      },
    ];
  }
  const groups: MappableGroup[] = [];
  const parentAttr = root.attrs.find(isParentRecordAttr);
  if (parentAttr) {
    for (const targetId of referenceTargets(parentAttr)) {
      const parent = await loadDefinition(tx, targetId);
      if (parent.isArchived) continue;
      groups.push({
        key: 'parent-record',
        title: `${parent.singularNoun} attributes`,
        entityDefinitionId: parent.id,
        attributes: await mappableAttributes(
          tx,
          parent,
          [{ entityDefinitionId: root.id, attributeDefinitionId: parentAttr.id }],
          MAX_IMPORT_PATH_HOPS - 1,
          false,
        ),
      });
    }
  }
  groups.push({
    key: 'list',
    title: 'List attributes',
    entityDefinitionId: root.id,
    attributes: await mappableAttributes(tx, root, [], MAX_IMPORT_PATH_HOPS, false),
  });
  return groups;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Auto-mapping uses exact title matches: a header equal to an attribute title maps to it;
 * "First name" / "Last name" / "Full name" map to the parts of a name attribute; a header "A › B" maps to the path
 * through reference A (our export writes such headers). Lists prefer list attributes, then the parent's.
 */
export function autoMap(
  headers: string[],
  groups: MappableGroup[],
): { columnIndex: number; path: Path; field: ImportNameField | null }[] {
  const ordered = [...groups].sort((a, b) => (a.key === 'list' ? -1 : b.key === 'list' ? 1 : 0));
  const out: { columnIndex: number; path: Path; field: ImportNameField | null }[] = [];
  const used = new Set<string>();
  headers.forEach((header, columnIndex) => {
    const h = norm(header);
    if (h === '') return;
    for (const group of ordered) {
      const found = findByHeader(group.attributes, h);
      if (!found) continue;
      const key = `${JSON.stringify(found.path)}:${found.field ?? ''}`;
      if (used.has(key)) return;
      used.add(key);
      out.push({ columnIndex, ...found });
      return;
    }
  });
  return out;
}

function findByHeader(
  attrs: MappableAttribute[],
  header: string,
): { path: Path; field: ImportNameField | null } | null {
  const segments = header.split(/\s*[›>]\s*/).filter((s) => s !== '');
  if (segments.length > 1) {
    let level = attrs;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] as string;
      const hit = level.find((a) => norm(a.title) === seg);
      if (!hit) return null;
      if (i === segments.length - 1) {
        if (hit.related) return null;
        return { path: hit.path, field: hit.type === 'personal-name' ? 'full-name' : null };
      }
      if (!hit.related) return null;
      level = hit.related.attributes;
    }
    return null;
  }
  const direct = attrs.find((a) => !a.related && norm(a.title) === header);
  if (direct) return { path: direct.path, field: direct.type === 'personal-name' ? 'full-name' : null };
  const name = attrs.find((a) => !a.related && a.type === 'personal-name');
  if (name) {
    if (header === 'first name') return { path: name.path, field: 'first-name' };
    if (header === 'last name') return { path: name.path, field: 'last-name' };
    if (header === 'full name') return { path: name.path, field: 'full-name' };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Compilation into strategies

export interface CompiledProperty {
  row: PropertyRow;
  path: Path;
  node: StrategyNode;
  attr: AttrDef;
  field: ImportNameField | null;
  /** Record ID / Entry ID: the match key of an update strategy (never written). */
  isId: boolean;
  /** Split the cell on "," into several values. */
  multi: boolean;
}

export interface StrategyNode {
  index: number;
  def: DefInfo;
  /** Reference hops from the destination; null for the destination. */
  path: Path | null;
  depth: number;
  parent: StrategyNode | null;
  /** The reference attribute (on the parent's definition) that links to this node. */
  viaAttr: AttrDef | null;
  children: StrategyNode[];
  properties: CompiledProperty[];
  isListEntries: boolean;
  isParentRecord: boolean;
  /** Reached through a multi-value reference: each value of the match column is its own record. */
  multi: boolean;
  mode: ImportStrategyMode;
  matchAttr: AttrDef | null;
  matchProperty: CompiledProperty | null;
}

export interface CompiledMapping {
  root: StrategyNode;
  /** All strategies, index order (breadth-first: destination first). */
  nodes: StrategyNode[];
  properties: CompiledProperty[];
  /** Property id → its node (null when the property's path is invalid). */
  propertyNode: Map<string, StrategyNode | null>;
  validation: ImportValidation;
}

function newNode(def: DefInfo, parent: StrategyNode | null, viaAttr: AttrDef | null, path: Path | null): StrategyNode {
  return {
    index: -1,
    def,
    path,
    depth: path?.length ?? 0,
    parent,
    viaAttr,
    children: [],
    properties: [],
    isListEntries: parent === null && isListDefinition(def),
    isParentRecord: viaAttr !== null && isParentRecordAttr(viaAttr),
    multi: viaAttr?.isMultiselect ?? false,
    mode: 'create',
    matchAttr: null,
    matchProperty: null,
  };
}

export async function compileMapping(
  tx: Tx,
  root: DefInfo,
  rows: PropertyRow[],
  listStrategy: ImportListStrategy,
): Promise<CompiledMapping> {
  const rootNode = newNode(root, null, null, null);
  const issues: ImportValidationIssue[] = [];
  const unsupported: string[] = [];
  const nested: string[] = [];
  const mixed: string[] = [];
  const properties: CompiledProperty[] = [];
  const propertyNode = new Map<string, StrategyNode | null>();
  const nodeByKey = new Map<string, StrategyNode>();

  for (const row of rows) {
    const path = row.path as Path;
    propertyNode.set(row.id, null);
    if (path.length > MAX_IMPORT_PATH_HOPS) {
      nested.push(row.id);
      continue;
    }
    if (path[0]?.entityDefinitionId !== root.id) {
      unsupported.push(row.id);
      continue;
    }
    let node = rootNode;
    let def = root;
    let ok = true;
    for (let i = 0; i < path.length; i++) {
      const hop = path[i] as Path[number];
      const attr = def.byId.get(hop.attributeDefinitionId);
      if (!attr || hop.entityDefinitionId !== def.id) {
        ok = false;
        break;
      }
      const next = path[i + 1];
      if (!next) {
        if (!isMappableValueAttr(attr)) {
          ok = false;
          break;
        }
        const prop: CompiledProperty = {
          row,
          path,
          node,
          attr,
          field: attr.type === 'personal-name' ? (row.field ?? 'full-name') : null,
          isId: isIdAttr(attr),
          multi: false,
        };
        node.properties.push(prop);
        properties.push(prop);
        propertyNode.set(row.id, node);
        break;
      }
      if (!isTraversable(attr) || !referenceTargets(attr).includes(next.entityDefinitionId)) {
        ok = false;
        break;
      }
      const key = JSON.stringify(path.slice(0, i + 1).map((h) => h.attributeDefinitionId));
      let child = nodeByKey.get(key);
      if (!child) {
        const target = await loadDefinition(tx, next.entityDefinitionId);
        child = newNode(target, node, attr, path.slice(0, i + 1));
        nodeByKey.set(key, child);
        node.children.push(child);
      } else if (child.def.id !== next.entityDefinitionId) {
        mixed.push(row.id);
        ok = false;
        break;
      }
      node = child;
      def = child.def;
    }
    if (!ok && propertyNode.get(row.id) === null) unsupported.push(row.id);
  }

  // Index breadth-first: the destination (list entries first in the UI tabs), then linked objects.
  const nodes: StrategyNode[] = [];
  const queue = [rootNode];
  while (queue.length > 0) {
    const n = queue.shift() as StrategyNode;
    n.index = nodes.length;
    nodes.push(n);
    queue.push(...n.children);
  }

  // Duplicate targets.
  const seen = new Map<string, string[]>();
  for (const p of properties) {
    const key = `${JSON.stringify(p.path)}:${p.field ?? ''}`;
    seen.set(key, [...(seen.get(key) ?? []), p.row.id]);
  }
  const duplicates = [...seen.values()].filter((ids) => ids.length > 1).flat();

  // Strategy modes and matching attributes.
  for (const node of nodes) {
    node.properties.sort((a, b) => a.row.column_index - b.row.column_index);
    const idProp = node.properties.find((p) => p.isId) ?? null;
    const uniqueProp =
      node.properties.find(
        (p) => !p.isId && p.attr.isUnique && p.attr.type !== 'select' && p.attr.type !== 'pipeline',
      ) ?? null;
    if (node.isListEntries) {
      const parentAttr = node.def.attrs.find(isParentRecordAttr) ?? null;
      if (idProp) {
        node.mode = 'update';
        node.matchAttr = idProp.attr;
        node.matchProperty = idProp;
      } else if (listStrategy === 'create-or-update') {
        node.mode = 'create-or-update';
        node.matchAttr = parentAttr;
      } else {
        node.mode = 'create';
      }
    } else if (idProp) {
      node.mode = 'update';
      node.matchAttr = idProp.attr;
      node.matchProperty = idProp;
    } else if (uniqueProp) {
      node.mode = 'create-or-update';
      node.matchAttr = uniqueProp.attr;
      node.matchProperty = uniqueProp;
    } else {
      node.mode = 'create';
    }
    for (const p of node.properties) {
      p.multi = (node.multi && p === node.matchProperty) || (p.attr.isMultiselect && SPLITTABLE.has(p.attr.type));
    }
  }

  // Validation (I3).
  if (properties.length === 0) {
    issues.push({ code: 'no-mapping', message: 'You need to map at least one column to continue', propertyIds: [] });
  }
  if (duplicates.length > 0) {
    issues.push({
      code: 'duplicate-attribute',
      message: 'Multiple mappings have been added for the same attribute',
      propertyIds: duplicates,
    });
  }
  for (const node of nodes.filter((n) => n.multi)) {
    if (node.properties.length > 1) {
      issues.push({
        code: 'multiple-on-multi-reference',
        message: 'Multiple attributes have been mapped to on a multi-select reference',
        propertyIds: node.properties.map((p) => p.row.id),
      });
    } else if (node.properties.length === 1 && !node.matchProperty) {
      issues.push({
        code: 'non-unique-on-multi-reference',
        message: 'Only unique attributes can be mapped through a reference with multiple values',
        propertyIds: node.properties.map((p) => p.row.id),
      });
    }
  }
  if (nested.length > 0) {
    issues.push({
      code: 'nested-too-deeply',
      message: 'Some mapped attributes are nested too deeply.',
      propertyIds: nested,
    });
  }
  if (mixed.length > 0) {
    issues.push({
      code: 'mixed-parent-objects',
      message: 'Columns map to records of different objects through the same attribute',
      propertyIds: mixed,
    });
  }
  if (unsupported.length > 0) {
    issues.push({
      code: 'unsupported-attribute',
      message: 'Some columns are mapped to attributes that cannot be imported',
      propertyIds: unsupported,
    });
  }
  if (rootNode.isListEntries && properties.length > 0) {
    const hasParent = rootNode.children.some((c) => c.isParentRecord && c.properties.length + c.children.length > 0);
    if (!hasParent && rootNode.mode !== 'update') {
      issues.push({
        code: 'list-parent-required',
        message: 'Please map an attribute on the parent record, or map the entry ID attribute, to continue.',
        propertyIds: [],
      });
    }
  }

  const duplicateWarnings = nodes
    .filter((n) => n.mode === 'create' && !n.isListEntries && n.properties.length + n.children.length > 0)
    .map((n) => ({
      strategyIndex: n.index,
      entityDefinitionId: n.def.id,
      uniqueAttributes: n.def.attrs
        .filter((a) => !a.isArchived && (a.isUnique || isIdAttr(a)) && isMappableValueAttr(a))
        .map((a) => ({
          path: [...(n.path ?? []), { entityDefinitionId: n.def.id, attributeDefinitionId: a.id }],
          title: a.title,
        })),
    }));

  return { root: rootNode, nodes, properties, propertyNode, validation: { blocking: issues, duplicateWarnings } };
}

/** Parse configuration of a compiled property (options, members and the job's zone are filled by the resolver). */
export function parseContextBase(prop: CompiledProperty, timeZone: string): Omit<ParseContext, 'options' | 'members'> {
  return {
    type: prop.attr.type,
    multi: prop.multi,
    isId: prop.isId,
    yearOnly: prop.attr.systemAttributeType === 'foundation-date',
    field: prop.field,
    dateFormat: prop.row.date_format ?? 'iso',
    timestampFormat: prop.row.timestamp_format ?? 'iso',
    decimalSeparator: prop.row.decimal_separator ?? 'point',
    timeZone,
    currencyCode: prop.attr.config.currencyConfiguration?.defaultCurrencyCode ?? 'USD',
  };
}

/** Resolves a column target's path against the destination (for setMapping): the final attribute and its type. */
export async function resolveTargetAttr(tx: Tx, root: DefInfo, path: Path): Promise<AttrDef | null> {
  let def = root;
  for (let i = 0; i < path.length; i++) {
    const hop = path[i] as Path[number];
    if (hop.entityDefinitionId !== def.id) return null;
    const attr = def.byId.get(hop.attributeDefinitionId);
    if (!attr) return null;
    const next = path[i + 1];
    if (!next) return attr;
    if (!referenceTargets(attr).includes(next.entityDefinitionId)) return null;
    def = await loadDefinition(tx, next.entityDefinitionId);
  }
  return null;
}
