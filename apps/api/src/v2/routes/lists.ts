// Lists and entries (A public-api-mapping §3 #39, #42–45, #47–55; C2 README §6): list CRUD with access levels,
// entries query / create / assert by parent / get / PATCH (append multiselects) / PUT (overwrite) / delete, an
// entry's attribute values, and a record's entries. Lists created here get no default view (C2 §6, observed).
import type {
  AccessScope,
  AttributeDefinition,
  EntityDefinition,
  List,
  RecordWithValues,
} from '@agentic-crm/contracts';
import {
  assertEntryBody,
  createEntryBody,
  createListBody,
  listEntryAttributeValuesQuery,
  listRecordEntriesQuery,
  queryEntriesBody,
  replaceEntryBody,
  updateEntryBody,
  updateListBody,
  v2Operations,
} from '@agentic-crm/contracts/v2';
import { DomainError } from '@agentic-crm/domain';
import type { V2Context } from '../context';
import { PublicApiError, publicErrors, toPublicError, withHints } from '../errors';
import { FilterTranslator } from '../filters';
import {
  loadValueLookups,
  publicActor,
  publicTimestamp,
  type ValueLookups,
  valueToPublic,
  visibleAttributes,
} from '../mappers';
import { page, params, parseInput, type RouteSpec } from '../route';
import { toInternalValues } from '../values';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANGE = 5000;
const BATCH = 1000;
const DEFAULT_QUERY_LIMIT = 500;

type PublicLevel = 'full-access' | 'read-and-write' | 'read-only';

const toPublicLevel = (scope: AccessScope): PublicLevel | null =>
  scope === 'no-access' ? null : scope === 'read-write' ? 'read-and-write' : scope;
const fromPublicLevel = (level: PublicLevel | null): AccessScope =>
  level === null ? 'no-access' : level === 'read-and-write' ? 'read-write' : level;

const entryNotFound = (id: string) => publicErrors.notFound(`List entry with ID "${id}" not found.`);

function entryIdParam(raw: string | undefined): string {
  if (!raw || !UUID.test(raw)) throw entryNotFound(raw ?? '');
  return raw.toLowerCase();
}

/** Domain errors of list calls: unknown lists and entries get the public API's messages. */
async function onList<T>(key: string, fn: () => Promise<T>, entryId?: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError && err.statusCode === 404) {
      const d = err.details as Record<string, unknown>;
      if (d.list_id !== undefined) throw publicErrors.listNotFound(key);
      if (entryId && d.entity_instance_id === entryId) throw entryNotFound(entryId);
    }
    if (err instanceof DomainError && err.code === 'SLUG_IN_USE') {
      throw publicErrors.slugConflict('A list or object with this api_slug already exists. Please choose another.');
    }
    throw toPublicError(err);
  }
}

async function listToPublic(v2: V2Context, list: List) {
  const defs = await v2.allDefinitions();
  return {
    id: { workspace_id: list.workspaceId, list_id: list.id },
    api_slug: list.apiSlug,
    name: list.name,
    parent_object: list.parentEntityDefinitionIds.map((id) => defs.find((d) => d.id === id)?.apiSlug ?? id),
    workspace_access: toPublicLevel(list.workspaceAccess),
    workspace_member_access: list.memberAccess.flatMap((m) => {
      const level = toPublicLevel(m.scope);
      return level ? [{ workspace_member_id: m.memberId, level }] : [];
    }),
    created_by_actor: publicActor(list.createdBy),
    created_at: publicTimestamp(list.createdAt),
  };
}

/** `parent_object` (slug or id) of a new list; the public API answers 400 value_not_found for unknown objects. */
async function parentObject(v2: V2Context, key: string): Promise<EntityDefinition> {
  try {
    return await v2.object(key);
  } catch {
    throw publicErrors.valueNotFound(`Object with slug/ID "${key}" not found.`);
  }
}

interface EntryRendering {
  attrs: AttributeDefinition[];
  lookups: ValueLookups;
  parentAttr: AttributeDefinition;
}

