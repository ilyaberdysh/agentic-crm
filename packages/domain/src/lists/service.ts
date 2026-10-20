// Lists service (BACKLOG 4.01, 4.02; C2 README §2.1, §2.2, §2.7; J objects-lists §4; J permissions §2, §5): create,
// update, duplicate (new ids for everything, X-02), delete (soft), access levels. A list is a collection row plus a
// collection-entry entity definition with the same id; its system attributes are Entry ID, Parent Record, Added to
// list at and Added to list by; list attributes, views and entries use the ordinary schema / views / records services.
import {
  type AccessScope,
  type AttributeValue,
  type CreateListInput,
  type CreateListOutput,
  createListInputSchema,
  DEFAULT_LIST_ICON,
  DEFAULT_LIST_WORKSPACE_ACCESS,
  type DefaultValue,
  type DeleteListInput,
  type DuplicateListInput,
  deleteListInputSchema,
  duplicateListInputSchema,
  type List,
  type ListListsInput,
  type ListRefInput,
  listListsInputSchema,
  listRefInputSchema,
  type Path,
  type Predicate,
  rankAfter,
  type SetListAccessInput,
  setListAccessInputSchema,
  type UpdateListInput,
  updateListInputSchema,
  type ValueInput,
  type View,
} from '@agentic-crm/contracts';
import { jsonb, sql } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Policies } from '../permissions.ts';
import { engineFor } from '../records/engine.ts';
import { createRecordInTx, readValues, recordOps } from '../records/service.ts';
import { type AttrDef, type DefInfo, invalidateDefinitions, loadDefinition } from '../schema/model.ts';
import { type AttributeSpec, insertAttributeDefinitions, insertEntityDefinition, slugify } from '../schema/service.ts';
import type { Tx } from '../tx.ts';
import { insertView, viewOps } from '../views/service.ts';
import { listEvent } from '../webhooks/events.ts';
import { forgetGrants, loadGrants, maxScope, putGrant } from './access.ts';
import {
  isWorkspaceAdmin,
  type ListInfo,
  listNotFound,
  loadList,
  loadLists,
  PARENT_ENTITY_TYPES,
  PARENT_RECORD_TYPE,
  toLists,
} from './model.ts';
import { emitRecordTimelines, parentsOfEntries } from './parents.ts';
import { syncListEntries } from './sync.ts';

const PT0S: DefaultValue = { type: 'dynamic', identifier: 'PT0S' };
const CURRENT_USER: DefaultValue = { type: 'dynamic', identifier: 'current-user' };
export const DEFAULT_LIST_VIEW_TITLE = 'All entries table';

/** System attributes of every list (C2 §4, J objects-lists §4.2 "Attributes"). */
function systemAttributes(parentIds: string[]): AttributeSpec[] {
  return [
    {
      apiSlug: 'entry_id',
      title: 'Entry ID',
      type: 'text',
      systemAttributeType: 'id',
      isSystem: true,
      isUnique: true,
      isReadOnly: true,
    },
    {
      apiSlug: 'parent_record',
      title: 'Parent Record',
      type: 'entity-reference',
      systemAttributeType: PARENT_RECORD_TYPE,
      isSystem: true,
      isRequired: true,
      // Written by the entries service only: an entry's parent cannot be changed (A §4.4).
      isReadOnly: true,
      config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: parentIds } },
    },
    {
      apiSlug: 'created_at',
      title: 'Added to list at',
      type: 'timestamp',
      systemAttributeType: 'created-at',
      isSystem: true,
      isReadOnly: true,
      defaultValue: PT0S,
    },
    {
      apiSlug: 'created_by',
      title: 'Added to list by',
      type: 'actor-reference',
      systemAttributeType: 'created-by',
      isSystem: true,
      isReadOnly: true,
      defaultValue: CURRENT_USER,
    },
  ];
}

