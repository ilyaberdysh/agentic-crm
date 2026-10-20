// Records and values service (A §4.5, §4.7; internal-api-shapes §4.4; decisions X-22 delete, A I-7 PUT replays).

import type { AttributeValue } from '@agentic-crm/contracts';
import {
  type AttributeValuesOutput,
  type BatchGetRecordsInput,
  type BatchGetRecordsOutput,
  type BatchGetRecordsWithValuesInput,
  type BatchGetRecordsWithValuesOutput,
  batchGetRecordsInputSchema,
  batchGetRecordsWithValuesInputSchema,
  type CreateRecordInput,
  type CreateRecordOutput,
  createRecordInputSchema,
  type DeleteRecordInput,
  deleteRecordInputSchema,
  type FindByUniqueValuesInput,
  type FindByUniqueValuesOutput,
  findByUniqueValuesInputSchema,
  type GetRecordInput,
  getRecordInputSchema,
  type ListValuesInput,
  type ListValuesOutput,
  listValuesInputSchema,
  type MergeRecordsInput,
  mergeRecordsInputSchema,
  type PutValueInput,
  putValueInputSchema,
  type RecordHeader,
  type RecordWithValues,
  type ReorderValueInput,
  type RestoreRecordInput,
  type Result,
  type RetireValueInput,
  reorderValueInputSchema,
  restoreRecordInputSchema,
  retireValueInputSchema,
  type UpdateRecordInput,
  updateRecordInputSchema,
  type ValueHistoryInput,
  type ValueInput,
  valueHistoryInputSchema,
} from '@agentic-crm/contracts';
import { type EntityInstancesTable, type Selectable, sql } from '@agentic-crm/db';
import { decodeActor, encodeActor } from '../actors.ts';
import { cascadeRecordDelete, relinkRecordChildren, restoreRecordChildren } from '../collab/record-children.ts';
import { badRequest, conflict, notFound, valueError } from '../errors.ts';
import { newId } from '../ids.ts';
import { liveEntriesOf } from '../lists/parents.ts';
import { syncListEntries } from '../lists/sync.ts';
import { deleteProjectionRows, insertProjectionRows } from '../projection.ts';
import { type AttrDef, type DefInfo, loadDefinition, resolveAttribute } from '../schema/model.ts';
import { refreshSearchIndex } from '../search/indexer.ts';
import { addIsoDuration } from '../time.ts';
import type { Tx } from '../tx.ts';
import { canonicalFromRow } from '../values/canonical.ts';
import { parseValue } from '../values/codecs.ts';
import { recordEvent, recordMergedEvent } from '../webhooks/events.ts';
import { engineFor, toAttributeValue, type ValueRow } from './engine.ts';

type InstanceRow = Selectable<EntityInstancesTable>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MERGEABLE = new Set(['person-record', 'company-record']);

export function toHeader(row: InstanceRow, accurateAt: string): RecordHeader {
  return {
    workspaceId: row.workspace_id,
    entityDefinitionId: row.entity_definition_id,
    entityInstanceId: row.id,
    version: Number(row.version),
    createdAt: row.created_at,
    createdBy: decodeActor(row.created_by_type, row.created_by_id) ?? { type: 'system', id: null },
    archivedAt: row.archived_at,
    mergedAt: row.merged_at,
    mergedIntoEntityInstanceId: row.merged_into_id,
    accurateAt,
  };
}

async function loadInstance(tx: Tx, id: string): Promise<InstanceRow | undefined> {
  return tx.db.selectFrom('entity_instances').selectAll().where('id', '=', id).executeTakeFirst();
}

const isLive = (row: InstanceRow) => row.archived_at === null && row.merged_at === null;

/** Loads a live record of `def` or throws 404. */
async function requireLive(
  tx: Tx,
  def: DefInfo,
  id: string,
  code: 'NOT_FOUND' | 'BASE_ENTITY_INSTANCE_NOT_FOUND' | 'TARGET_ENTITY_INSTANCE_NOT_FOUND' = 'NOT_FOUND',
): Promise<InstanceRow> {
  const row = await loadInstance(tx, id);
  if (!row || row.entity_definition_id !== def.id || !isLive(row)) {
    throw notFound('The requested record could not be found', { entity_instance_id: id }, code);
  }
  return row;
}

