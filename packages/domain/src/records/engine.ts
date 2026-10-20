// Value write engine — the only code that writes attribute_values (I1, I6).
//   • A write never updates a value: it retires the current row (active_until = now, deactivated_by = actor) and
//     inserts a new row (active_from = now). Clearing = retiring. Unchanged values keep their rows (no history noise).
//   • Instances are locked FOR NO KEY UPDATE before their values change, so concurrent writers serialise per record.
//   • Relationship attributes are mirrored on the other side in the same transaction (with displacement of a
//     single-valued inverse: moving a person to another company removes them from the old company's team).
//   • finalize() refreshes the projection rows, bumps instance versions, maintains search_text and the search index
//     (search/indexer.ts) and emits one change_log entry per changed key — all inside the caller's transaction.
import type { AttributeValue, ValueInput } from '@agentic-crm/contracts';
import { rankAfter } from '@agentic-crm/contracts';
import { type AttributeValuesTable, jsonb, type Selectable, sql } from '@agentic-crm/db';
import { decodeActor, encodeActor } from '../actors.ts';
import { badRequest, conflict, valueError } from '../errors.ts';
import { newId } from '../ids.ts';
import { emitRecordTimelines, parentsOfEntries } from '../lists/parents.ts';
import { refreshProjection } from '../projection.ts';
import { enforceRules } from '../rules/enforce.ts';
import { type AttrDef, type DefInfo, loadDefinition } from '../schema/model.ts';
import { indexAfterWrite } from '../search/indexer.ts';
import type { Tx } from '../tx.ts';
import { canonicalFromRow } from '../values/canonical.ts';
import { parseValue, readValue, type StoredValue } from '../values/codecs.ts';
import { recordEvent } from '../webhooks/events.ts';

export type ValueRow = Selectable<AttributeValuesTable>;

interface Item {
  id: string;
  stored: StoredValue;
  sortOrder: string | null;
}

/** System attribute types whose values feed entity_instances.search_text (record pickers, Cmd+K). */
const SEARCHABLE_SYSTEM_TYPES = new Set([
  'name',
  'personal-name',
  'domains',
  'email-address',
  'phone-numbers',
  'workspace-member-name',
  'workspace-member-email-address',
]);

/** The record label ("epithet") attribute of a definition: its display path, else a `name` attribute. */
export function labelAttribute(def: DefInfo): AttrDef | undefined {
  const fromPath = def.epithetPath?.[0]?.attributeDefinitionId;
  const attr =
    (fromPath ? def.byId.get(fromPath) : undefined) ?? (def.epithetPath ? undefined : def.bySlug.get('name'));
  return attr && (attr.type === 'text' || attr.type === 'personal-name') ? attr : undefined;
}

/** Same rule as migration 0201: searchable system types plus the record label of every object. */
export function isSearchable(def: DefInfo, attr: AttrDef): boolean {
  if (attr.systemAttributeType !== null && SEARCHABLE_SYSTEM_TYPES.has(attr.systemAttributeType)) return true;
  return labelAttribute(def)?.id === attr.id;
}

export class ValueEngine {
  private readonly touched = new Map<string, { def: DefInfo; instances: Set<string>; attrs: Map<string, AttrDef> }>();
  private readonly locked = new Set<string>();
  private systemDepth = 0;

  constructor(readonly tx: Tx) {}

  /** System actors may write read-only attributes (created_*, interactions, member records). */
  get isSystem(): boolean {
    return this.systemDepth > 0 || this.tx.ctx.actor.type === 'system';
  }

  /** Runs `fn` with system write privileges; the recorded actor stays the caller (e.g. created_by on create). */
  async asSystem<T>(fn: () => Promise<T>): Promise<T> {
    this.systemDepth++;
    try {
      return await fn();
    } finally {
      this.systemDepth--;
    }
  }

  async lock(instanceIds: string[]): Promise<void> {
    const ids = [...new Set(instanceIds)].filter((id) => !this.locked.has(id)).sort();
    if (ids.length === 0) return;
    await sql`SELECT id FROM entity_instances WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`.execute(
      this.tx.db,
    );
    for (const id of ids) this.locked.add(id);
  }

