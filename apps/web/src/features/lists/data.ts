// Lists and entries on the client (BACKLOG 4.01–4.04; C2 README §2, §4; slice4-contracts.md). The ONE module that
// talks to the `lists.*` / `entries.*` procedures: every screen of features/lists reads and writes through it, so the
// UI does not change when the server contract settles. A list is a collection + its `collection-entry` entity
// definition (same id); entries are entity instances of that definition with the system attribute `parent_record`,
// so values, views, snapshots and history reuse the slice 1–3 machinery with `entityDefinitionId = listId`.
// Calls are typed from `AppRouter`; `toList` / `toMemberships` / `toDuplicates` map the server shapes to the client model.
import type {
  AccessScope,
  Actor,
  AttributeDefinition,
  EntityDefinition,
  RecordRef,
  ValuesMap,
} from '@agentic-crm/contracts';
import { rankAfter } from '@agentic-crm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../data/keys';
import { queryClient } from '../../data/queryClient';
import { api, inWorkspace, noteAcceptAfter, type RouterOutputs, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { attributesQuery, objectQuery } from '../attributes';

// ---- model ------------------------------------------------------------------------------------------------------

export type WorkspaceAccess = AccessScope;

export interface List {
  /** Collection id = the id of its collection-entry entity definition. */
  id: string;
  name: string;
  /** `emoji:<name>` (Attio's format), a raw emoji, or null (📋). */
  icon: string | null;
  apiSlug: string;
  /** Objects whose records can be added (C2 §2.1 "Object"; several = "Mixed"). */
  parentEntityDefinitionIds: string[];
  sortOrder: string | null;
  workspaceAccess: WorkspaceAccess | null;
  /** The caller's effective access (null until the server sends it). */
  myAccess: WorkspaceAccess | null;
  /** The list's system `parent_record` attribute, when the server names it. */
  parentRecordAttributeId: string | null;
  createdBy: Actor | null;
  createdAt: string;
  /** Number of entries when the server sends it (settings "Entries" column). */
  entryCount: number | null;
}

/** One entry of a record in a list (record page Lists section, duplicate checks). */
export interface Membership {
  listId: string;
  entryId: string;
  addedAt: string | null;
}

export interface AddEntriesResult {
  entryIds: string[];
  /** A new entry entered a stage with Confetti on. */
  celebrate: boolean;
  /** Parent records that already had entries (skipped when `onDuplicate: 'skip'`). */
  duplicates: RecordRef[];
}

export type OnDuplicate = 'cancel' | 'keep' | 'skip';

export const DEFAULT_LIST_ICON = 'emoji:clipboard';
export const DEFAULT_LIST_NAME = 'New list';

// ---- server shapes ------------------------------------------------------------------------------------------------

type ServerList = RouterOutputs['lists']['get'];
type ServerAdd = RouterOutputs['entries']['add'];
type ServerDuplicates = RouterOutputs['entries']['checkDuplicates'];
type ServerMemberships = RouterOutputs['entries']['forRecord'];

/** `lists.*` → the client list (the server always sends every field; the client model keeps nullable ones). */
export function toList(r: ServerList): List {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    apiSlug: r.apiSlug,
    parentEntityDefinitionIds: r.parentEntityDefinitionIds,
    sortOrder: r.sortOrder,
    workspaceAccess: r.workspaceAccess,
    myAccess: r.myAccess,
    parentRecordAttributeId: r.parentRecordAttributeId,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    entryCount: r.entryCount,
  };
}

/** `entries.forRecord` → one membership per entry (in sidebar order, then by date added). */
export function toMemberships(res: ServerMemberships): Membership[] {
  return res.memberships.map((m) => ({ listId: m.listId, entryId: m.entryId, addedAt: m.entry.createdAt }));
}

/** `entries.checkDuplicates` / `entries.add` duplicates → entry ids per parent record id. */
export function toDuplicates(res: Pick<ServerDuplicates, 'duplicates'>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const d of res.duplicates) {
    const ids = d.entries.map((e) => e.id);
    if (ids.length > 0)
      out.set(d.parentRecord.entityInstanceId, [...(out.get(d.parentRecord.entityInstanceId) ?? []), ...ids]);
  }
  return out;
}

