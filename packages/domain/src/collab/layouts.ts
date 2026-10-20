// Record page layouts (BACKLOG 3.10; D README §2.2–2.5, §2.8, §4.1; A README §4.11). One layout per object, seeded
// with defaults when the object is created / activated (or lazily on first read), saved by full replacement.
// Editor rules (D §4.1, ConfigureRecordPageStore): groups are locked; system elements accept only sort-order changes;
// system and locked elements cannot be removed; at least one Record Details section; at most 6 highlight widgets;
// tab slugs are unique (a "-N" suffix is appended).
import {
  type CustomLayout,
  type GetLayoutInput,
  getLayoutInputSchema,
  type LayoutElement,
  type LayoutElementType,
  type LayoutGroupIdentifier,
  layoutGroupIdentifiers,
  MAX_LAYOUT_WIDGETS,
  type Path,
  rankBetween,
  rankSequence,
  type SaveLayoutInput,
  saveLayoutInputSchema,
} from '@agentic-crm/contracts';
import { type CustomLayoutsTable, jsonb, type Selectable } from '@agentic-crm/db';
import { badRequest, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { type DefInfo, loadDefinition, loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { actorJson } from './common.ts';

type LayoutRow = Selectable<CustomLayoutsTable>;

/** Parent group / element type of each element type. */
const PARENT_OF: Record<Exclude<LayoutElementType, 'group'>, LayoutGroupIdentifier | LayoutElementType> = {
  'value-widget-v2': 'widgets-v2',
  'overview-tab': 'static-tabs',
  'activity-tab': 'tabs',
  'note-tab': 'tabs',
  'task-tab': 'tabs',
  'email-tab': 'tabs',
  'email-tab-value': 'email-tab',
  'call-tab': 'tabs',
  'agent-tab': 'tabs',
  'file-tab': 'tabs',
  'relationship-tab': 'tabs',
  'relationship-tab-value': 'relationship-tab',
  'email-action': 'actions',
  'list-action': 'actions',
  'note-action': 'actions',
  'workflow-action': 'actions',
  'task-action': 'actions',
  'sequence-action': 'actions',
  details: 'details-sidebar',
  'details-value': 'details',
  'detail-list-entries': 'details-sidebar',
};

const SYSTEM_TYPES = new Set<LayoutElementType>([
  'group',
  'overview-tab',
  'activity-tab',
  'agent-tab',
  'note-tab',
  'task-tab',
  'email-action',
  'list-action',
  'note-action',
  'workflow-action',
  'task-action',
  'sequence-action',
  'detail-list-entries',
]);
const LOCKED_TYPES = new Set<LayoutElementType>([
  'group',
  'overview-tab',
  'email-action',
  'list-action',
  'note-action',
  'workflow-action',
  'task-action',
  'sequence-action',
  'detail-list-entries',
]);
const SINGLE_TYPES = new Set<LayoutElementType>([
  'overview-tab',
  'activity-tab',
  'note-tab',
  'task-tab',
  'call-tab',
  'agent-tab',
  'file-tab',
  'detail-list-entries',
]);
const PATH_TYPES = new Set<LayoutElementType>([
  'value-widget-v2',
  'relationship-tab',
  'relationship-tab-value',
  'email-tab-value',
  'details-value',
]);
const DEFAULT_SLUGS: Partial<Record<LayoutElementType, string>> = {
  'overview-tab': 'overview',
  'activity-tab': 'activity',
  'note-tab': 'notes',
  'task-tab': 'tasks',
  'email-tab': 'emails',
  'call-tab': 'calls',
  'agent-tab': 'agent',
  'file-tab': 'files',
};

const layoutNotFound = (id: string) => notFound('The requested layout could not be found', { custom_layout_id: id });

function toLayout(row: LayoutRow): CustomLayout {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    entityDefinitionId: row.entity_definition_id,
    type: 'record-page',
    title: row.title,
    description: row.description,
    isSystemLayout: row.is_system_layout,
    version: row.version,
    elements: row.elements as unknown as LayoutElement[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Defaults (D README §2.2 actions, §2.4 tabs, §2.5 highlights)

interface DraftElement {
  type: LayoutElementType;
  title?: string;
  slug?: string;
  path?: Path;
  children?: DraftElement[];
}

/** Attribute path from `defSlug.attrSlug` hops; null when an attribute does not exist (not activated, archived). */
async function pathOf(tx: Tx, ...hops: [string, string][]): Promise<Path | null> {
  const path: Path = [];
  for (const [defSlug, attrSlug] of hops) {
    let def: DefInfo;
    try {
      def = await loadDefinition(tx, defSlug);
    } catch {
      return null;
    }
    const attr = def.bySlug.get(attrSlug);
    if (!attr || attr.isArchived) return null;
    path.push({ entityDefinitionId: def.id, attributeDefinitionId: attr.id });
  }
  return path;
}

async function widgets(tx: Tx, specs: [string, string][][]): Promise<DraftElement[]> {
  const out: DraftElement[] = [];
  for (const hops of specs) {
    const path = await pathOf(tx, ...hops);
    if (path) out.push({ type: 'value-widget-v2', path });
  }
  return out;
}

async function relationshipTab(
  tx: Tx,
  rel: [string, string],
  title: string,
  values: [string, string][],
): Promise<DraftElement[]> {
  const path = await pathOf(tx, rel);
  if (!path) return [];
  const children: DraftElement[] = [];
  for (const v of values) {
    const p = await pathOf(tx, v);
    if (p) children.push({ type: 'relationship-tab-value', path: p });
  }
  return [{ type: 'relationship-tab', title, slug: rel[1], path, children }];
}

async function emailTab(tx: Tx, sources: [string, string][][]): Promise<DraftElement> {
  const children: DraftElement[] = [];
  for (const hops of sources) {
    const p = await pathOf(tx, ...hops);
    if (p) children.push({ type: 'email-tab-value', path: p });
  }
  return { type: 'email-tab', title: 'Emails', children };
}

const tab = (type: LayoutElementType, title: string): DraftElement => ({ type, title });

async function defaultDraft(tx: Tx, def: DefInfo): Promise<Record<LayoutGroupIdentifier, DraftElement[]>> {
  const s = def.apiSlug;
  const activity = tab('activity-tab', 'Activity');
  const notes = tab('note-tab', 'Notes');
  const tasks = tab('task-tab', 'Tasks');
  const files = tab('file-tab', 'Files');
  const calls = tab('call-tab', 'Calls');
  let tabs: DraftElement[];
  let highlights: DraftElement[];
  const isPerson = def.entityType === 'person-record';
  if (def.entityType === 'company-record') {
    tabs = [
      activity,
      await emailTab(tx, [[[s, 'domains']]]),
      calls,
      ...(await relationshipTab(tx, [s, 'team'], 'Team', [
        ['people', 'email_addresses'],
        ['people', 'job_title'],
      ])),
      notes,
      tasks,
      files,
    ];
    highlights = await widgets(tx, [
      [[s, 'strongest_connection_strength']],
      [[s, 'next_calendar_interaction']],
      [[s, 'team']],
      [[s, 'estimated_arr_usd']],
      [[s, 'funding_raised_usd']],
      [[s, 'employee_range']],
    ]);
  } else if (isPerson) {
    tabs = [
      activity,
      await emailTab(tx, [[[s, 'email_addresses']]]),
      calls,
      ...(await relationshipTab(tx, [s, 'company'], 'Company', [
        ['companies', 'description'],
        ['companies', 'domains'],
      ])),
      notes,
      tasks,
      files,
    ];
    highlights = await widgets(tx, [
      [[s, 'strongest_connection_strength']],
      [[s, 'next_calendar_interaction']],
      [[s, 'company']],
      [[s, 'email_addresses']],
      [[s, 'phone_numbers']],
      [[s, 'primary_location']],
    ]);
  } else if (def.standardObjectType === 'deal') {
    tabs = [
      activity,
      notes,
      tasks,
      ...(await relationshipTab(tx, [s, 'associated_people'], 'Associated People', [
        ['people', 'email_addresses'],
        ['people', 'company'],
      ])),
      await emailTab(tx, [
        [
          [s, 'associated_company'],
          ['companies', 'domains'],
        ],
      ]),
      files,
    ];
    highlights = await widgets(tx, [
      [[s, 'stage']],
      [[s, 'value']],
      [[s, 'owner']],
      [[s, 'next_due_task']],
      [
        [s, 'associated_people'],
        ['people', 'next_interaction'],
      ],
      [
        [s, 'associated_people'],
        ['people', 'last_interaction'],
      ],
    ]);
  } else if (def.standardObjectType === 'user') {
    tabs = [
      activity,
      notes,
      tasks,
      await emailTab(tx, [
        [[s, 'primary_email_address']],
        [
          [s, 'person'],
          ['people', 'email_addresses'],
        ],
      ]),
      files,
    ];
    highlights = await widgets(tx, [
      [[s, 'person']],
      [[s, 'primary_email_address']],
      [[s, 'created_at']],
      [[s, 'created_by']],
      [[s, 'user_id']],
    ]);
  } else if (def.standardObjectType === 'workspace') {
    tabs = [
      activity,
      notes,
      tasks,
      ...(await relationshipTab(tx, [s, 'users'], 'Associated Users', [
        ['users', 'person'],
        ['users', 'user_id'],
      ])),
      await emailTab(tx, [
        [
          [s, 'company'],
          ['companies', 'domains'],
        ],
      ]),
      files,
    ];
    highlights = await widgets(tx, [[[s, 'users']], [[s, 'company']], [[s, 'created_at']]]);
  } else {
    tabs = [activity, notes, tasks, await emailTab(tx, []), files];
    highlights = await widgets(tx, [[[s, 'created_at']], [[s, 'created_by']], [[s, 'next_due_task']]]);
  }
  const actions: DraftElement[] = [
    tab('email-action', 'Compose email'),
    tab('list-action', 'Add to list'),
    tab('note-action', 'New note'),
    tab('workflow-action', 'Run workflow'),
    tab('task-action', 'New task'),
    ...(isPerson ? [tab('sequence-action', 'Enroll in sequence')] : []),
  ];
  return {
    'widgets-v2': highlights,
    'static-tabs': [tab('overview-tab', 'Overview')],
    tabs: [...tabs, tab('agent-tab', 'Agent')],
    actions,
    'details-sidebar': [tab('details', 'Record Details'), tab('detail-list-entries', 'Lists')],
  };
}

function element(
  tx: Tx,
  type: LayoutElementType,
  parent: string | null,
  sortOrder: string,
  extra: Partial<LayoutElement> = {},
): LayoutElement {
  return {
    elementId: newId(),
    parentElementId: parent,
    type,
    groupIdentifier: null,
    title: null,
    slug: DEFAULT_SLUGS[type] ?? null,
    sortOrder,
    isLocked: LOCKED_TYPES.has(type),
    isSystemElement: SYSTEM_TYPES.has(type),
    path: null,
    field: null,
    createdAt: tx.now,
    ...extra,
  };
}

function flatten(tx: Tx, draft: Record<LayoutGroupIdentifier, DraftElement[]>): LayoutElement[] {
  const out: LayoutElement[] = [];
  const groupRanks = rankSequence(layoutGroupIdentifiers.length);
  layoutGroupIdentifiers.forEach((identifier, gi) => {
    const group = element(tx, 'group', null, groupRanks[gi] as string, { groupIdentifier: identifier });
    out.push(group);
    const add = (items: DraftElement[], parent: string) => {
      const ranks = rankSequence(items.length);
      items.forEach((item, i) => {
        const el = element(tx, item.type, parent, ranks[i] as string, {
          title: item.title ?? null,
          ...(item.slug ? { slug: item.slug } : {}),
          path: item.path ?? null,
        });
        out.push(el);
        if (item.children?.length) add(item.children, el.elementId);
      });
    };
    add(draft[identifier], group.elementId);
  });
  return out;
}

/** Creates the object's default record-page layout unless it has one. */
export async function ensureDefaultLayout(tx: Tx, def: DefInfo): Promise<LayoutRow> {
  const existing = await tx.db
    .selectFrom('custom_layouts')
    .selectAll()
    .where('entity_definition_id', '=', def.id)
    .where('type', '=', 'record-page')
    .where('archived_at', 'is', null)
    .executeTakeFirst();
  if (existing) {
    let current = existing;
    let elements = current.elements as unknown as LayoutElement[];
    if (elements.some((item) => item.type === 'agent-tab')) return existing;
    current = await tx.db
      .selectFrom('custom_layouts')
      .selectAll()
      .where('workspace_id', '=', tx.workspaceId)
      .where('id', '=', existing.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    elements = current.elements as unknown as LayoutElement[];
    if (elements.some((item) => item.type === 'agent-tab')) return current;
    const tabs = elements.find((item) => item.type === 'group' && item.groupIdentifier === 'tabs');
    if (!tabs) return current;
    const siblings = elements.filter((item) => item.parentElementId === tabs.elementId);
    const last = siblings.reduce<LayoutElement | undefined>(
      (latest, item) => (!latest || item.sortOrder > latest.sortOrder ? item : latest),
      undefined,
    );
    const usedSlugs = new Set(elements.flatMap((item) => (item.slug ? [item.slug] : [])));
    let agentSlug = 'agent';
    for (let suffix = 2; usedSlugs.has(agentSlug); suffix += 1) agentSlug = `agent-${suffix}`;
    const upgraded = [
      ...elements,
      element(tx, 'agent-tab', tabs.elementId, rankBetween(last?.sortOrder ?? null, null), {
        title: 'Agent',
        slug: agentSlug,
      }),
    ].sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0));
    const updated = await tx.db
      .updateTable('custom_layouts')
      .set({ elements: jsonb(upgraded), version: current.version + 1, updated_at: tx.now, updated_by: actorJson(tx) })
      .where('id', '=', current.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    tx.emit('custom-layout', current.id, {
      entityDefinitionId: current.entity_definition_id,
      customLayoutId: current.id,
    });
    return updated;
  }
  const elements = flatten(tx, await defaultDraft(tx, def));
  const inserted = await tx.db
    .insertInto('custom_layouts')
    .values({
      id: newId(),
      workspace_id: tx.workspaceId,
      entity_definition_id: def.id,
      elements: jsonb(elements),
      created_at: tx.now,
      updated_at: tx.now,
    })
    .onConflict((oc) => oc.columns(['entity_definition_id', 'type']).where('archived_at', 'is', null).doNothing())
    .returningAll()
    .executeTakeFirst();
  if (inserted) return inserted;
  // A concurrent first read created it.
  return tx.db
    .selectFrom('custom_layouts')
    .selectAll()
    .where('entity_definition_id', '=', def.id)
    .where('type', '=', 'record-page')
    .where('archived_at', 'is', null)
    .executeTakeFirstOrThrow();
}

// ---------------------------------------------------------------------------------------------------------------
// Save validation

const invalid = (message: string, details: Record<string, unknown> = {}) =>
  badRequest('VALIDATION_ERROR', message, { ...details, reason: 'invalid-layout' });

async function validatePath(tx: Tx, path: Path, startDef: string | null, elementId: string): Promise<void> {
  const defs = await loadDefinitionsByIds(
    tx,
    path.map((h) => h.entityDefinitionId),
  );
  if (startDef !== null && path[0]?.entityDefinitionId !== startDef) {
    throw invalid('The path must start at the object of the page', { element_id: elementId });
  }
  path.forEach((hop, i) => {
    const attr = defs.get(hop.entityDefinitionId)?.byId.get(hop.attributeDefinitionId);
    if (!attr) throw invalid('The path names an unknown attribute', { element_id: elementId, hop: i });
    if (i < path.length - 1 && attr.type !== 'entity-reference') {
      throw invalid('Only record references can be followed in a path', { element_id: elementId, hop: i });
    }
  });
}

export const layoutOps = {
  async get(tx: Tx, input: GetLayoutInput): Promise<CustomLayout> {
    const data = getLayoutInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    if (def.entityType === 'interface' || def.entityType === 'collection-entry') {
      throw badRequest('VALIDATION_ERROR', `"${def.apiSlug}" has no record page`);
    }
    return toLayout(await ensureDefaultLayout(tx, def));
  },

  async byId(tx: Tx, customLayoutId: string): Promise<CustomLayout> {
    const row = await tx.db
      .selectFrom('custom_layouts')
      .selectAll()
      .where('id', '=', customLayoutId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw layoutNotFound(customLayoutId);
    return toLayout(row);
  },

  /** "Save changes": validates and stores the full element list (D §2.8). */
  async save(tx: Tx, input: SaveLayoutInput): Promise<CustomLayout> {
    const data = saveLayoutInputSchema.parse(input);
    const row = await tx.db
      .selectFrom('custom_layouts')
      .selectAll()
      .where('id', '=', data.customLayoutId)
      .where('archived_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw layoutNotFound(data.customLayoutId);
    if (data.expectedVersion !== undefined && data.expectedVersion !== row.version) {
      throw conflict('VERSION_CONFLICT', 'The layout was changed by someone else; reload and try again', {
        version: row.version,
      });
    }
    const stored = row.elements as unknown as LayoutElement[];
    const storedById = new Map(stored.map((e) => [e.elementId, e]));
    const byId = new Map<string, (typeof data.elements)[number]>();
    for (const el of data.elements) {
      if (byId.has(el.elementId)) throw invalid('Duplicate element id', { element_id: el.elementId });
      byId.set(el.elementId, el);
    }
    // Groups: the stored ones, unchanged except their rank.
    const groups = new Map<string, LayoutGroupIdentifier>();
    for (const el of data.elements.filter((e) => e.type === 'group')) {
      const before = storedById.get(el.elementId);
      if (!before || before.type !== 'group' || el.parentElementId !== null) {
        throw invalid('Groups cannot be added or changed', { element_id: el.elementId });
      }
      groups.set(el.elementId, before.groupIdentifier as LayoutGroupIdentifier);
    }
    for (const before of stored) {
      if ((before.isSystemElement || before.isLocked) && !byId.has(before.elementId)) {
        throw invalid('System elements cannot be removed', { element_id: before.elementId, type: before.type });
      }
    }
    const counts = new Map<string, number>();
    const relationshipPaths = new Set<string>();
    const slugs = new Set<string>();
    const out: LayoutElement[] = [];
    for (const el of data.elements) {
      const before = storedById.get(el.elementId);
      if (before && before.type !== el.type)
        throw invalid('An element cannot change type', { element_id: el.elementId });
      if (el.type !== 'group') {
        const parent = el.parentElementId ? byId.get(el.parentElementId) : undefined;
        if (!parent) throw invalid('Unknown parent element', { element_id: el.elementId });
        const expected = PARENT_OF[el.type];
        const actual = parent.type === 'group' ? groups.get(parent.elementId) : parent.type;
        if (actual !== expected) {
          throw invalid(`A ${el.type} element belongs under ${expected}`, { element_id: el.elementId });
        }
        if (before?.isSystemElement || before?.isLocked) {
          const same =
            before.parentElementId === el.parentElementId && JSON.stringify(before.path) === JSON.stringify(el.path);
          if (!same) throw invalid('System elements can only be reordered', { element_id: el.elementId });
        }
        const n = (counts.get(el.type) ?? 0) + 1;
        counts.set(el.type, n);
        if (SINGLE_TYPES.has(el.type) && n > 1) throw invalid(`Only one ${el.type} is allowed`, { type: el.type });
        if (PATH_TYPES.has(el.type)) {
          if (!el.path) throw invalid(`A ${el.type} element needs a path`, { element_id: el.elementId });
          const start =
            el.type === 'relationship-tab-value'
              ? await relatedDefOf(tx, byId.get(el.parentElementId as string)?.path ?? null)
              : el.type === 'email-tab-value' ||
                  el.type === 'value-widget-v2' ||
                  el.type === 'details-value' ||
                  el.type === 'relationship-tab'
                ? row.entity_definition_id
                : null;
          await validatePath(tx, el.path, start, el.elementId);
          if (el.type === 'relationship-tab') {
            if (el.path.length !== 1)
              throw invalid('A relationship tab follows one attribute', { element_id: el.elementId });
            const key = el.path[0]?.attributeDefinitionId as string;
            if (relationshipPaths.has(key))
              throw invalid('This relationship already has a tab', { element_id: el.elementId });
            relationshipPaths.add(key);
          }
        }
      }
      // Unique slugs for tabs ("-N" suffix, D §4.1).
      const frozen = before?.isLocked || before?.isSystemElement;
      let slug = frozen ? (before?.slug ?? null) : el.slug;
      if (PARENT_OF[el.type as Exclude<LayoutElementType, 'group'>] === 'tabs' || el.type === 'overview-tab') {
        const base = slug ?? DEFAULT_SLUGS[el.type] ?? (await relationshipSlug(tx, el.path)) ?? el.type;
        slug = base;
        for (let i = 1; slugs.has(slug); i++) slug = `${base}-${i}`;
        slugs.add(slug);
      }
      out.push({
        elementId: el.elementId,
        parentElementId: el.parentElementId,
        type: el.type,
        groupIdentifier: el.type === 'group' ? (groups.get(el.elementId) ?? null) : null,
        // System elements keep their title and slug (they can only be moved).
        title: frozen ? (before?.title ?? null) : el.title,
        slug,
        sortOrder: el.sortOrder,
        isLocked: LOCKED_TYPES.has(el.type),
        isSystemElement: SYSTEM_TYPES.has(el.type),
        path: el.path,
        field: el.field,
        createdAt: before?.createdAt ?? tx.now,
      });
    }
    if (groups.size !== layoutGroupIdentifiers.length) throw invalid('Every group must be present');
    if ((counts.get('details') ?? 0) < 1) {
      throw invalid('You must have at least one record details section', { type: 'details' });
    }
    if ((counts.get('value-widget-v2') ?? 0) > MAX_LAYOUT_WIDGETS) {
      throw invalid(`You've reached the limit. Remove a widget to add a new one`, { limit: MAX_LAYOUT_WIDGETS });
    }
    out.sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0));
    const updated = await tx.db
      .updateTable('custom_layouts')
      .set({
        elements: jsonb(out),
        version: row.version + 1,
        updated_at: tx.now,
        updated_by: actorJson(tx),
        is_system_layout: false,
      })
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    tx.emit('custom-layout', row.id, { entityDefinitionId: row.entity_definition_id, customLayoutId: row.id });
    return toLayout(updated);
  },
};

/** The definition a relationship tab leads to (its attribute's related object). */
async function relatedDefOf(tx: Tx, path: Path | null): Promise<string | null> {
  const hop = path?.[0];
  if (!hop) return null;
  const def = await loadDefinition(tx, hop.entityDefinitionId);
  const attr = def.byId.get(hop.attributeDefinitionId);
  return (
    attr?.relatedEntityDefinitionId ??
    attr?.config.entityReferenceConfiguration?.allowedEntityDefinitionIds?.[0] ??
    null
  );
}

async function relationshipSlug(tx: Tx, path: Path | null): Promise<string | null> {
  const hop = path?.[0];
  if (!hop) return null;
  const def = await loadDefinition(tx, hop.entityDefinitionId);
  return def.byId.get(hop.attributeDefinitionId)?.apiSlug ?? null;
}