  touch(def: DefInfo, instanceId: string, attr: AttrDef): void {
    let entry = this.touched.get(def.id);
    if (!entry) {
      entry = { def, instances: new Set(), attrs: new Map() };
      this.touched.set(def.id, entry);
    }
    entry.instances.add(instanceId);
    entry.attrs.set(attr.id, attr);
  }

  async currentValues(instanceId: string, attributeId: string): Promise<ValueRow[]> {
    return this.tx.db
      .selectFrom('attribute_values')
      .selectAll()
      .where('instance_id', '=', instanceId)
      .where('attribute_id', '=', attributeId)
      .where('active_until', 'is', null)
      .orderBy('sort_order')
      .orderBy('active_from')
      .orderBy('id')
      .execute();
  }

  assertWritable(attr: AttrDef): void {
    if (attr.isArchived)
      throw badRequest('ATTRIBUTE_ARCHIVED', `Attribute "${attr.apiSlug}" is archived`, {
        attribute_definition_id: attr.id,
      });
    if (attr.systemAttributeType === 'id' || ((attr.isReadOnly || attr.type === 'interaction') && !this.isSystem)) {
      throw badRequest('ATTRIBUTE_READ_ONLY', `Attribute "${attr.apiSlug}" is read-only`, {
        attribute_definition_id: attr.id,
      });
    }
  }

  parseItems(attr: AttrDef, inputs: ValueInput[]): Item[] {
    const items: Item[] = [];
    for (const input of inputs) {
      const stored = parseValue(attr, input.value);
      if (stored) items.push({ id: input.id ?? newId(), stored, sortOrder: input.sortOrder ?? null });
    }
    if (!attr.isMultiselect && items.length > 1) {
      throw valueError(attr.id, 'single-value', `Attribute "${attr.apiSlug}" accepts a single value`);
    }
    const keys = new Set<string>();
    for (const item of items) {
      if (keys.has(item.stored.canonical)) {
        throw conflict('DUPLICATE_VALUE_IN_MULTISELECT', `Duplicate value for attribute "${attr.apiSlug}"`, {
          attribute_definition_id: attr.id,
        });
      }
      keys.add(item.stored.canonical);
    }
    return items;
  }