function toAddResult(res: ServerAdd): AddEntriesResult {
  return {
    entryIds: res.entries.map((e) => e.id),
    duplicates: res.duplicates.map((d) => d.parentRecord),
    celebrate: res.celebrate,
  };
}

// ---- queries ---------------------------------------------------------------------------------------------------------

const membershipsKey = (ws: string, ref: RecordRef) =>
  [...keys.recordTimeline(ws, ref.entityDefinitionId, ref.entityInstanceId), 'list-entries'] as const;

/**
 * All lists the member can see, in sidebar (custom) order. `all` (admins, settings → Lists) also returns lists the
 * caller cannot open.
 */
export const listsQuery = (ws: WorkspaceRef, scope: 'readable' | 'all' = 'readable') =>
  queryOptions({
    queryKey: scope === 'all' ? ([...keys.collections(ws.id), 'all'] as const) : keys.collections(ws.id),
    queryFn: async () => {
      const lists = (await api.lists.list.query(scope === 'all' ? { scope } : {}, inWorkspace(ws))).map(toList);
      for (const l of lists) queryClient.setQueryData(keys.collection(ws.id, l.id), l);
      return sortLists(lists, 'custom');
    },
  });

export const listQuery = (ws: WorkspaceRef, listId: string) =>
  queryOptions({
    queryKey: keys.collection(ws.id, listId),
    queryFn: async () => toList(await api.lists.get.query({ listId }, inWorkspace(ws))),
    initialData: () => queryClient.getQueryData<List[]>(keys.collections(ws.id))?.find((l) => l.id === listId),
    retry: (count, error) => count < 1 && !/not.?found|404|forbidden|403/i.test(String((error as Error)?.message)),
  });

export function useLists(ws: WorkspaceRef) {
  return useQuery({ ...listsQuery(ws), enabled: Boolean(ws.id) });
}

export function useList(ws: WorkspaceRef, listId: string | null | undefined) {
  return useQuery({ ...listQuery(ws, listId ?? ''), enabled: Boolean(ws.id && listId) });
}

/** The list's entry definition (nouns "Entry"/"Entries", api slug) — the table's object. */
export function useListDefinition(ws: WorkspaceRef, listId: string | null | undefined) {
  return useQuery({ ...objectQuery(ws, listId ?? ''), enabled: Boolean(ws.id && listId) });
}

/** Attributes of the entry definition (system + list attributes). */
export function useListAttributes(ws: WorkspaceRef, listId: string | null | undefined) {
  return useQuery({ ...attributesQuery(ws, listId ?? ''), enabled: Boolean(ws.id && listId) });
}

/** Entries of one record across lists (record page Lists section, Choose list counts). */
export function useRecordMemberships(ws: WorkspaceRef, ref: RecordRef | null) {
  return useQuery({
    queryKey: membershipsKey(ws.id, ref ?? { entityDefinitionId: '', entityInstanceId: '' }),
    queryFn: async () =>
      toMemberships(await api.entries.forRecord.query({ recordRef: ref as RecordRef }, inWorkspace(ws))),
    enabled: Boolean(ws.id && ref?.entityInstanceId),
  });
}

/** Existing entries of these records in the list (Duplicates step, bulk "Checking for duplicate entries"). */
export async function checkDuplicates(
  ws: WorkspaceRef,
  listId: string,
  parentRecords: RecordRef[],
): Promise<Map<string, string[]>> {
  if (parentRecords.length === 0) return new Map();
  return toDuplicates(await api.entries.checkDuplicates.query({ listId, parentRecords }, inWorkspace(ws)));
}

// ---- system attributes of the entry definition ------------------------------------------------------------------------