/** Parent objects: active record objects (people, companies, standard and custom objects), deduplicated. */
async function resolveParents(tx: Tx, refs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const ref of refs) {
    const def = await loadDefinition(tx, ref);
    if (!PARENT_ENTITY_TYPES.has(def.entityType) || def.isArchived) {
      throw badRequest('VALIDATION_ERROR', `Records of "${def.apiSlug}" cannot be added to lists`, {
        entity_definition_id: def.id,
        field: 'parent_object',
      });
    }
    if (!out.includes(def.id)) out.push(def.id);
  }
  return out;
}

async function takenSlugs(tx: Tx): Promise<Set<string>> {
  const rows = await tx.db.selectFrom('entity_definitions').select('api_slug').execute();
  return new Set(rows.map((r) => r.api_slug));
}

function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Workspace-level default for new lists (workspace settings may override the observed Read and write, X-06). */
async function defaultWorkspaceAccess(tx: Tx): Promise<AccessScope> {
  const row = await tx.db
    .selectFrom('workspaces')
    .select('settings')
    .where('id', '=', tx.workspaceId)
    .executeTakeFirst();
  // `workspace.settings.update` writes `defaultWorkspaceAccess.list` (slice 6); `defaultListWorkspaceAccess` is the
  // slice-4 key, still honoured for workspaces that set it before.
  const settings = row?.settings as
    | { defaultWorkspaceAccess?: { list?: unknown }; defaultListWorkspaceAccess?: unknown }
    | null
    | undefined;
  const value = settings?.defaultWorkspaceAccess?.list ?? settings?.defaultListWorkspaceAccess;
  return value === 'full-access' || value === 'read-write' || value === 'read-only' || value === 'no-access'
    ? value
    : DEFAULT_LIST_WORKSPACE_ACCESS;
}

async function assertMembers(tx: Tx, memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return;
  const rows = await tx.db.selectFrom('workspace_members').select('id').where('id', 'in', memberIds).execute();
  const found = new Set(rows.map((r) => r.id));
  const missing = memberIds.find((m) => !found.has(m));
  if (missing) throw notFound('The workspace member could not be found', { workspace_member_id: missing });
}

function emitList(tx: Tx, listId: string): void {
  tx.emit('collection', listId, { listId });
  tx.emit('collection-list', null);
}

interface CreateSpec {
  id: string;
  name: string;
  icon: string | null;
  apiSlug?: string | undefined;
  parentIds: string[];
  workspaceAccess: AccessScope;
  memberAccess: { memberId: string; scope: AccessScope }[];
}

/** Inserts the definition, system attributes, collection row and grants of a new list. */
async function insertList(tx: Tx, spec: CreateSpec): Promise<ListInfo> {
  const clash = await tx.db.selectFrom('entity_definitions').select('id').where('id', '=', spec.id).executeTakeFirst();
  if (clash) throw conflict('ID_CONFLICT', 'This id is already used by another object or list', { list_id: spec.id });
  const taken = await takenSlugs(tx);
  if (spec.apiSlug && taken.has(spec.apiSlug)) {
    throw conflict('SLUG_IN_USE', 'This slug is already in use', { conflicting_field: 'api_slug' });
  }
  const apiSlug = spec.apiSlug ?? uniqueSlug(slugify(spec.name).replace(/^attribute$/, 'list'), taken);
  const iface = await tx.db
    .selectFrom('entity_definitions')
    .select('id')
    .where('api_slug', '=', 'list_entries')
    .where('entity_type', '=', 'interface')
    .executeTakeFirst();
  const def = await insertEntityDefinition(tx, {
    id: spec.id,
    entityType: 'collection-entry',
    apiSlug,
    singularNoun: 'Entry',
    pluralNoun: 'Entries',
    icon: spec.icon,
    interfaceIds: iface ? [iface.id] : [],
  });
  await insertAttributeDefinitions(tx, def, systemAttributes(spec.parentIds));
  const last = await tx.db
    .selectFrom('collections')
    .select((eb) => eb.fn.max('sort_order').as('m'))
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  await tx.db
    .insertInto('collections')
    .values({
      id: spec.id,
      workspace_id: tx.workspaceId,
      name: spec.name,
      icon: spec.icon,
      sort_order: rankAfter(last?.m ?? null),
      parent_entity_definition_ids: spec.parentIds,
      created_by: jsonb(tx.ctx.actor),
      created_at: tx.now,
      updated_at: tx.now,
    })
    .execute();
  await putGrant(tx, spec.id, { type: 'workspace', id: tx.workspaceId }, spec.workspaceAccess);
  const grants = new Map(spec.memberAccess.map((m) => [m.memberId, m.scope]));
  const creator = actingMemberId(tx.ctx);
  // The creator always gets Full access (J objects-lists §4.1, X-06).
  if (creator) grants.set(creator, 'full-access');
  await assertMembers(tx, [...grants.keys()]);
  for (const [memberId, scope] of grants)
    await putGrant(tx, spec.id, { type: 'workspace-member', id: memberId }, scope);
  emitList(tx, spec.id);
  listEvent(tx, 'created', spec.id);
  invalidateDefinitions(tx);
  return loadList(tx, spec.id);
}