function assertRecordsAllowed(tx: Tx, def: DefInfo): void {
  if (def.entityType === 'interface') throw badRequest('VALIDATION_ERROR', 'Interfaces have no records');
  if (def.isArchived && tx.ctx.actor.type !== 'system') {
    throw badRequest('VALIDATION_ERROR', `The object "${def.apiSlug}" is not active`);
  }
}

/** Resolves `{<attribute id or slug>: inputs}` against the definition. */
function resolveValuesMap(def: DefInfo, values: Record<string, ValueInput[]>): Map<AttrDef, ValueInput[]> {
  const out = new Map<AttrDef, ValueInput[]>();
  for (const [key, inputs] of Object.entries(values)) out.set(resolveAttribute(def, key), inputs);
  return out;
}

/** Values to write on create for attributes the caller did not provide (system values and defaults). */
function defaultInputs(tx: Tx, attr: AttrDef): ValueInput[] | null {
  const actor = tx.ctx.actor;
  if (attr.systemAttributeType === 'created-at') return [{ value: tx.now }];
  if (attr.systemAttributeType === 'created-by') {
    return actor.id && UUID_RE.test(actor.id)
      ? [{ value: { referencedActorType: actor.type, referencedActorId: actor.id } }]
      : null;
  }
  const dv = attr.defaultValue;
  if (!dv) return null;
  if (dv.type === 'dynamic') {
    if (attr.type === 'timestamp') return [{ value: addIsoDuration(tx.now, dv.identifier) }];
    if (attr.type === 'date') return [{ value: addIsoDuration(tx.now, dv.identifier).slice(0, 10) }];
    if (
      attr.type === 'actor-reference' &&
      dv.identifier === 'current-user' &&
      actor.type === 'workspace-member' &&
      actor.id
    ) {
      return [{ value: { referencedActorType: 'workspace-member', referencedActorId: actor.id } }];
    }
    return null;
  }
  const parsed = JSON.parse(dv.identifier) as unknown[];
  return parsed.map((value) => ({ value }));
}

/** Read form → write form (only domains and emails differ). */
function toWriteForm(attr: AttrDef, value: unknown): unknown {
  const v = value as Record<string, unknown>;
  if (attr.type === 'domain') return v.normalizedDomain;
  if (attr.type === 'email-address') return v.originalEmailAddress ?? v.normalizedEmailAddress;
  return value;
}

/**
 * Creates a record with values (shared by records.create, workspace bootstrap, member records and merge).
 * The instance row, projection row, values, defaults and required checks happen in the caller's transaction.
 */
export async function createRecordInTx(
  tx: Tx,
  def: DefInfo,
  id: string,
  values: Map<AttrDef, ValueInput[]>,
): Promise<void> {
  const engine = engineFor(tx);
  const actor = encodeActor(tx.ctx.actor);
  await tx.db
    .insertInto('entity_instances')
    .values({
      id,
      workspace_id: tx.workspaceId,
      entity_definition_id: def.id,
      created_at: tx.now,
      created_by_type: actor.type,
      created_by_id: actor.id,
    })
    .execute();
  await engine.lock([id]);
  await insertProjectionRows(tx, def, [id]);
  const provided = new Set([...values.keys()].map((a) => a.id));
  const withValue = new Set<string>();
  for (const [attr, inputs] of values) {
    await engine.setAttribute(def, id, attr, inputs);
    if (inputs.length > 0) withValue.add(attr.id);
  }
  for (const attr of def.attrs) {
    if (provided.has(attr.id) || attr.isArchived) continue;
    const inputs = defaultInputs(tx, attr);
    if (!inputs) continue;
    const systemManaged = attr.systemAttributeType === 'created-at' || attr.systemAttributeType === 'created-by';
    // System-managed attributes are written with system privileges even when a member creates the record.
    if (systemManaged) await engine.asSystem(() => engine.setAttribute(def, id, attr, inputs));
    else await engine.setAttribute(def, id, attr, inputs);
    withValue.add(attr.id);
  }
  const missing = def.attrs.filter(
    (a) => a.isRequired && !a.isArchived && a.systemAttributeType !== 'id' && !withValue.has(a.id),
  );
  if (missing.length > 0) {
    throw valueError(missing[0]?.id as string, 'required', `Required attribute "${missing[0]?.title}" has no value`);
  }
  tx.emit('entity-instance', id, { entityDefinitionId: def.id });
  tx.emit('snapshot-selection', def.id, { entityDefinitionId: def.id });
  recordEvent(tx, def, 'created', id);
}

