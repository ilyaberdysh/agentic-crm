// Entries service (BACKLOG 4.03, 4.04; C2 README §2.5–2.6, A §4.4): add records to a list with duplicate handling,
// duplicate checks (Duplicates step, bulk "Duplicate entries" dialog), remove, one entry, and a record's entries across
// lists (record page Lists section). Entry values are edited with records.* / values.* on the list's definition.
import type {
  AddEntriesInput,
  AddEntriesOutput,
  CheckDuplicatesInput,
  CheckDuplicatesOutput,
  EntriesForRecordInput,
  EntriesForRecordOutput,
  Entry,
  EntryDuplicate,
  GetEntryInput,
  RecordRef,
  RecordRefInput,
  RemoveEntriesInput,
  RemoveEntriesOutput,
  ValueInput,
} from '@agentic-crm/contracts';
import {
  addEntriesInputSchema,
  checkDuplicatesInputSchema,
  entriesForRecordInputSchema,
  getEntryInputSchema,
  removeEntriesInputSchema,
} from '@agentic-crm/contracts';
import { decodeActor } from '../actors.ts';
import { badRequest, conflict, notFound, valueError } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Policies } from '../permissions.ts';
import { engineFor } from '../records/engine.ts';
import { createRecordInTx, readValues, recordOps } from '../records/service.ts';
import { type AttrDef, loadDefinition, loadDefinitionsByIds, resolveAttribute } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { type ListInfo, loadList, PARENT_ENTITY_TYPES, toListSummary } from './model.ts';
import { emitRecordTimelines, liveEntriesOf } from './parents.ts';
import { syncListEntries } from './sync.ts';

type InstanceRow = Parameters<typeof readValues>[2][number];

const entryNotFound = (id: string) => notFound('The requested entry could not be found', { entity_instance_id: id });

/** Entries (live instances of the list) with their values, in the order of `ids` (unknown ids skipped). */
export async function loadEntries(tx: Tx, list: ListInfo, ids: string[]): Promise<Entry[]> {
  if (ids.length === 0) return [];
  const rows = await tx.db
    .selectFrom('entity_instances')
    .selectAll()
    .where('id', 'in', ids)
    .where('entity_definition_id', '=', list.def.id)
    .where('archived_at', 'is', null)
    .where('merged_at', 'is', null)
    .execute();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = [...new Set(ids)].map((id) => byId.get(id)).filter((r): r is InstanceRow => r !== undefined);
  const values = await readValues(tx, list.def, ordered, null, null);
  return ordered.map((row) => {
    const vals = values.get(row.id) ?? {};
    const parent = vals[list.parentAttr.id]?.[0]?.value as RecordRef | undefined;
    return {
      id: row.id,
      listId: list.def.id,
      parentRecord: parent
        ? { entityDefinitionId: parent.entityDefinitionId, entityInstanceId: parent.entityInstanceId }
        : { entityDefinitionId: list.def.id, entityInstanceId: row.id },
      createdAt: row.created_at,
      createdBy: decodeActor(row.created_by_type, row.created_by_id) ?? { type: 'system', id: null },
      values: vals,
    };
  });
}

/**
 * The one write path for new entries (entries.add, CSV import): creates each entry with its parent record —
 * `parent_record` is read-only for everyone but the system, so it is written as the system — then keeps the parents'
 * `list_entries` in sync and invalidates their timelines. Callers validate parents and values first and finalise the
 * engine afterwards.
 */
export async function insertEntriesInTx(
  tx: Tx,
  list: ListInfo,
  items: { entryId: string; parent: RecordRef; values: Map<AttrDef, ValueInput[]> }[],
): Promise<void> {
  if (items.length === 0) return;
  const engine = engineFor(tx);
  for (const item of items) {
    if (!list.row.parent_entity_definition_ids.includes(item.parent.entityDefinitionId)) {
      throw valueError(
        list.parentAttr.id,
        'record-type-not-allowed',
        'Records of this object cannot be added to the list',
      );
    }
    const map = new Map<AttrDef, ValueInput[]>();
    for (const [attr, inputs] of item.values) if (attr.id !== list.parentAttr.id) map.set(attr, inputs);
    map.set(list.parentAttr, [{ value: item.parent }]);
    await engine.asSystem(() => createRecordInTx(tx, list.def, item.entryId, map));
  }
  const parents = items.map((i) => i.parent);
  await syncListEntries(tx, parents);
  emitRecordTimelines(tx, parents);
}