/** "<name> (2)", "<name> (3)", … — the first name not used by a live list (case-insensitive, C2 §2.7). */
async function freeName(tx: Tx, name: string): Promise<string> {
  const rows = await tx.db.selectFrom('collections').select('name').where('deleted_at', 'is', null).execute();
  const used = new Set(rows.map((r) => r.name.toLowerCase()));
  const base = name.replace(/ \(\d+\)$/, '');
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate.slice(0, 200);
  }
}

/** Replaces every string equal to a key of `ids` inside a JSON value (UUIDs are unique, so this remaps safely). */
function remapIds<T>(value: T, ids: Map<string, string>): T {
  if (typeof value === 'string') return (ids.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => remapIds(v, ids)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapIds(v, ids)])) as T;
  }
  return value;
}

/** Read form → write form (only domains and emails differ). */
function toWriteForm(attr: AttrDef, value: unknown): unknown {
  const v = value as Record<string, unknown>;
  if (attr.type === 'domain') return v.normalizedDomain;
  if (attr.type === 'email-address') return v.originalEmailAddress ?? v.normalizedEmailAddress;
  return value;
}

export function listOps(policies: Policies) {
  const flagsOf = (tx: Tx) => async (infos: ListInfo[]) =>
    policies.flags(
      tx,
      infos.map((i) => i.def),
    );
  const one = async (tx: Tx, info: ListInfo): Promise<List> => (await toLists(tx, [info], flagsOf(tx)))[0] as List;

  async function create(tx: Tx, input: CreateListInput): Promise<CreateListOutput> {
    const data = createListInputSchema.parse(input);
    const id = data.id ?? newId();
    const existing = await tx.db.selectFrom('collections').select('id').where('id', '=', id).executeTakeFirst();
    if (existing) {
      // Idempotent replay: the list as it is now, with its first view.
      const info = await loadList(tx, id);
      const [view] = await viewOps.list(tx, { entityDefinitionId: id });
      return { list: await one(tx, info), view: view ?? null };
    }
    const info = await insertList(tx, {
      id,
      name: data.name,
      icon: data.icon === undefined ? DEFAULT_LIST_ICON : data.icon,
      apiSlug: data.apiSlug,
      parentIds: await resolveParents(tx, data.parentEntityDefinitionIds),
      workspaceAccess: data.workspaceAccess ?? (await defaultWorkspaceAccess(tx)),
      memberAccess: data.memberAccess ?? [],
    });
    let view: View | null = null;
    if (data.createDefaultView) {
      const viewId = await insertView(tx, info.def, {
        ...(data.defaultViewId ? { id: data.defaultViewId } : {}),
        type: 'table',
        title: DEFAULT_LIST_VIEW_TITLE,
      });
      view = await viewOps.get(tx, viewId);
    }
    return { list: await one(tx, info), view };
  }

  return {
    create,

    /** Lists in sidebar order: readable ones, or (admins, `scope: 'all'`) every live list. */
    async list(tx: Tx, input: ListListsInput = { scope: 'readable' }): Promise<List[]> {
      const data = listListsInputSchema.parse(input);
      if (data.scope === 'all' && !(await isWorkspaceAdmin(tx))) {
        throw forbidden('Only workspace admins can see every list');
      }
      const infos = await loadLists(tx);
      const flags = await flagsOf(tx)(infos);
      const visible = data.scope === 'all' ? infos : infos.filter((i) => flags.get(i.def.id)?.read_entity_definition);
      return toLists(tx, visible, async () => flags);
    },

    /** One list; members without access get 403 (admins see it, to grant themselves access). */
    async get(tx: Tx, input: ListRefInput): Promise<List> {
      const data = listRefInputSchema.parse(input);
      const info = await loadList(tx, data.listId);
      const flags = (await flagsOf(tx)([info])).get(info.def.id);
      if (!flags?.read_entity_definition && !(await isWorkspaceAdmin(tx))) {
        throw forbidden('No access to this list', { list_id: info.row.id, action: 'read_entity_definition' });
      }
      return one(tx, info);
    },

    async update(tx: Tx, input: UpdateListInput): Promise<List> {
      const data = updateListInputSchema.parse(input);
      const info = await loadList(tx, data.listId);
      const configures =
        data.name !== undefined ||
        data.icon !== undefined ||
        data.apiSlug !== undefined ||
        data.parentEntityDefinitionIds !== undefined;
      // Renaming / re-parenting needs Full access; moving the list in the sidebar only needs to see it.
      await policies.assertCan(tx, info.def.id, configures ? 'update_entity_definition' : 'read_entity_definition');
      if (data.apiSlug !== undefined && data.apiSlug !== info.def.apiSlug && (await takenSlugs(tx)).has(data.apiSlug)) {
        throw conflict('SLUG_IN_USE', 'This slug is already in use', { conflicting_field: 'api_slug' });
      }
      const parents =
        data.parentEntityDefinitionIds !== undefined
          ? await resolveParents(tx, data.parentEntityDefinitionIds)
          : undefined;
      await tx.db
        .updateTable('collections')
        .set({
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.icon !== undefined ? { icon: data.icon } : {}),
          ...(data.sortOrder !== undefined ? { sort_order: data.sortOrder } : {}),
          ...(parents ? { parent_entity_definition_ids: parents } : {}),
          updated_at: tx.now,
        })
        .where('id', '=', info.row.id)
        .execute();
      if (data.icon !== undefined || data.apiSlug !== undefined) {
        await tx.db
          .updateTable('entity_definitions')
          .set({
            ...(data.icon !== undefined ? { icon: data.icon } : {}),
            ...(data.apiSlug !== undefined ? { api_slug: data.apiSlug } : {}),
            updated_at: tx.now,
          })
          .where('id', '=', info.def.id)
          .execute();
        tx.emit('entity-definition', info.def.id);
        tx.emit('entity-definition-list', null);
      }
      if (parents) {
        // Existing entries keep their parents; new entries must come from the new objects.
        const config = {
          ...info.parentAttr.config,
          entityReferenceConfiguration: { allowedEntityDefinitionIds: parents },
        };
        await tx.db
          .updateTable('attribute_definitions')
          .set({ config: jsonb(config), updated_at: tx.now })
          .where('id', '=', info.parentAttr.id)
          .execute();
        tx.emit('attribute-definition', info.parentAttr.id, { entityDefinitionId: info.def.id });
        tx.emit('attribute-definition-list', info.def.id, { entityDefinitionId: info.def.id });
      }
      invalidateDefinitions(tx);
      emitList(tx, info.row.id);
      listEvent(tx, 'updated', info.row.id);
      return one(tx, await loadList(tx, info.row.id));
    },

    /**
     * Duplicate (C2 §2.7, decision X-02): a new list with new ids for its definition, attributes, options, stages and
     * views (filters, sorts, columns and kanban settings remapped to the new ids), the same parents, icon and grants
     * (the duplicating member gets Full access), and — only with `includeEntries` — copies of the live entries.
     */
    async duplicate(tx: Tx, input: DuplicateListInput): Promise<List> {
      const data = duplicateListInputSchema.parse(input);
      const src = await loadList(tx, data.listId);
      await policies.assertCan(tx, src.def.id, 'read_entity_definition');
      const id = data.id ?? newId();
      const replay = await tx.db.selectFrom('collections').select('id').where('id', '=', id).executeTakeFirst();
      if (replay) return one(tx, await loadList(tx, id));
      const grants = (await loadGrants(tx, [src.row.id])).get(src.row.id);
      const dst = await insertList(tx, {
        id,
        name: data.name ?? (await freeName(tx, src.row.name)),
        icon: src.row.icon,
        parentIds: src.row.parent_entity_definition_ids,
        workspaceAccess: grants?.workspace ?? DEFAULT_LIST_WORKSPACE_ACCESS,
        memberAccess: [...(grants?.members.entries() ?? [])].map(([memberId, scope]) => ({ memberId, scope })),
      });

      // Ids: the definition, system attributes by type, custom attributes and their options/stages (pre-minted).
      const ids = new Map<string, string>([[src.def.id, dst.def.id]]);
      for (const attr of src.def.attrs.filter((a) => a.isSystem)) {
        const twin = dst.def.attrs.find((a) => a.systemAttributeType === attr.systemAttributeType);
        if (twin) ids.set(attr.id, twin.id);
      }
      const custom = src.def.attrs.filter((a) => !a.isSystem && !a.isArchived && !a.relationshipAttributeId);
      for (const attr of custom) ids.set(attr.id, newId());
      const options = custom.length
        ? await tx.db
            .selectFrom('select_options')
            .selectAll()
            .where(
              'attribute_id',
              'in',
              custom.map((a) => a.id),
            )
            .orderBy('sort_order')
            .execute()
        : [];
      for (const o of options) ids.set(o.id, newId());
      await insertAttributeDefinitions(
        tx,
        dst.def,
        custom.map((a) => ({
          id: ids.get(a.id) as string,
          apiSlug: a.apiSlug,
          title: a.title,
          description: a.description,
          type: a.type,
          isMultiselect: a.isMultiselect,
          isUnique: a.isUnique,
          isRequired: a.isRequired,
          isHistoric: a.isHistoric,
          config: a.config,
          defaultValue: a.defaultValue
            ? { ...a.defaultValue, identifier: remapJsonText(a.defaultValue.identifier, ids) }
            : null,
          sortOrder: a.sortOrder,
        })),
      );
      if (options.length > 0) {
        await tx.db
          .insertInto('select_options')
          .values(
            options.map((o) => ({
              ...o,
              id: ids.get(o.id) as string,
              entity_definition_id: dst.def.id,
              attribute_id: ids.get(o.attribute_id) as string,
              created_by: jsonb(tx.ctx.actor),
              created_at: tx.now,
              updated_at: tx.now,
            })),
          )
          .execute();
        for (const attrId of new Set(options.map((o) => ids.get(o.attribute_id) as string))) {
          tx.emit('select-option-list', attrId, { entityDefinitionId: dst.def.id, attributeDefinitionId: attrId });
        }
      }
      const fresh = await loadDefinition(tx, dst.def.id);

      // Views with filters, sorts, columns and kanban settings pointing at the new ids.
      for (const view of await viewOps.list(tx, { entityDefinitionId: src.def.id })) {
        await insertView(tx, fresh, {
          type: view.type,
          title: view.title,
          sortOrder: view.sortOrder,
          filter: remapIds(view.filter, ids) as Predicate | null,
          sorts: view.sorts.map((s) => ({
            path: remapIds(s.path, ids),
            direction: s.direction,
            ...(s.field ? { field: s.field } : {}),
          })),
          columns: view.columns.map((c) => ({
            path: remapIds(c.path, ids) as Path,
            field: c.field,
            title: c.title,
            tableColumnWidth: c.tableColumnWidth,
            tableColumnAggregationType: c.tableColumnAggregationType,
            displayConfiguration: c.displayConfiguration,
            sortOrder: c.sortOrder,
          })),
          kanbanPivotPath: remapIds(view.kanbanPivotPath, ids),
          ...(view.kanban
            ? {
                kanban: {
                  ...(view.kanban.groupBy ? { groupBy: remapIds(view.kanban.groupBy, ids) } : {}),
                  hiddenStageIds: remapIds(view.kanban.hiddenStageIds, ids),
                  showLabels: view.kanban.showLabels,
                  showNoStage: view.kanban.showNoStage,
                  showTimeInStage: view.kanban.showTimeInStage,
                  calculation: remapIds(view.kanban.calculation, ids),
                },
              }
            : {}),
          tableRecordColumnWidth: view.tableRecordColumnWidth,
        });
      }

      if (data.includeEntries) await copyEntries(tx, src, fresh, custom, ids);
      return one(tx, await loadList(tx, dst.row.id));
    },

    /** Delete (C2 §2.7 "permanently" for users): soft — entries archived, views hidden, slug freed (X-22). */
    async delete(tx: Tx, input: DeleteListInput): Promise<{ id: string }> {
      const data = deleteListInputSchema.parse(input);
      const info = await loadList(tx, data.listId);
      await policies.assertCan(tx, info.def.id, 'delete_entity_definition');
      const entries = await tx.db
        .selectFrom('entity_instances')
        .select('id')
        .where('entity_definition_id', '=', info.def.id)
        .where('archived_at', 'is', null)
        .where('merged_at', 'is', null)
        .execute();
      const entryIds = entries.map((e) => e.id);
      const parents = await parentsOfEntries(tx, entryIds);
      if (entryIds.length > 0) {
        await recordOps.deleteMany(tx, { entityDefinitionId: info.def.id, entityInstanceIds: entryIds });
        emitRecordTimelines(tx, parents);
      }
      const views = await tx.db
        .updateTable('entity_views')
        .set({ is_archived: true, updated_at: tx.now })
        .where('entity_definition_id', '=', info.def.id)
        .returning('id')
        .execute();
      if (views.length > 0) {
        const deleted = await tx.db
          .deleteFrom('favorites')
          .where('favorite_type', 'in', ['collection-view', 'entity-view'])
          .where(
            'target_id',
            'in',
            views.map((v) => v.id),
          )
          .returning('member_id')
          .execute();
        for (const memberId of new Set(deleted.map((d) => d.member_id))) {
          const user = await tx.db
            .selectFrom('workspace_members')
            .select('user_id')
            .where('id', '=', memberId)
            .executeTakeFirst();
          if (user) tx.emit('favorite-list', memberId, { memberId }, { userIds: [user.user_id] });
        }
      }
      await tx.db
        .updateTable('entity_definitions')
        .set({
          is_archived: true,
          api_slug: `${info.def.apiSlug}__deleted_${info.def.id.slice(0, 8)}`,
          updated_at: tx.now,
        })
        .where('id', '=', info.def.id)
        .execute();
      await tx.db
        .updateTable('collections')
        .set({ deleted_at: tx.now, deleted_by: jsonb(tx.ctx.actor), updated_at: tx.now })
        .where('id', '=', info.row.id)
        .execute();
      forgetGrants(tx);
      invalidateDefinitions(tx);
      tx.emit('entity-definition', info.def.id);
      tx.emit('entity-definition-list', null);
      tx.emit('entity-view-list', info.def.id, { entityDefinitionId: info.def.id });
      emitList(tx, info.row.id);
      listEvent(tx, 'deleted', info.row.id);
      return { id: info.row.id };
    },

    /** Workspace level and member overrides (J permissions §5); Full access on the list or a workspace admin. */
    async setAccess(tx: Tx, input: SetListAccessInput): Promise<List> {
      const data = setListAccessInputSchema.parse(input);
      const info = await loadList(tx, data.listId);
      const flags = (await flagsOf(tx)([info])).get(info.def.id);
      if (!flags?.administrate_entity_definition_permissions && !(await isWorkspaceAdmin(tx))) {
        throw forbidden('You do not have access to update these permissions.', {
          list_id: info.row.id,
          action: 'administrate_entity_definition_permissions',
        });
      }
      if (data.workspaceAccess) {
        await putGrant(tx, info.row.id, { type: 'workspace', id: tx.workspaceId }, data.workspaceAccess);
      }
      const members = data.memberAccess ?? [];
      await assertMembers(
        tx,
        members.filter((m) => m.scope !== null).map((m) => m.memberId),
      );
      for (const m of members) {
        await putGrant(tx, info.row.id, { type: 'workspace-member', id: m.memberId }, m.scope);
      }
      // Clients refetch resolved policies on definition invalidations.
      tx.emit('entity-definition', info.def.id);
      emitList(tx, info.row.id);
      return one(tx, info);
    },
  };
}