async function rendering(v2: V2Context, list: EntityDefinition): Promise<EntryRendering> {
  const attrs = visibleAttributes(await v2.attributesOf(list.id));
  const parentAttr = attrs.find((a) => a.systemAttributeType === 'entry-parent-record');
  if (!parentAttr) throw publicErrors.listNotFound(list.apiSlug);
  return { attrs, lookups: await loadValueLookups(v2, attrs), parentAttr };
}

/** An entry (a record of the list's definition) → the public API's entry object. */
function entryToPublic(v2: V2Context, list: EntityDefinition, entry: RecordWithValues, r: EntryRendering) {
  const parent = entry.values[r.parentAttr.id]?.[0]?.value as
    | { entityDefinitionId: string; entityInstanceId: string }
    | undefined;
  const entryValues: Record<string, Record<string, unknown>[]> = {};
  for (const attr of r.attrs) {
    if (attr.id === r.parentAttr.id) continue;
    entryValues[attr.apiSlug] = (entry.values[attr.id] ?? []).map((row) => valueToPublic(row, attr, r.lookups));
  }
  return {
    id: { workspace_id: v2.workspaceId, list_id: list.id, entry_id: entry.record.entityInstanceId },
    parent_record_id: parent?.entityInstanceId ?? '',
    parent_object: parent ? (r.lookups.objectSlugs.get(parent.entityDefinitionId) ?? parent.entityDefinitionId) : '',
    created_at: publicTimestamp(entry.record.createdAt),
    entry_values: entryValues,
  };
}

async function entriesByIds(v2: V2Context, list: EntityDefinition, ids: string[]): Promise<RecordWithValues[]> {
  const out: RecordWithValues[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const { records } = await v2.domain.records.batchGetWithValues(v2.ctx, {
      entityDefinitionId: list.id,
      entityInstanceIds: ids.slice(i, i + BATCH),
    });
    out.push(...records);
  }
  return out;
}

async function getEntry(v2: V2Context, list: EntityDefinition, entryId: string): Promise<RecordWithValues> {
  return onList(
    list.apiSlug,
    () => v2.domain.records.get(v2.ctx, { entityDefinitionId: list.id, entityInstanceId: entryId }),
    entryId,
  );
}

/** Applies `entry_values` to an existing entry: PATCH appends to multiselects, PUT (and assert) overwrites. */
async function writeEntry(
  v2: V2Context,
  list: EntityDefinition,
  entryId: string,
  raw: Record<string, unknown>,
  mode: 'append' | 'replace',
): Promise<RecordWithValues> {
  const { values, attributes } = await toInternalValues(v2, list, raw);
  const modes: Record<string, 'append' | 'replace'> = {};
  for (const attr of attributes.values()) modes[attr.id] = attr.isMultiselect ? mode : 'replace';
  return onList(
    list.apiSlug,
    () =>
      v2.domain.records.update(v2.ctx, {
        entityDefinitionId: list.id,
        entityInstanceId: entryId,
        values,
        multiselectMode: 'replace',
        multiselectModes: modes,
      }),
    entryId,
  );
}

/** Creates one entry for a parent record (duplicates allowed, as documented for POST …/entries). */
async function createEntry(
  v2: V2Context,
  list: EntityDefinition,
  parent: { parentObject: string; parentRecordId: string },
  raw: Record<string, unknown>,
): Promise<RecordWithValues> {
  const parentDef = await parentObject(v2, parent.parentObject);
  if (!UUID.test(parent.parentRecordId)) throw publicErrors.recordNotFound(parent.parentRecordId);
  const { values } = await toInternalValues(v2, list, raw);
  const { entries } = await onList(list.apiSlug, () =>
    v2.domain.entries.add(v2.ctx, {
      listId: list.id,
      parentRecords: [{ entityDefinitionId: parentDef.id, entityInstanceId: parent.parentRecordId }],
      values,
      onDuplicate: 'keep',
    }),
  );
  const id = entries[0]?.id;
  if (!id) throw publicErrors.recordNotFound(parent.parentRecordId);
  return getEntry(v2, list, id);
}