export function entryOps(policies: Policies) {
  /**
   * Validates parent records: allowed objects of the list (allowlist), live, readable by the caller. Keeps the input
   * order and repetitions (adding the same record twice with `keep` creates two entries).
   */
  async function resolveParents(tx: Tx, list: ListInfo, refs: RecordRefInput[]): Promise<RecordRef[]> {
    const defs = new Map<string, string>();
    const out: RecordRef[] = [];
    for (const ref of refs) {
      let defId = defs.get(ref.entityDefinitionId);
      if (!defId) {
        const def = await loadDefinition(tx, ref.entityDefinitionId);
        if (!PARENT_ENTITY_TYPES.has(def.entityType) || !list.row.parent_entity_definition_ids.includes(def.id)) {
          throw valueError(
            list.parentAttr.id,
            'record-type-not-allowed',
            `Records of "${def.apiSlug}" cannot be added to this list`,
          );
        }
        await policies.assertCan(tx, def.id, 'read_entity_instance');
        defId = def.id;
        defs.set(ref.entityDefinitionId, defId);
      }
      out.push({ entityDefinitionId: defId, entityInstanceId: ref.entityInstanceId.toLowerCase() });
    }
    const ids = [...new Set(out.map((r) => r.entityInstanceId))];
    const live = await tx.db
      .selectFrom('entity_instances')
      .select(['id', 'entity_definition_id'])
      .where('id', 'in', ids)
      .where('archived_at', 'is', null)
      .where('merged_at', 'is', null)
      .execute();
    const defOf = new Map(live.map((r) => [r.id, r.entity_definition_id]));
    for (const r of out) {
      if (defOf.get(r.entityInstanceId) !== r.entityDefinitionId) {
        throw notFound('The requested record could not be found', {
          entity_definition_id: r.entityDefinitionId,
          entity_instance_id: r.entityInstanceId,
        });
      }
    }
    return out;
  }

  /** Existing live entries of the list per parent record id. */
  async function entriesByParent(tx: Tx, list: ListInfo, recordIds: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    for (const e of await liveEntriesOf(tx, recordIds)) {
      if (e.listId !== list.def.id) continue;
      out.set(e.recordId, [...(out.get(e.recordId) ?? []), e.entryId]);
    }
    return out;
  }

  async function duplicatesOf(tx: Tx, list: ListInfo, parents: RecordRef[], byParent: Map<string, string[]>) {
    const seen = new Set<string>();
    const dups: { parentRecord: RecordRef; entryIds: string[] }[] = [];
    for (const p of parents) {
      const ids = byParent.get(p.entityInstanceId);
      if (!ids || seen.has(p.entityInstanceId)) continue;
      seen.add(p.entityInstanceId);
      dups.push({ parentRecord: p, entryIds: ids });
    }
    const entries = new Map(
      (
        await loadEntries(
          tx,
          list,
          dups.flatMap((d) => d.entryIds),
        )
      ).map((e) => [e.id, e]),
    );
    return dups.map(
      (d): EntryDuplicate => ({
        parentRecord: d.parentRecord,
        entries: d.entryIds.map((id) => entries.get(id)).filter((e): e is Entry => e !== undefined),
      }),
    );
  }

  /** User-provided list attribute values (read-only attributes such as parent_record cannot be set). */
  function resolveValues(list: ListInfo, values: Record<string, ValueInput[]> | undefined): Map<AttrDef, ValueInput[]> {
    const out = new Map<AttrDef, ValueInput[]>();
    for (const [key, inputs] of Object.entries(values ?? {})) {
      const attr = resolveAttribute(list.def, key);
      if (attr.isReadOnly || attr.systemAttributeType === 'id' || attr.type === 'interaction') {
        throw badRequest('ATTRIBUTE_READ_ONLY', `Attribute "${attr.apiSlug}" is read-only`, {
          attribute_definition_id: attr.id,
        });
      }
      if (attr.isArchived) {
        throw badRequest('ATTRIBUTE_ARCHIVED', `Attribute "${attr.apiSlug}" is archived`, {
          attribute_definition_id: attr.id,
        });
      }
      out.set(attr, inputs);
    }
    return out;
  }

  /** A pipeline value written on add enters a stage with Confetti on. */
  async function celebrates(tx: Tx, values: Map<AttrDef, ValueInput[]>): Promise<boolean> {
    const stageIds = [...values.entries()]
      .filter(([attr]) => attr.type === 'pipeline')
      .flatMap(([, inputs]) => inputs.map((i) => (i.value as { pipelineStageId?: string } | null)?.pipelineStageId))
      .filter((id): id is string => typeof id === 'string');
    if (stageIds.length === 0) return false;
    const row = await tx.db
      .selectFrom('select_options')
      .select('id')
      .where('id', 'in', stageIds)
      .where('celebration_enabled', '=', true)
      .executeTakeFirst();
    return row !== undefined;
  }

  return {
    async add(tx: Tx, input: AddEntriesInput): Promise<AddEntriesOutput> {
      const data = addEntriesInputSchema.parse(input);
      const list = await loadList(tx, data.listId);
      await policies.assertCan(tx, list.def.id, 'create_entity_instance');
      if (data.entryIds && data.entryIds.length !== data.parentRecords.length) {
        throw badRequest('VALIDATION_ERROR', 'entryIds must have one id per parent record', { field: 'entryIds' });
      }
      const parents = await resolveParents(tx, list, data.parentRecords);
      const values = resolveValues(list, data.values);

      // Replays (I3): entry ids that already exist in this list are returned as they are.
      const wanted = data.entryIds?.map((id) => id.toLowerCase()) ?? [];
      const existing = wanted.length
        ? await tx.db
            .selectFrom('entity_instances')
            .select(['id', 'entity_definition_id'])
            .where('id', 'in', wanted)
            .execute()
        : [];
      for (const row of existing) {
        if (row.entity_definition_id !== list.def.id) {
          throw conflict('INSTANCE_ID_CONFLICT', 'This id is already used by a record of another object', {
            entity_instance_id: row.id,
          });
        }
      }
      const replayed = new Set(existing.map((r) => r.id));

      const engine = engineFor(tx);
      await engine.lock([...new Set(parents.map((p) => p.entityInstanceId))]);
      const byParent = await entriesByParent(
        tx,
        list,
        parents.map((p) => p.entityInstanceId),
      );
      for (const id of replayed)
        for (const [k, v] of byParent)
          byParent.set(
            k,
            v.filter((e) => e !== id),
          );
      for (const [k, v] of byParent) if (v.length === 0) byParent.delete(k);
      const duplicates = await duplicatesOf(tx, list, parents, byParent);
      if (data.onDuplicate === 'cancel' && duplicates.length > 0) {
        return { entries: await loadEntries(tx, list, [...replayed]), duplicates, celebrate: false };
      }

      const created: string[] = [];
      const touched: RecordRef[] = [];
      const items: Parameters<typeof insertEntriesInTx>[2] = [];
      for (const [i, parent] of parents.entries()) {
        const entryId = wanted[i] ?? newId();
        if (replayed.has(entryId)) {
          created.push(entryId);
          continue;
        }
        if (data.onDuplicate === 'skip' && byParent.has(parent.entityInstanceId)) continue;
        const map = new Map<AttrDef, ValueInput[]>();
        for (const [attr, inputs] of values) {
          // Client value ids only make sense for a single new entry.
          map.set(attr, parents.length === 1 ? inputs : inputs.map(({ id: _id, ...rest }) => rest));
        }
        items.push({ entryId, parent, values: map });
        created.push(entryId);
        touched.push(parent);
      }
      await insertEntriesInTx(tx, list, items);
      await engine.finalize();
      return {
        entries: await loadEntries(tx, list, created),
        duplicates,
        celebrate: touched.length > 0 && (await celebrates(tx, values)),
      };
    },

    async checkDuplicates(tx: Tx, input: CheckDuplicatesInput): Promise<CheckDuplicatesOutput> {
      const data = checkDuplicatesInputSchema.parse(input);
      const list = await loadList(tx, data.listId);
      await policies.assertCan(tx, list.def.id, 'read_entity_instance');
      const parents = await resolveParents(tx, list, data.parentRecords);
      const byParent = await entriesByParent(
        tx,
        list,
        parents.map((p) => p.entityInstanceId),
      );
      const duplicates = await duplicatesOf(tx, list, parents, byParent);
      return { duplicates, duplicateCount: duplicates.length };
    },

    /** Remove from list: entries are soft-deleted with their list attribute data (X-22). */
    async remove(tx: Tx, input: RemoveEntriesInput): Promise<RemoveEntriesOutput> {
      const data = removeEntriesInputSchema.parse(input);
      const list = await loadList(tx, data.listId);
      await policies.assertCan(tx, list.def.id, 'delete_entity_instance');
      const entries = await loadEntries(tx, list, data.entryIds);
      if (entries.length === 0) return { removedIds: [] };
      const { deletedIds } = await recordOps.deleteMany(tx, {
        entityDefinitionId: list.def.id,
        entityInstanceIds: entries.map((e) => e.id),
      });
      emitRecordTimelines(
        tx,
        entries.map((e) => e.parentRecord),
      );
      return { removedIds: deletedIds };
    },

    async get(tx: Tx, input: GetEntryInput): Promise<Entry> {
      const data = getEntryInputSchema.parse(input);
      const list = await loadList(tx, data.listId);
      await policies.assertCan(tx, list.def.id, 'read_entity_instance');
      const [entry] = await loadEntries(tx, list, [data.entryId.toLowerCase()]);
      if (!entry) throw entryNotFound(data.entryId);
      return entry;
    },

    /** The record's entries in the lists the caller can read, in sidebar order then by date added. */
    async forRecord(tx: Tx, input: EntriesForRecordInput): Promise<EntriesForRecordOutput> {
      const data = entriesForRecordInputSchema.parse(input);
      const def = await loadDefinition(tx, data.recordRef.entityDefinitionId);
      await policies.assertCan(tx, def.id, 'read_entity_instance');
      const recordId = data.recordRef.entityInstanceId.toLowerCase();
      const record = await tx.db
        .selectFrom('entity_instances')
        .select(['entity_definition_id', 'archived_at', 'merged_at'])
        .where('id', '=', recordId)
        .executeTakeFirst();
      if (!record || record.entity_definition_id !== def.id || record.archived_at || record.merged_at) {
        throw notFound('The requested record could not be found', { entity_instance_id: recordId });
      }
      const found = await liveEntriesOf(tx, [recordId]);
      const listIds = [...new Set(found.map((e) => e.listId))];
      const defs = await loadDefinitionsByIds(tx, listIds);
      const readable = new Set(
        (await policies.allowed(tx, [...defs.values()], 'read_entity_instance')).map((d) => d.id),
      );
      const lists: ListInfo[] = [];
      for (const id of listIds.filter((l) => readable.has(l))) {
        try {
          lists.push(await loadList(tx, id));
        } catch {
          // deleted list: its entries are archived anyway
        }
      }
      lists.sort((a, b) => (a.row.sort_order < b.row.sort_order ? -1 : a.row.sort_order > b.row.sort_order ? 1 : 0));
      const memberships: EntriesForRecordOutput['memberships'] = [];
      for (const list of lists) {
        const entries = await loadEntries(
          tx,
          list,
          found.filter((e) => e.listId === list.def.id).map((e) => e.entryId),
        );
        for (const entry of entries) {
          memberships.push({ listId: list.def.id, entryId: entry.id, list: toListSummary(list), entry });
        }
      }
      return { memberships };
    },
  };
}