/** Static default identifiers are JSON text: remap option / stage ids inside them. */
function remapJsonText(text: string, ids: Map<string, string>): string {
  try {
    return JSON.stringify(remapIds(JSON.parse(text) as unknown, ids));
  } catch {
    return text;
  }
}

/** Copies the live entries of `src` into `dst` (same parents, custom attribute values with remapped option ids). */
async function copyEntries(
  tx: Tx,
  src: ListInfo,
  dst: DefInfo,
  custom: AttrDef[],
  ids: Map<string, string>,
): Promise<void> {
  const rows = await tx.db
    .selectFrom('entity_instances')
    .selectAll()
    .where('entity_definition_id', '=', src.def.id)
    .where('archived_at', 'is', null)
    .where('merged_at', 'is', null)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  if (rows.length === 0) return;
  const archived = new Set(
    (
      await tx.db
        .selectFrom('select_options')
        .select('id')
        .where('entity_definition_id', '=', dst.id)
        .where('is_archived', '=', true)
        .execute()
    ).map((o) => o.id),
  );
  const values = await readValues(tx, src.def, rows, [src.parentAttr.id, ...custom.map((a) => a.id)], null);
  const engine = engineFor(tx);
  const parentAttr = dst.attrs.find((a) => a.systemAttributeType === PARENT_RECORD_TYPE) as AttrDef;
  const parents: { entityDefinitionId: string; entityInstanceId: string }[] = [];
  for (const row of rows) {
    const current = values.get(row.id) ?? {};
    const parent = current[src.parentAttr.id]?.[0]?.value as { entityDefinitionId: string; entityInstanceId: string };
    if (!parent) continue;
    const map = new Map<AttrDef, ValueInput[]>([[parentAttr, [{ value: parent }]]]);
    for (const attr of custom) {
      const copy = dst.byId.get(ids.get(attr.id) as string);
      const vals = (current[attr.id] ?? []) as AttributeValue[];
      if (!copy || vals.length === 0) continue;
      const inputs = vals
        .map((v) => remapIds(toWriteForm(attr, v.value), ids))
        .filter((v) => {
          const ref = (v as { selectOptionId?: string; pipelineStageId?: string } | null) ?? {};
          return !archived.has(ref.selectOptionId ?? ref.pipelineStageId ?? '');
        })
        .map((value) => ({ value }));
      if (inputs.length > 0) map.set(copy, inputs);
    }
    await engine.asSystem(() => createRecordInTx(tx, dst, newId(), map));
    parents.push(parent);
  }
  await syncListEntries(tx, parents);
  await engine.finalize();
  emitRecordTimelines(tx, parents);
}

export { listNotFound };