/** Current (or point-in-time) values of records, keyed by instance then attribute. */
export async function readValues(
  tx: Tx,
  def: DefInfo,
  instances: InstanceRow[],
  attrIds: string[] | null,
  activeAt: string | null,
): Promise<Map<string, Record<string, AttributeValue[]>>> {
  const out = new Map<string, Record<string, AttributeValue[]>>(instances.map((i) => [i.id, {}]));
  if (instances.length === 0) return out;
  const rows = await tx.db
    .selectFrom('attribute_values')
    .selectAll()
    .where(
      'instance_id',
      'in',
      instances.map((i) => i.id),
    )
    .$if(attrIds !== null, (q) => q.where('attribute_id', 'in', attrIds as string[]))
    .$if(activeAt === null, (q) => q.where('active_until', 'is', null))
    .$if(activeAt !== null, (q) =>
      q
        .where('active_from', '<=', activeAt as string)
        .where((eb) => eb.or([eb('active_until', 'is', null), eb('active_until', '>', activeAt as string)])),
    )
    .orderBy('instance_id')
    .orderBy('attribute_id')
    .orderBy('sort_order')
    .orderBy('active_from')
    .orderBy('id')
    .execute();
  for (const row of rows) {
    const attr = def.byId.get(row.attribute_id);
    if (!attr) continue;
    const map = out.get(row.instance_id) as Record<string, AttributeValue[]>;
    (map[attr.id] ??= []).push(toAttributeValue(attr, row));
  }
  // record_id is not stored: it is the instance id.
  for (const attr of def.attrs.filter((a) => a.systemAttributeType === 'id')) {
    if (attrIds !== null && !attrIds.includes(attr.id)) continue;
    for (const inst of instances) {
      if (activeAt !== null && inst.created_at > activeAt) continue;
      (out.get(inst.id) as Record<string, AttributeValue[]>)[attr.id] = [
        {
          id: inst.id,
          workspaceId: inst.workspace_id,
          entityDefinitionId: def.id,
          entityInstanceId: inst.id,
          attributeDefinitionId: attr.id,
          attributeType: attr.type,
          value: inst.id,
          activeFrom: inst.created_at,
          activeUntil: null,
          sortOrder: null,
          createdBy: decodeActor(inst.created_by_type, inst.created_by_id) ?? { type: 'system', id: null },
          deactivatedBy: null,
        },
      ];
    }
  }
  return out;
}

async function recordWithValues(
  tx: Tx,
  def: DefInfo,
  id: string,
  activeAt: string | null = null,
): Promise<RecordWithValues> {
  const row = await loadInstance(tx, id);
  if (!row) throw notFound('The requested record could not be found', { entity_instance_id: id });
  const values = await readValues(tx, def, [row], null, activeAt);
  return { record: toHeader(row, tx.now), values: values.get(id) ?? {} };
}

async function currentAttributeValues(
  tx: Tx,
  def: DefInfo,
  instanceId: string,
  attr: AttrDef,
): Promise<AttributeValuesOutput> {
  const row = (await loadInstance(tx, instanceId)) as InstanceRow;
  const values = await readValues(tx, def, [row], [attr.id], null);
  return { values: values.get(instanceId)?.[attr.id] ?? [], accurateAt: tx.now };
}

async function loadValueRow(tx: Tx, instanceId: string, attr: AttrDef, valueId: string): Promise<ValueRow> {
  const row = await tx.db.selectFrom('attribute_values').selectAll().where('id', '=', valueId).executeTakeFirst();
  if (!row || row.instance_id !== instanceId || row.attribute_id !== attr.id) {
    throw notFound('The requested attribute value could not be found', { attribute_value_id: valueId });
  }
  return row;
}