/** The `parent_record` system attribute (C2 §4: required entity-reference, allowlist = parent objects). */
export function parentRecordAttribute(
  attributes: readonly AttributeDefinition[],
  attributeId?: string | null,
): AttributeDefinition | undefined {
  return (
    (attributeId ? attributes.find((a) => a.id === attributeId) : undefined) ??
    attributes.find((a) => a.apiSlug === 'parent_record') ??
    attributes.find((a) => a.systemAttributeType === 'entry-parent-record' || a.systemAttributeType === 'parent-record')
  );
}

const SYSTEM_ENTRY_SLUGS = new Set(['entry_id', 'parent_record', 'created_at', 'created_by']);

/** List attributes the Add-to-list form and record-page cards show: writable, in attribute order (C2 §2.5 A.3). */
export function writableListAttributes(attributes: readonly AttributeDefinition[]): AttributeDefinition[] {
  return [...attributes]
    .filter(
      (a) =>
        !a.isArchived &&
        !a.isHidden &&
        !a.isReadOnly &&
        !(a.isSystem && SYSTEM_ENTRY_SLUGS.has(a.apiSlug)) &&
        a.systemAttributeType !== 'id' &&
        a.type !== 'interaction' &&
        a.apiSlug !== 'parent_record',
    )
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0));
}

// ---- writes ---------------------------------------------------------------------------------------------------------

function writeList(ws: WorkspaceRef, list: List): void {
  queryClient.setQueryData(keys.collection(ws.id, list.id), list);
  queryClient.setQueryData<List[]>(keys.collections(ws.id), (prev) => {
    if (!prev) return prev;
    const next = prev.some((l) => l.id === list.id) ? prev.map((l) => (l.id === list.id ? list : l)) : [...prev, list];
    return sortLists(next, 'custom');
  });
}

function refreshLists(ws: WorkspaceRef): void {
  void queryClient.invalidateQueries({ queryKey: keys.collections(ws.id) });
  void queryClient.invalidateQueries({ queryKey: keys.objects(ws.id) });
}

export interface CreateListInput {
  name: string;
  icon: string | null;
  parentEntityDefinitionIds: string[];
  workspaceAccess?: WorkspaceAccess;
}