export const listRoutes: RouteSpec[] = [
  {
    method: 'GET',
    url: '/lists',
    operationId: 'listLists',
    scopes: v2Operations.listLists.scopes,
    async handler(v2) {
      const lists = await withHints({}, () => v2.domain.lists.list(v2.ctx));
      return { data: await Promise.all(lists.map((l) => listToPublic(v2, l))) };
    },
  },
  {
    method: 'POST',
    url: '/lists',
    operationId: 'createList',
    scopes: v2Operations.createList.scopes,
    async handler(v2, request) {
      const { data } = parseInput(createListBody, request.body, 'request body');
      const parent = await parentObject(v2, data.parent_object);
      if (!/^[a-z][a-z0-9_]*$/.test(data.api_slug)) {
        throw publicErrors.validation('api_slug must be snake case (lower-case letters, digits and underscores).');
      }
      const { list } = await onList(data.api_slug, () =>
        v2.domain.lists.create(v2.ctx, {
          name: data.name,
          apiSlug: data.api_slug,
          parentEntityDefinitionIds: [parent.id],
          workspaceAccess: fromPublicLevel(data.workspace_access),
          memberAccess: data.workspace_member_access.map((m) => ({
            memberId: m.workspace_member_id.toLowerCase(),
            scope: fromPublicLevel(m.level),
          })),
          createDefaultView: false,
        }),
      );
      v2.invalidate();
      return { data: await listToPublic(v2, list) };
    },
  },
  {
    method: 'GET',
    url: '/lists/:list',
    operationId: 'getList',
    scopes: v2Operations.getList.scopes,
    async handler(v2, request) {
      const key = params(request).list ?? '';
      const def = await v2.list(key);
      const list = await onList(key, () => v2.domain.lists.get(v2.ctx, { listId: def.id }));
      return { data: await listToPublic(v2, list) };
    },
  },
  {
    method: 'PATCH',
    url: '/lists/:list',
    operationId: 'updateList',
    scopes: v2Operations.updateList.scopes,
    async handler(v2, request) {
      const key = params(request).list ?? '';
      const { data } = parseInput(updateListBody, request.body, 'request body');
      const def = await v2.list(key);
      if (data.api_slug !== undefined && !/^[a-z][a-z0-9_]*$/.test(data.api_slug)) {
        throw publicErrors.validation('api_slug must be snake case (lower-case letters, digits and underscores).');
      }
      let list = await onList(key, () => v2.domain.lists.get(v2.ctx, { listId: def.id }));
      if (data.name !== undefined || data.api_slug !== undefined) {
        list = await onList(key, () =>
          v2.domain.lists.update(v2.ctx, {
            listId: def.id,
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.api_slug !== undefined ? { apiSlug: data.api_slug } : {}),
          }),
        );
      }
      if (data.workspace_access !== undefined || data.workspace_member_access !== undefined) {
        // workspace_member_access is the complete set of member levels: members left out lose their override.
        const wanted = new Map(
          (data.workspace_member_access ?? []).map((m) => [
            m.workspace_member_id.toLowerCase(),
            fromPublicLevel(m.level),
          ]),
        );
        const memberAccess =
          data.workspace_member_access === undefined
            ? undefined
            : [
                ...[...wanted].map(([memberId, scope]) => ({ memberId, scope })),
                ...list.memberAccess
                  .filter((m) => !wanted.has(m.memberId))
                  .map((m) => ({ memberId: m.memberId, scope: null })),
              ];
        list = await onList(key, () =>
          v2.domain.lists.setAccess(v2.ctx, {
            listId: def.id,
            ...(data.workspace_access !== undefined ? { workspaceAccess: fromPublicLevel(data.workspace_access) } : {}),
            ...(memberAccess ? { memberAccess } : {}),
          }),
        );
      }
      v2.invalidate();
      return { data: await listToPublic(v2, list) };
    },
  },
  {
    method: 'POST',
    url: '/lists/:list/entries/query',
    operationId: 'queryEntries',
    scopes: v2Operations.queryEntries.scopes,
    kind: 'read',
    async handler(v2, request) {
      const body = parseInput(queryEntriesBody, request.body ?? {}, 'request body');
      const list = await v2.list(params(request).list ?? '');
      if (body.filter !== undefined && body.filter_view_id !== undefined) {
        throw publicErrors.filterError('`filter` and `filter_view_id` cannot be used together.');
      }
      const translator = new FilterTranslator(v2);
      const filter = await translator.filter(list, body.filter);
      const sorts = await translator.sorts(list, body.sorts);
      const limit = body.limit ?? DEFAULT_QUERY_LIMIT;
      const offset = body.offset ?? 0;
      if (!Number.isInteger(limit) || limit < 0) throw publicErrors.validation('limit must be a non-negative integer.');
      if (!Number.isInteger(offset) || offset < 0)
        throw publicErrors.validation('offset must be a non-negative integer.');
      const ids: string[] = [];
      if (limit > 0) {
        try {
          const first = await v2.domain.views.query(v2.ctx, {
            entityDefinitionId: list.id,
            ...(body.filter_view_id ? { viewId: body.filter_view_id } : { filter }),
            sorts,
            initialRange: { start: offset, size: Math.min(limit, RANGE) },
          });
          ids.push(...first.ids);
          while (ids.length < limit && offset + ids.length < first.total) {
            const chunk = await v2.domain.views.chunk(v2.ctx, {
              snapshotId: first.snapshotId,
              start: offset + ids.length,
              size: Math.min(RANGE, limit - ids.length),
            });
            if (chunk.ids.length === 0) break;
            ids.push(...chunk.ids);
          }
        } catch (err) {
          const e = toPublicError(err, { object: list.apiSlug });
          if (body.filter_view_id && (e.statusCode === 404 || e.code === 'validation_type')) {
            throw publicErrors.filterError(`View with ID "${body.filter_view_id}" was not found on this list.`);
          }
          throw e;
        }
      }
      const r = await rendering(v2, list);
      return { data: (await entriesByIds(v2, list, ids)).map((e) => entryToPublic(v2, list, e, r)) };
    },
  },
  {
    method: 'POST',
    url: '/lists/:list/entries',
    operationId: 'createEntry',
    scopes: v2Operations.createEntry.scopes,
    async handler(v2, request) {
      const { data } = parseInput(createEntryBody, request.body, 'request body');
      const list = await v2.list(params(request).list ?? '');
      const entry = await createEntry(
        v2,
        list,
        { parentObject: data.parent_object, parentRecordId: data.parent_record_id },
        data.entry_values,
      );
      return { data: entryToPublic(v2, list, entry, await rendering(v2, list)) };
    },
  },
  {
    method: 'PUT',
    url: '/lists/:list/entries',
    operationId: 'assertEntry',
    scopes: v2Operations.assertEntry.scopes,
    async handler(v2, request) {
      const { data } = parseInput(assertEntryBody, request.body, 'request body');
      const list = await v2.list(params(request).list ?? '');
      const parentDef = await parentObject(v2, data.parent_object);
      const { duplicates } = await onList(list.apiSlug, () =>
        v2.domain.entries.checkDuplicates(v2.ctx, {
          listId: list.id,
          parentRecords: [{ entityDefinitionId: parentDef.id, entityInstanceId: data.parent_record_id }],
        }),
      );
      const existing = duplicates[0]?.entries ?? [];
      if (existing.length > 1) {
        throw new PublicApiError(
          400,
          'invalid_request_error',
          'multiple_match_results',
          `Multiple entries of record "${data.parent_record_id}" exist in this list.`,
        );
      }
      const entry = existing[0]
        ? await writeEntry(v2, list, existing[0].id, data.entry_values, 'replace')
        : await createEntry(
            v2,
            list,
            { parentObject: data.parent_object, parentRecordId: data.parent_record_id },
            data.entry_values,
          );
      return { data: entryToPublic(v2, list, entry, await rendering(v2, list)) };
    },
  },
  {
    method: 'GET',
    url: '/lists/:list/entries/:entry_id',
    operationId: 'getEntry',
    scopes: v2Operations.getEntry.scopes,
    async handler(v2, request) {
      const p = params(request);
      const list = await v2.list(p.list ?? '');
      const entry = await getEntry(v2, list, entryIdParam(p.entry_id));
      return { data: entryToPublic(v2, list, entry, await rendering(v2, list)) };
    },
  },
  ...(['PATCH', 'PUT'] as const).map(
    (method): RouteSpec => ({
      method,
      url: '/lists/:list/entries/:entry_id',
      operationId: method === 'PATCH' ? 'updateEntry' : 'replaceEntry',
      scopes: method === 'PATCH' ? v2Operations.updateEntry.scopes : v2Operations.replaceEntry.scopes,
      async handler(v2, request) {
        const p = params(request);
        const body = parseInput(method === 'PATCH' ? updateEntryBody : replaceEntryBody, request.body, 'request body');
        const list = await v2.list(p.list ?? '');
        const entryId = entryIdParam(p.entry_id);
        await getEntry(v2, list, entryId);
        const entry = await writeEntry(
          v2,
          list,
          entryId,
          body.data.entry_values,
          method === 'PATCH' ? 'append' : 'replace',
        );
        return { data: entryToPublic(v2, list, entry, await rendering(v2, list)) };
      },
    }),
  ),
  {
    method: 'DELETE',
    url: '/lists/:list/entries/:entry_id',
    operationId: 'deleteEntry',
    scopes: v2Operations.deleteEntry.scopes,
    async handler(v2, request) {
      const p = params(request);
      const list = await v2.list(p.list ?? '');
      const entryId = entryIdParam(p.entry_id);
      const { removedIds } = await onList(list.apiSlug, () =>
        v2.domain.entries.remove(v2.ctx, { listId: list.id, entryIds: [entryId] }),
      );
      if (removedIds.length === 0) throw entryNotFound(entryId);
      return {};
    },
  },
  {
    method: 'GET',
    url: '/lists/:list/entries/:entry_id/attributes/:attribute/values',
    operationId: 'listEntryAttributeValues',
    scopes: v2Operations.listEntryAttributeValues.scopes,
    async handler(v2, request) {
      const p = params(request);
      const query = parseInput(listEntryAttributeValuesQuery, request.query, 'query parameters');
      const list = await v2.list(p.list ?? '');
      const entryId = entryIdParam(p.entry_id);
      const attr = await v2.attribute(list, p.attribute ?? '');
      await getEntry(v2, list, entryId);
      const ref = { entityDefinitionId: list.id, attributeDefinitionId: attr.id, entityInstanceId: entryId };
      let rows: RecordWithValues['values'][string];
      if (query.show_historic) {
        rows = [];
        let before: string | undefined;
        for (;;) {
          const batch = await onList(list.apiSlug, () =>
            v2.domain.values.history(v2.ctx, { ...ref, limit: 500, ...(before ? { before } : {}) }),
          );
          rows.push(...batch.values);
          if (batch.values.length < 500) break;
          before = batch.values.at(-1)?.activeFrom;
        }
        rows.reverse();
      } else {
        const result = await onList(list.apiSlug, () =>
          v2.domain.values.list(v2.ctx, {
            entityDefinitionId: list.id,
            attributeDefinitionId: attr.id,
            entityInstanceIds: [entryId],
          }),
        );
        const entry = result.values[entryId];
        if (!entry || entry.state !== 'complete') throw entryNotFound(entryId);
        rows = entry.value.values;
      }
      const lookups = await loadValueLookups(v2, [attr]);
      return { data: page(rows, query).map((row) => valueToPublic(row, attr, lookups)) };
    },
  },
  {
    method: 'GET',
    url: '/objects/:object/records/:record_id/entries',
    operationId: 'listRecordEntries',
    scopes: v2Operations.listRecordEntries.scopes,
    async handler(v2, request) {
      const p = params(request);
      const query = parseInput(listRecordEntriesQuery, request.query, 'query parameters');
      const def = await v2.object(p.object ?? '');
      const recordId = p.record_id ?? '';
      if (!UUID.test(recordId)) throw publicErrors.recordNotFound(recordId);
      const { memberships } = await withHints({ object: def.apiSlug, recordId }, () =>
        v2.domain.entries.forRecord(v2.ctx, {
          recordRef: { entityDefinitionId: def.id, entityInstanceId: recordId.toLowerCase() },
        }),
      );
      return {
        data: page(memberships, query).map((m) => ({
          list_id: m.listId,
          list_api_slug: m.list.apiSlug,
          entry_id: m.entryId,
          created_at: publicTimestamp(m.entry.createdAt),
        })),
      };
    },
  },
];