export const recordOps = {
  /** PUT create with a client UUID (I3). Replays return the stored record unchanged with created=false. */
  async create(tx: Tx, input: CreateRecordInput): Promise<CreateRecordOutput> {
    const data = createRecordInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    assertRecordsAllowed(tx, def);
    const existing = await loadInstance(tx, data.entityInstanceId);
    if (existing) {
      if (existing.entity_definition_id !== def.id) {
        throw conflict('INSTANCE_ID_CONFLICT', 'This id is already used by a record of another object', {
          entity_instance_id: data.entityInstanceId,
        });
      }
      return { ...(await recordWithValues(tx, def, existing.id)), created: false };
    }
    await createRecordInTx(tx, def, data.entityInstanceId, resolveValuesMap(def, data.values));
    await engineFor(tx).finalize();
    return { ...(await recordWithValues(tx, def, data.entityInstanceId)), created: true };
  },

  /** PATCH several attributes in one transaction. */
  async update(tx: Tx, input: UpdateRecordInput): Promise<RecordWithValues> {
    const data = updateRecordInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const engine = engineFor(tx);
    await engine.lock([data.entityInstanceId]);
    await requireLive(tx, def, data.entityInstanceId);
    for (const [key, inputs] of Object.entries(data.values)) {
      const mode = data.multiselectModes?.[key] ?? data.multiselectMode;
      await engine.setAttribute(def, data.entityInstanceId, resolveAttribute(def, key), inputs, mode);
    }
    await engine.finalize();
    return recordWithValues(tx, def, data.entityInstanceId);
  },

  /** One record with its current values, or the values active at `activeAt`. */
  async get(tx: Tx, input: GetRecordInput): Promise<RecordWithValues> {
    const data = getRecordInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    await requireLive(tx, def, data.entityInstanceId);
    return recordWithValues(tx, def, data.entityInstanceId, data.activeAt ?? null);
  },

  /** Batch header read with per-id state (internal-api-shapes §1.1). */
  async batchGet(tx: Tx, input: BatchGetRecordsInput): Promise<BatchGetRecordsOutput> {
    const data = batchGetRecordsInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const rows = await tx.db
      .selectFrom('entity_instances')
      .selectAll()
      .where('id', 'in', data.entityInstanceIds)
      .where('entity_definition_id', '=', def.id)
      .execute();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const records: Record<string, Result<RecordHeader>> = {};
    for (const id of data.entityInstanceIds) {
      const row = byId.get(id);
      records[id] =
        row && isLive(row)
          ? { state: 'complete', value: toHeader(row, tx.now) }
          : { state: 'error', error: 'NOT_FOUND' };
    }
    return { records, accurateAt: tx.now };
  },

  /** Live records holding any of the given values in a unique attribute (values normalised like writes). */
  async findByUniqueValues(tx: Tx, input: FindByUniqueValuesInput): Promise<FindByUniqueValuesOutput> {
    const data = findByUniqueValuesInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const attr = resolveAttribute(def, data.attributeDefinitionId);
    if (!attr.isUnique) {
      throw badRequest('VALIDATION_ERROR', `Attribute "${attr.apiSlug}" is not unique`, {
        attribute_definition_id: attr.id,
        reason: 'not-unique',
      });
    }
    const keys = [
      ...new Set(
        data.values.map((v) => parseValue(attr, v.value)?.canonical).filter((k): k is string => k !== undefined),
      ),
    ];
    if (keys.length === 0) return { entityInstanceIds: [] };
    const rows = await tx.db
      .selectFrom('attribute_values')
      .select('instance_id')
      .where('attribute_id', '=', attr.id)
      .where('unique_key', 'in', keys)
      .where('active_until', 'is', null)
      .orderBy('instance_id')
      .execute();
    return { entityInstanceIds: [...new Set(rows.map((r) => r.instance_id))] };
  },

  /** Live records with all current values in one read (public API list/query pages). */
  async batchGetWithValues(tx: Tx, input: BatchGetRecordsWithValuesInput): Promise<BatchGetRecordsWithValuesOutput> {
    const data = batchGetRecordsWithValuesInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    if (data.entityInstanceIds.length === 0) return { records: [], accurateAt: tx.now };
    const rows = await tx.db
      .selectFrom('entity_instances')
      .selectAll()
      .where('id', 'in', data.entityInstanceIds)
      .where('entity_definition_id', '=', def.id)
      .execute();
    const live = new Map(rows.filter(isLive).map((r) => [r.id, r]));
    const ordered = data.entityInstanceIds.map((id) => live.get(id)).filter((r): r is InstanceRow => r !== undefined);
    const values = await readValues(tx, def, ordered, null, null);
    return {
      records: ordered.map((row) => ({ record: toHeader(row, tx.now), values: values.get(row.id) ?? {} })),
      accurateAt: tx.now,
    };
  },

  /**
   * Soft delete (X-22): the record disappears for users (projection row removed, references to it retired, unique
   * values released); values and history stay for audit and restore. Idempotent.
   */
  async delete(tx: Tx, input: DeleteRecordInput): Promise<RecordHeader> {
    const data = deleteRecordInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const engine = engineFor(tx);
    await engine.lock([data.entityInstanceId]);
    const row = await loadInstance(tx, data.entityInstanceId);
    if (!row || row.entity_definition_id !== def.id) {
      throw notFound('The requested record could not be found', { entity_instance_id: data.entityInstanceId });
    }
    if (row.archived_at !== null || row.merged_at !== null) return toHeader(row, tx.now);
    await detachInstances(tx, def, [row.id], { merged: null });
    await engine.finalize();
    return toHeader((await loadInstance(tx, row.id)) as InstanceRow, tx.now);
  },

  /**
   * Soft delete of many records of one object in one transaction (bulk delete over a selection): same effects as
   * `delete` per record; ids that are unknown, of another object or already deleted are skipped.
   */
  async deleteMany(
    tx: Tx,
    input: { entityDefinitionId: string; entityInstanceIds: string[] },
  ): Promise<{ deletedIds: string[]; skipped: number }> {
    const def = await loadDefinition(tx, input.entityDefinitionId);
    const ids = [...new Set(input.entityInstanceIds)];
    if (ids.length === 0) return { deletedIds: [], skipped: 0 };
    const engine = engineFor(tx);
    await engine.lock(ids);
    const rows = await tx.db.selectFrom('entity_instances').selectAll().where('id', 'in', ids).execute();
    const live = new Set(rows.filter((r) => r.entity_definition_id === def.id && isLive(r)).map((r) => r.id));
    const deletedIds = input.entityInstanceIds.filter((id) => live.has(id));
    if (deletedIds.length > 0) {
      await detachInstances(tx, def, deletedIds, { merged: null });
      await engine.finalize();
    }
    return { deletedIds, skipped: input.entityInstanceIds.length - deletedIds.length };
  },

  /** Admin/API restore of a soft-deleted record (unique values re-claimed; references to it are not restored). */
  async restore(tx: Tx, input: RestoreRecordInput): Promise<RecordWithValues> {
    const data = restoreRecordInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const engine = engineFor(tx);
    await engine.lock([data.entityInstanceId]);
    const row = await loadInstance(tx, data.entityInstanceId);
    if (!row || row.entity_definition_id !== def.id || row.merged_at !== null) {
      throw notFound('The requested record could not be found', { entity_instance_id: data.entityInstanceId });
    }
    if (row.archived_at === null) return recordWithValues(tx, def, row.id);
    for (const attr of def.attrs.filter((a) => a.isUnique)) {
      for (const value of await engine.currentValues(row.id, attr.id)) {
        const key = canonicalFromRow(attr.type, value);
        const clash = await tx.db
          .selectFrom('attribute_values')
          .select('instance_id')
          .where('attribute_id', '=', attr.id)
          .where('unique_key', '=', key)
          .where('active_until', 'is', null)
          .executeTakeFirst();
        if (clash) {
          throw conflict('UNIQUE_CONSTRAINT_VIOLATION', `Another record already has this value for "${attr.title}"`, {
            attribute_definition_id: attr.id,
            entity_instance_ids: [clash.instance_id],
          });
        }
        await tx.db.updateTable('attribute_values').set({ unique_key: key }).where('id', '=', value.id).execute();
      }
    }
    await tx.db
      .updateTable('entity_instances')
      .set({ archived_at: null, archived_by_type: null, archived_by_id: null })
      .where('id', '=', row.id)
      .execute();
    await insertProjectionRows(tx, def, [row.id]);
    await refreshSearchIndex(tx, [row.id], null);
    await engine.remirrorRelationships(def, row.id);
    await restoreRecordChildren(tx, def, row.id, row.archived_at);
    if (def.entityType !== 'collection-entry') await restoreEntriesOf(tx, row.id, row.archived_at);
    tx.emit('entity-instance', row.id, { entityDefinitionId: def.id });
    tx.emit('snapshot-selection', def.id, { entityDefinitionId: def.id });
    await engine.finalize();
    return recordWithValues(tx, def, row.id);
  },

  /**
   * Merge (D §3.10): a new record takes the target's single values (falling back to the base's) and the union of
   * multi values (target first); references to either source are re-pointed to it; both sources are marked merged.
   */
  async merge(tx: Tx, input: MergeRecordsInput): Promise<RecordWithValues> {
    const data = mergeRecordsInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    if (!MERGEABLE.has(def.entityType)) {
      throw badRequest('MERGING_NOT_SUPPORTED_FOR_ENTITY_TYPE', `Records of "${def.apiSlug}" cannot be merged`);
    }
    if (data.baseEntityInstanceId === data.targetEntityInstanceId) {
      throw badRequest('SELF_MERGE', 'You cannot merge a record into itself');
    }
    const engine = engineFor(tx);
    await engine.lock([data.baseEntityInstanceId, data.targetEntityInstanceId]);
    const mergedId = data.mergedEntityInstanceId ?? newId();
    const prior = await loadInstance(tx, data.baseEntityInstanceId);
    if (prior?.merged_into_id && prior.merged_into_id === mergedId) return recordWithValues(tx, def, mergedId); // replay
    const base = await requireLive(tx, def, data.baseEntityInstanceId, 'BASE_ENTITY_INSTANCE_NOT_FOUND');
    const target = await requireLive(tx, def, data.targetEntityInstanceId, 'TARGET_ENTITY_INSTANCE_NOT_FOUND');
    const current = await readValues(tx, def, [base, target], null, null);
    const baseValues = current.get(base.id) ?? {};
    const targetValues = current.get(target.id) ?? {};
    const merged = new Map<AttrDef, ValueInput[]>();
    for (const attr of def.attrs) {
      if (attr.isArchived || attr.isReadOnly || attr.systemAttributeType === 'id') continue;
      const t = targetValues[attr.id] ?? [];
      const b = baseValues[attr.id] ?? [];
      let chosen: AttributeValue[];
      if (attr.isMultiselect) {
        const seen = new Set<string>();
        chosen = [...t, ...b].filter((v) => {
          const key = JSON.stringify(v.value);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      } else {
        chosen = t.length > 0 ? t : b;
      }
      if (attr.type === 'entity-reference') {
        // A reference between the two sources would point at a merged-away record.
        const sources = new Set([base.id, target.id]);
        chosen = chosen.filter((v) => !sources.has((v.value as { entityInstanceId: string }).entityInstanceId));
      }
      if (chosen.length > 0)
        merged.set(
          attr,
          chosen.map((v) => ({ value: toWriteForm(attr, v.value) })),
        );
    }
    const inbound = await detachInstances(tx, def, [base.id, target.id], { merged: mergedId });
    await createRecordInTx(tx, def, mergedId, merged);
    // Notes, tasks, comments, files and favorites follow the merged record (D §3.10); the target has priority.
    await relinkRecordChildren(tx, def, [target.id, base.id], mergedId);
    // Plain (non-relationship) references to a source now point at the merged record; relationship inverses were
    // re-created by mirroring the merged record's own relationship values.
    for (const { def: refDef, attr, row } of inbound) {
      if (attr.relationshipAttributeId) continue;
      const repoint = () =>
        engine.setAttribute(
          refDef,
          row.instance_id,
          attr,
          [{ value: { entityDefinitionId: def.id, entityInstanceId: mergedId } }],
          attr.isMultiselect ? 'append' : 'replace',
        );
      // List entries follow the merged record (D §3.10): their read-only parent_record is re-pointed by the system.
      if (attr.isReadOnly) await engine.asSystem(repoint);
      else await repoint();
    }
    await syncListEntries(tx, [{ entityDefinitionId: def.id, entityInstanceId: mergedId }]);
    await engine.finalize();
    return recordWithValues(tx, def, mergedId);
  },

  /** Batch read of one attribute for many records, optionally at a point in time. */
  async listValues(tx: Tx, input: ListValuesInput): Promise<ListValuesOutput> {
    const data = listValuesInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const attr = resolveAttribute(def, data.attributeDefinitionId);
    const rows = await tx.db
      .selectFrom('entity_instances')
      .selectAll()
      .where('id', 'in', data.entityInstanceIds)
      .where('entity_definition_id', '=', def.id)
      .execute();
    const live = rows.filter(isLive);
    const values = await readValues(tx, def, live, [attr.id], data.activeAt ?? null);
    const out: ListValuesOutput['values'] = {};
    for (const id of data.entityInstanceIds) {
      const map = values.get(id);
      out[id] = map
        ? { state: 'complete', value: { values: map[attr.id] ?? [] } }
        : { state: 'error', error: 'NOT_FOUND' };
    }
    return { values: out, accurateAt: tx.now };
  },

  /** PUT one value (idempotent per value id); returns all current values of the attribute. */
  async putValue(tx: Tx, input: PutValueInput): Promise<AttributeValuesOutput> {
    const data = putValueInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const attr = resolveAttribute(def, data.attributeDefinitionId);
    const engine = engineFor(tx);
    await engine.lock([data.entityInstanceId]);
    await requireLive(tx, def, data.entityInstanceId);
    const existing = await tx.db
      .selectFrom('attribute_values')
      .select(['instance_id', 'attribute_id'])
      .where('id', '=', data.attributeValueId)
      .executeTakeFirst();
    if (existing) {
      if (existing.instance_id !== data.entityInstanceId || existing.attribute_id !== attr.id) {
        throw conflict('ID_CONFLICT', 'This value id is already used', { attribute_value_id: data.attributeValueId });
      }
      return currentAttributeValues(tx, def, data.entityInstanceId, attr); // replay
    }
    await engine.putValue(def, data.entityInstanceId, attr, {
      id: data.attributeValueId,
      value: data.value,
      ...(data.sortOrder ? { sortOrder: data.sortOrder } : {}),
    });
    await engine.finalize();
    return currentAttributeValues(tx, def, data.entityInstanceId, attr);
  },

  /** Retire (clear) one value; idempotent. */
  async retireValue(tx: Tx, input: RetireValueInput): Promise<AttributeValuesOutput> {
    const data = retireValueInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const attr = resolveAttribute(def, data.attributeDefinitionId);
    const engine = engineFor(tx);
    await engine.lock([data.entityInstanceId]);
    await requireLive(tx, def, data.entityInstanceId);
    const row = await loadValueRow(tx, data.entityInstanceId, attr, data.attributeValueId);
    await engine.retireValue(def, attr, row);
    await engine.finalize();
    return currentAttributeValues(tx, def, data.entityInstanceId, attr);
  },

  async reorderValue(tx: Tx, input: ReorderValueInput): Promise<AttributeValuesOutput> {
    const data = reorderValueInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const attr = resolveAttribute(def, data.attributeDefinitionId);
    const engine = engineFor(tx);
    await engine.lock([data.entityInstanceId]);
    await requireLive(tx, def, data.entityInstanceId);
    const row = await loadValueRow(tx, data.entityInstanceId, attr, data.attributeValueId);
    await engine.reorderValue(def, attr, row, data.sortOrder);
    await engine.finalize();
    return currentAttributeValues(tx, def, data.entityInstanceId, attr);
  },

  /** Every value of one attribute on one record (current and retired), newest first. */
  async history(tx: Tx, input: ValueHistoryInput): Promise<AttributeValuesOutput> {
    const data = valueHistoryInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const attr = resolveAttribute(def, data.attributeDefinitionId);
    const instance = await requireLive(tx, def, data.entityInstanceId);
    if (attr.systemAttributeType === 'id') {
      const values = await readValues(tx, def, [instance], [attr.id], null);
      return { values: values.get(instance.id)?.[attr.id] ?? [], accurateAt: tx.now };
    }
    const rows = await tx.db
      .selectFrom('attribute_values')
      .selectAll()
      .where('instance_id', '=', data.entityInstanceId)
      .where('attribute_id', '=', attr.id)
      .$if(data.before !== undefined, (q) => q.where('active_from', '<', data.before as string))
      .orderBy('active_from', 'desc')
      .orderBy('id', 'desc')
      .limit(data.limit)
      .execute();
    return { values: rows.map((r) => toAttributeValue(attr, r)), accurateAt: tx.now };
  },
};

/**
 * Takes live records out of circulation (soft delete or merge): marks the header, releases unique claims, retires
 * every reference pointing at them and removes their projection rows. Returns the retired inbound references.
 */
async function detachInstances(tx: Tx, def: DefInfo, ids: string[], opts: { merged: string | null }) {
  // A deleted record takes its list entries with it (soft, same archived_at; they come back with a restore). The
  // entries keep their parent_record value; merges re-point entries to the merged record instead.
  const entryIds = !opts.merged && def.entityType !== 'collection-entry' ? await cascadeEntries(tx, ids) : [];
  const actor = encodeActor(tx.ctx.actor);
  await tx.db
    .updateTable('entity_instances')
    .set(
      opts.merged
        ? { merged_at: tx.now, merged_into_id: opts.merged }
        : { archived_at: tx.now, archived_by_type: actor.type, archived_by_id: actor.id },
    )
    .where('id', 'in', ids)
    .execute();
  await tx.db
    .updateTable('attribute_values')
    .set({ unique_key: null })
    .where('instance_id', 'in', ids)
    .where('active_until', 'is', null)
    .where('unique_key', 'is not', null)
    .execute();
  const inbound = await engineFor(tx).retireInboundReferences(ids, entryIds);
  await deleteProjectionRows(tx, def, ids);
  await refreshSearchIndex(tx, ids, null); // dead records leave the search index
  // D §3.10a: a delete "will delete associated notes and tasks" (soft, restorable with the record). Merges re-point
  // those children to the merged record instead (relinkRecordChildren, once it exists).
  if (!opts.merged) await cascadeRecordDelete(tx, def, ids);
  for (const id of ids) tx.emit('entity-instance', id, { entityDefinitionId: def.id });
  tx.emit('snapshot-selection', def.id, { entityDefinitionId: def.id });
  for (const id of ids) {
    if (opts.merged) recordMergedEvent(tx, def, opts.merged, id);
    else recordEvent(tx, def, 'deleted', id);
  }
  return inbound;
}

/** Soft-deletes the live entries of records (grouped per list); returns the entry ids. */
async function cascadeEntries(tx: Tx, recordIds: string[]): Promise<string[]> {
  const entries = await liveEntriesOf(tx, recordIds);
  const byList = new Map<string, string[]>();
  for (const e of entries) byList.set(e.listId, [...(byList.get(e.listId) ?? []), e.entryId]);
  const all: string[] = [];
  for (const [listId, entryIds] of byList) {
    await engineFor(tx).lock(entryIds);
    await detachInstances(tx, await loadDefinition(tx, listId), entryIds, { merged: null });
    all.push(...entryIds);
  }
  return all;
}

/** Restores the entries deleted together with a record (same archived_at), except entries of deleted lists. */
async function restoreEntriesOf(tx: Tx, recordId: string, archivedAt: string): Promise<void> {
  const { rows } = await sql<{ id: string; list_id: string }>`
    SELECT DISTINCT e.id, e.entity_definition_id AS list_id
    FROM attribute_values v
    JOIN attribute_definitions a ON a.id = v.attribute_id AND a.system_attribute_type = 'entry-parent-record'
    JOIN entity_instances e ON e.id = v.instance_id
    JOIN collections c ON c.id = e.entity_definition_id AND c.deleted_at IS NULL
    WHERE v.v_ref = ${recordId}::uuid AND v.active_until IS NULL AND e.archived_at = ${archivedAt}::timestamptz
      AND e.merged_at IS NULL`.execute(tx.db);
  for (const r of rows) await recordOps.restore(tx, { entityDefinitionId: r.list_id, entityInstanceId: r.id });
  const def = await tx.db
    .selectFrom('entity_instances')
    .select('entity_definition_id')
    .where('id', '=', recordId)
    .executeTakeFirstOrThrow();
  await syncListEntries(tx, [{ entityDefinitionId: def.entity_definition_id, entityInstanceId: recordId }]);
}