  /** Checks that referenced options, stages, records and members exist (and fills the target definition). */
  async verifyReferences(attr: AttrDef, items: Item[]): Promise<void> {
    const refs = [...new Set(items.map((i) => i.stored.v_ref).filter((r): r is string => r !== null))];
    if (refs.length === 0) return;
    if (attr.type === 'select' || attr.type === 'pipeline') {
      const rows = await this.tx.db
        .selectFrom('select_options')
        .select(['id', 'is_archived'])
        .where('attribute_id', '=', attr.id)
        .where('id', 'in', refs)
        .execute();
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const ref of refs) {
        const row = byId.get(ref);
        const label = attr.type === 'pipeline' ? 'status' : 'option';
        if (!row)
          throw valueError(attr.id, `unknown-${label}`, `Unknown ${label} ${ref} for attribute "${attr.apiSlug}"`);
        if (row.is_archived) throw valueError(attr.id, `archived-${label}`, `The ${label} ${ref} is archived`);
      }
    } else if (attr.type === 'entity-reference') {
      const rows = await this.tx.db
        .selectFrom('entity_instances')
        .select(['id', 'entity_definition_id'])
        .where('id', 'in', refs)
        .where('archived_at', 'is', null)
        .where('merged_at', 'is', null)
        .execute();
      const defOf = new Map(rows.map((r) => [r.id, r.entity_definition_id]));
      const allowed = attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null;
      for (const item of items) {
        const target = item.stored.v_ref as string;
        const targetDef = defOf.get(target);
        if (!targetDef) throw valueError(attr.id, 'unknown-record', `Record ${target} does not exist`);
        if (item.stored.v_ref_def && item.stored.v_ref_def !== targetDef) {
          throw valueError(attr.id, 'record-type-mismatch', `Record ${target} belongs to another object`);
        }
        if (allowed && allowed.length > 0 && !allowed.includes(targetDef)) {
          throw valueError(
            attr.id,
            'record-type-not-allowed',
            `Attribute "${attr.apiSlug}" cannot reference this object`,
          );
        }
        item.stored.v_ref_def = targetDef;
      }
    } else if (attr.type === 'actor-reference') {
      const memberIds = items
        .filter((i) => i.stored.v_text === 'workspace-member')
        .map((i) => i.stored.v_ref as string);
      if (memberIds.length > 0) {
        const rows = await this.tx.db
          .selectFrom('workspace_members')
          .select('id')
          .where('id', 'in', memberIds)
          .execute();
        const found = new Set(rows.map((r) => r.id));
        const missing = memberIds.find((m) => !found.has(m));
        if (missing) throw valueError(attr.id, 'unknown-member', `Workspace member ${missing} does not exist`);
      }
    }
  }

  async checkUnique(attr: AttrDef, instanceId: string, items: Item[]): Promise<void> {
    if (!attr.isUnique || items.length === 0) return;
    const keys = items.map((i) => i.stored.canonical);
    const clash = await this.tx.db
      .selectFrom('attribute_values')
      .select(['instance_id'])
      .where('attribute_id', '=', attr.id)
      .where('unique_key', 'in', keys)
      .where('active_until', 'is', null)
      .where('instance_id', '!=', instanceId)
      .execute();
    if (clash.length > 0) {
      throw conflict('UNIQUE_CONSTRAINT_VIOLATION', `Another record already has this value for "${attr.title}"`, {
        attribute_definition_id: attr.id,
        entity_instance_ids: [...new Set(clash.map((c) => c.instance_id))],
      });
    }
  }

  /** Inserts value rows (no mirroring). */
  private async insertRaw(def: DefInfo, instanceId: string, attr: AttrDef, items: Item[]): Promise<void> {
    if (items.length === 0) return;
    const actor = encodeActor(this.tx.ctx.actor);
    await this.tx.db
      .insertInto('attribute_values')
      .values(
        items.map((i) => ({
          id: i.id,
          workspace_id: this.tx.workspaceId,
          entity_definition_id: def.id,
          instance_id: instanceId,
          attribute_id: attr.id,
          active_from: this.tx.now,
          created_by_type: actor.type,
          created_by_id: actor.id,
          sort_order: i.sortOrder,
          v_text: i.stored.v_text,
          v_num: i.stored.v_num,
          v_ts: i.stored.v_ts,
          v_date: i.stored.v_date,
          v_bool: i.stored.v_bool,
          v_ref: i.stored.v_ref,
          v_ref_def: i.stored.v_ref_def,
          v_json: jsonb(i.stored.v_json),
          sort_key: i.stored.display === null ? null : sql<string>`left(norm_key(${i.stored.display}), 128)`,
          unique_key: attr.isUnique ? i.stored.canonical : null,
        })),
      )
      .execute();
    this.touch(def, instanceId, attr);
  }

  /** Retires value rows (no mirroring). */
  private async retireRaw(def: DefInfo, attr: AttrDef, rows: ValueRow[]): Promise<void> {
    if (rows.length === 0) return;
    const actor = encodeActor(this.tx.ctx.actor);
    await this.tx.db
      .updateTable('attribute_values')
      .set({ active_until: this.tx.now, deactivated_by_type: actor.type, deactivated_by_id: actor.id })
      .where(
        'id',
        'in',
        rows.map((r) => r.id),
      )
      .where('active_until', 'is', null)
      .execute();
    for (const r of rows) this.touch(def, r.instance_id, attr);
  }

  /** Inserts values and mirrors relationship additions. */
  async insertItems(def: DefInfo, instanceId: string, attr: AttrDef, items: Item[]): Promise<void> {
    await this.insertRaw(def, instanceId, attr, items);
    if (attr.relationshipAttributeId) {
      for (const item of items) await this.mirrorAdd(def, instanceId, attr, item.stored.v_ref as string);
    }
  }

  /** Retires values and mirrors relationship removals. */
  async retireRows(def: DefInfo, attr: AttrDef, rows: ValueRow[]): Promise<void> {
    await this.retireRaw(def, attr, rows);
    if (attr.relationshipAttributeId) {
      for (const row of rows) await this.mirrorRemove(attr, row.instance_id, row.v_ref as string);
    }
  }

  private async inverseOf(attr: AttrDef): Promise<{ def: DefInfo; attr: AttrDef }> {
    const def = await loadDefinition(this.tx, attr.relatedEntityDefinitionId as string);
    return { def, attr: def.byId.get(attr.relationshipAttributeId as string) as AttrDef };
  }

  /** target.inverse ∋ source. A single-valued inverse pointing elsewhere is displaced (and un-mirrored). */
  private async mirrorAdd(sourceDef: DefInfo, sourceId: string, attr: AttrDef, targetId: string): Promise<void> {
    const inverse = await this.inverseOf(attr);
    await this.lock([targetId]);
    const current = await this.currentValues(targetId, inverse.attr.id);
    if (current.some((r) => r.v_ref === sourceId)) return;
    if (!inverse.attr.isMultiselect && current.length > 0) {
      await this.retireRaw(inverse.def, inverse.attr, current);
      for (const old of current) {
        const previous = old.v_ref as string;
        await this.lock([previous]);
        const stale = (await this.currentValues(previous, attr.id)).filter((r) => r.v_ref === targetId);
        await this.retireRaw(sourceDef, attr, stale);
      }
    }
    const last = current.reduce<string | null>(
      (m, r) => (r.sort_order && (m === null || r.sort_order > m) ? r.sort_order : m),
      null,
    );
    await this.insertRaw(inverse.def, targetId, inverse.attr, [
      {
        id: newId(),
        sortOrder: inverse.attr.isMultiselect ? rankAfter(last) : null,
        stored: {
          v_text: null,
          v_num: null,
          v_ts: null,
          v_date: null,
          v_bool: null,
          v_ref: sourceId,
          v_ref_def: sourceDef.id,
          v_json: null,
          display: null,
          canonical: sourceId,
        },
      },
    ]);
  }

  /** target.inverse ∌ source. */
  private async mirrorRemove(attr: AttrDef, sourceId: string, targetId: string): Promise<void> {
    const inverse = await this.inverseOf(attr);
    await this.lock([targetId]);
    const rows = (await this.currentValues(targetId, inverse.attr.id)).filter((r) => r.v_ref === sourceId);
    await this.retireRaw(inverse.def, inverse.attr, rows);
  }

  /**
   * Sets an attribute of one record. 'replace': `inputs` is the complete desired set of current values;
   * 'append': `inputs` are added to a multi-value attribute (already present values are skipped).
   */
  async setAttribute(
    def: DefInfo,
    instanceId: string,
    attr: AttrDef,
    inputs: ValueInput[],
    mode: 'replace' | 'append' = 'replace',
  ): Promise<void> {
    this.assertWritable(attr);
    const items = this.parseItems(attr, inputs);
    await this.verifyReferences(attr, items);
    const current = await this.currentValues(instanceId, attr.id);
    const keyOf = (r: ValueRow) => canonicalFromRow(attr.type, r);

    if (!attr.isMultiselect) {
      const next = items[0];
      if (!next) {
        if (mode === 'append') return;
        if (current.length > 0 && attr.isRequired) throw requiredError(attr);
        await this.retireRows(def, attr, current);
        return;
      }
      if (current.length === 1 && keyOf(current[0] as ValueRow) === next.stored.canonical) return; // unchanged
      await this.checkUnique(attr, instanceId, [next]);
      await this.retireRows(def, attr, current);
      await this.insertItems(def, instanceId, attr, [next]);
      return;
    }

    const currentKeys = new Set(current.map(keyOf));
    const desiredKeys = new Set(items.map((i) => i.stored.canonical));
    const toInsert = items.filter((i) => !currentKeys.has(i.stored.canonical));
    const toRetire = mode === 'replace' ? current.filter((r) => !desiredKeys.has(keyOf(r))) : [];
    if (attr.isRequired && current.length - toRetire.length + toInsert.length === 0 && current.length > 0) {
      throw requiredError(attr);
    }
    let last = current
      .filter((r) => !toRetire.includes(r))
      .reduce<string | null>((m, r) => (r.sort_order && (m === null || r.sort_order > m) ? r.sort_order : m), null);
    for (const item of toInsert) {
      if (!item.sortOrder) item.sortOrder = rankAfter(last);
      if (last === null || item.sortOrder > last) last = item.sortOrder;
    }
    await this.checkUnique(attr, instanceId, toInsert);
    await this.retireRows(def, attr, toRetire);
    await this.insertItems(def, instanceId, attr, toInsert);
  }

  /** values.put: replace a single value, or add one value to a multi-value attribute (409 on duplicates). */
  async putValue(def: DefInfo, instanceId: string, attr: AttrDef, input: ValueInput & { id: string }): Promise<void> {
    if (!attr.isMultiselect) return this.setAttribute(def, instanceId, attr, [input], 'replace');
    this.assertWritable(attr);
    const items = this.parseItems(attr, [input]);
    const item = items[0];
    if (!item) throw valueError(attr.id, 'empty', 'A value is required');
    await this.verifyReferences(attr, items);
    const current = await this.currentValues(instanceId, attr.id);
    if (current.some((r) => canonicalFromRow(attr.type, r) === item.stored.canonical)) {
      throw conflict('DUPLICATE_VALUE_IN_MULTISELECT', `This value is already present on "${attr.title}"`, {
        attribute_definition_id: attr.id,
      });
    }
    if (!item.sortOrder) {
      const last = current.reduce<string | null>(
        (m, r) => (r.sort_order && (m === null || r.sort_order > m) ? r.sort_order : m),
        null,
      );
      item.sortOrder = rankAfter(last);
    }
    await this.checkUnique(attr, instanceId, [item]);
    await this.insertItems(def, instanceId, attr, [item]);
  }

  /** values.retire: clear one value (required attributes keep at least one value). */
  async retireValue(def: DefInfo, attr: AttrDef, row: ValueRow): Promise<void> {
    this.assertWritable(attr);
    if (row.active_until !== null) return;
    if (attr.isRequired) {
      const current = await this.currentValues(row.instance_id, attr.id);
      if (current.length <= 1) throw requiredError(attr);
    }
    await this.retireRows(def, attr, [row]);
  }

  /** values.reorder: moves one value of a multi-value attribute (rank is presentation, not part of the value). */
  async reorderValue(def: DefInfo, attr: AttrDef, row: ValueRow, sortOrder: string): Promise<void> {
    if (!attr.isMultiselect) throw badRequest('VALIDATION_ERROR', 'Only multi-value attributes can be reordered');
    if (row.active_until !== null) throw badRequest('VALIDATION_ERROR', 'Retired values cannot be reordered');
    await this.tx.db.updateTable('attribute_values').set({ sort_order: sortOrder }).where('id', '=', row.id).execute();
    this.touch(def, row.instance_id, attr);
  }

  /**
   * Retires every current value of `attributes` that references `targetIds` (used by delete and merge). Values held by
   * `keepFrom` instances stay (entries deleted together with their parent keep their parent for history and restore).
   */
  async retireInboundReferences(
    targetIds: string[],
    keepFrom: string[] = [],
  ): Promise<{ def: DefInfo; attr: AttrDef; row: ValueRow }[]> {
    const refAttrs = await this.tx.db
      .selectFrom('attribute_definitions')
      .select(['id', 'entity_definition_id'])
      .where('type', '=', 'entity-reference')
      .execute();
    if (refAttrs.length === 0 || targetIds.length === 0) return [];
    const rows = await this.tx.db
      .selectFrom('attribute_values')
      .selectAll()
      .where(
        'attribute_id',
        'in',
        refAttrs.map((a) => a.id),
      )
      .where('v_ref', 'in', targetIds)
      .where('active_until', 'is', null)
      .where('instance_id', 'not in', [...targetIds, ...keepFrom])
      .execute();
    const out: { def: DefInfo; attr: AttrDef; row: ValueRow }[] = [];
    await this.lock(rows.map((r) => r.instance_id));
    for (const row of rows) {
      const def = await loadDefinition(this.tx, row.entity_definition_id);
      const attr = def.byId.get(row.attribute_id) as AttrDef;
      await this.retireRaw(def, attr, [row]);
      out.push({ def, attr, row });
    }
    return out;
  }

  /** Re-creates the inverse side of every current relationship value of a record (restore after soft delete). */
  async remirrorRelationships(def: DefInfo, instanceId: string): Promise<void> {
    for (const attr of def.attrs.filter((a) => a.relationshipAttributeId && !a.isArchived)) {
      for (const row of await this.currentValues(instanceId, attr.id)) {
        await this.mirrorAdd(def, instanceId, attr, row.v_ref as string);
      }
    }
  }

  /** Applies all derived writes for the transaction: projection, versions, search text, change_log. */
  async finalize(): Promise<void> {
    const written: { def: DefInfo; ids: string[] }[] = [];
    for (const { def, instances, attrs } of this.touched.values()) {
      const ids = [...instances];
      const attrList = [...attrs.values()];
      await refreshProjection(this.tx, def, ids, attrList);
      await this.tx.db
        .updateTable('entity_instances')
        .set({ version: sql<string>`version + 1` })
        .where('id', 'in', ids)
        .execute();
      const searchable = def.attrs.filter((a) => isSearchable(def, a));
      if (attrList.some((a) => isSearchable(def, a))) await updateSearchText(this.tx, ids, searchable);
      await indexAfterWrite(this.tx, def, ids, attrList);
      for (const attr of attrList) {
        this.tx.emit('attribute-value-list', attr.id, {
          entityDefinitionId: def.id,
          attributeDefinitionId: attr.id,
          entityInstanceIds: ids,
        });
        // Derived list memberships are not attribute updates of the record (webhooks record.updated).
        if (attr.systemAttributeType !== 'list-entries') {
          for (const id of ids) recordEvent(this.tx, def, 'updated', id, attr.id);
        }
      }
      this.tx.emit('snapshot-selection', def.id, {
        entityDefinitionId: def.id,
        attributeDefinitionIds: attrList.map((a) => a.id),
      });
      // Entry value changes are activity of the entries' parent records (D §3.8 "lists").
      if (def.entityType === 'collection-entry') emitRecordTimelines(this.tx, await parentsOfEntries(this.tx, ids));
      written.push({ def, ids });
    }
    this.touched.clear();
    // Requirement rules see the proposed state of every written record (slice 6; rolls the write back on violation).
    await enforceRules(this.tx, written);
  }
}