/** Creates a list (client-minted id, idempotent; the server adds the default "All entries table" view). */
export async function createList(ws: WorkspaceRef, input: CreateListInput): Promise<List> {
  const id = newId();
  const res = await api.lists.create.mutate({ id, ...input }, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  const list = toList(res.list);
  writeList(ws, list);
  refreshLists(ws);
  return list;
}

export async function updateList(
  ws: WorkspaceRef,
  list: List,
  patch: { name?: string; icon?: string | null; parentEntityDefinitionIds?: string[]; sortOrder?: string },
): Promise<List> {
  // Optimistic: rename / icon / reorder show at once and roll back on error.
  const optimistic: List = { ...list, ...patch } as List;
  writeList(ws, optimistic);
  try {
    const res = await api.lists.update.mutate({ listId: list.id, ...patch }, inWorkspace(ws));
    noteAcceptAfter(ws.id, res.seq);
    const merged = toList(res.list);
    writeList(ws, merged);
    if (patch.parentEntityDefinitionIds) {
      void queryClient.invalidateQueries({ queryKey: keys.attributes(ws.id, list.id) });
    }
    return merged;
  } catch (error) {
    writeList(ws, list);
    throw error;
  }
}

/** Workspace access level of a list (J permissions §2). */
export async function setListAccess(ws: WorkspaceRef, list: List, workspaceAccess: WorkspaceAccess): Promise<void> {
  writeList(ws, { ...list, workspaceAccess });
  try {
    const res = await api.lists.setAccess.mutate({ listId: list.id, workspaceAccess }, inWorkspace(ws));
    noteAcceptAfter(ws.id, res.seq);
    writeList(ws, toList(res.list));
  } catch (error) {
    writeList(ws, list);
    throw error;
  }
}

/** "<name>", "<name> (2)", "<name> (3)" … — first free name, case-insensitive (C2 §2.7). */
export function duplicateListName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const base = name.replace(/ \(\d+\)$/, '');
  if (!taken.has(base.toLowerCase()) && base !== name) return base;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})`;
}

export async function duplicateList(ws: WorkspaceRef, list: List, existingNames: readonly string[]): Promise<List> {
  const id = newId();
  const name = duplicateListName(list.name, existingNames);
  const res = await api.lists.duplicate.mutate({ listId: list.id, id, name, includeEntries: false }, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  const result = toList(res.list);
  writeList(ws, result);
  refreshLists(ws);
  return result;
}

export async function deleteList(ws: WorkspaceRef, list: List): Promise<void> {
  const res = await api.lists.delete.mutate({ listId: list.id }, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  queryClient.setQueryData<List[]>(keys.collections(ws.id), (prev) => prev?.filter((l) => l.id !== list.id));
  queryClient.removeQueries({ queryKey: keys.collection(ws.id, list.id), exact: true });
  refreshLists(ws);
}

function afterEntryWrite(ws: WorkspaceRef, listId: string, parents: readonly RecordRef[]): void {
  void queryClient.invalidateQueries({ queryKey: ['ws', ws.id, 'snapshot', listId] });
  void queryClient.invalidateQueries({ queryKey: keys.collection(ws.id, listId) });
  for (const p of parents) {
    void queryClient.invalidateQueries({
      queryKey: keys.recordTimeline(ws.id, p.entityDefinitionId, p.entityInstanceId),
    });
  }
}

/** Adds records to a list (one entry per record; `values` = list attribute values for every new entry). */
export async function addEntries(
  ws: WorkspaceRef,
  input: { listId: string; parentRecords: RecordRef[]; values?: ValuesMap; onDuplicate: OnDuplicate },
): Promise<AddEntriesResult> {
  const res = await api.entries.add.mutate(input, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  afterEntryWrite(ws, input.listId, input.parentRecords);
  return toAddResult(res);
}

/** Deletes entries (and their list attribute data). `parents` refresh the records' Lists sections. */
export async function removeEntries(
  ws: WorkspaceRef,
  listId: string,
  entryIds: string[],
  parents: readonly RecordRef[] = [],
): Promise<void> {
  const res = await api.entries.remove.mutate({ listId, entryIds }, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  afterEntryWrite(ws, listId, parents);
}

// ---- ordering -------------------------------------------------------------------------------------------------------

export type ListsSort = 'most-relevant' | 'recently-added' | 'alphabetical' | 'custom';

/** Sidebar orders (B sidebar.md §8): custom = rank; recently added = created desc; alphabetical = name. */
export function sortLists(lists: readonly List[], sort: ListsSort, relevance?: (id: string) => number): List[] {
  const out = [...lists];
  if (sort === 'alphabetical') return out.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'recently-added') return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sort === 'most-relevant' && relevance)
    return out.sort((a, b) => relevance(b.id) - relevance(a.id) || compareRank(a, b));
  return out.sort(compareRank);
}

function compareRank(a: List, b: List): number {
  return (a.sortOrder ?? '~').localeCompare(b.sortOrder ?? '~') || a.createdAt.localeCompare(b.createdAt);
}

/** A rank after the last list (new lists go to the end of the custom order). */
export function rankAfterLists(lists: readonly List[]): string | undefined {
  try {
    const last = sortLists(lists, 'custom').at(-1)?.sortOrder ?? null;
    return rankAfter(last && /^[0-9a-z]+$/.test(last) ? last : null);
  } catch {
    return undefined;
  }
}

// ---- parent objects -------------------------------------------------------------------------------------------------

/** "Company" / "Companies" of a list (its first parent object), for "+ Add Company", the record column, copy. */
export function parentNouns(
  list: Pick<List, 'parentEntityDefinitionIds'>,
  objects: readonly Pick<EntityDefinition, 'id' | 'singularNoun' | 'pluralNoun'>[],
): { singular: string; plural: string } {
  const parents = list.parentEntityDefinitionIds
    .map((id) => objects.find((o) => o.id === id))
    .filter((o): o is NonNullable<typeof o> => Boolean(o));
  if (parents.length === 1) {
    const p = parents[0] as (typeof parents)[number];
    return { singular: p.singularNoun, plural: p.pluralNoun };
  }
  return { singular: 'Record', plural: 'Records' };
}