export async function updateSearchText(tx: Tx, instanceIds: string[], searchable: AttrDef[]): Promise<void> {
  if (instanceIds.length === 0) return;
  const attrIds = searchable.map((a) => a.id);
  await sql`
    UPDATE entity_instances i SET search_text = (
      SELECT string_agg(v.sort_key, ' ' ORDER BY v.attribute_id, v.sort_order, v.id)
      FROM attribute_values v
      WHERE v.instance_id = i.id AND v.active_until IS NULL
        AND v.attribute_id = ANY(${attrIds.length ? attrIds : ['00000000-0000-0000-0000-000000000000']}::uuid[]))
    WHERE i.id = ANY(${instanceIds}::uuid[])`.execute(tx.db);
}

function requiredError(attr: AttrDef) {
  return valueError(attr.id, 'required', `Attribute "${attr.title}" is required`);
}

/** Engine instance shared by everything that runs in one transaction. */
export function engineFor(tx: Tx): ValueEngine {
  let engine = tx.memo.get('value-engine') as ValueEngine | undefined;
  if (!engine) {
    engine = new ValueEngine(tx);
    tx.memo.set('value-engine', engine);
  }
  return engine;
}

/** Row → API value envelope. */
export function toAttributeValue(attr: AttrDef, row: ValueRow): AttributeValue {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    entityDefinitionId: row.entity_definition_id,
    entityInstanceId: row.instance_id,
    attributeDefinitionId: row.attribute_id,
    attributeType: attr.type,
    value: readValue(attr.type, row),
    activeFrom: row.active_from,
    activeUntil: row.active_until,
    sortOrder: row.sort_order,
    createdBy: decodeActor(row.created_by_type, row.created_by_id) ?? { type: 'system', id: null },
    deactivatedBy: decodeActor(row.deactivated_by_type, row.deactivated_by_id),
  };
}
