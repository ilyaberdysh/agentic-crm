// Entries ↔ parent records (A §4.4): the live entries of records and the parent records of entries, and the timeline
// invalidation of parents whose entries changed (D §3.8 "lists" events). No engine imports (the engine uses this).
import type { RecordRef } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import type { Tx } from '../tx.ts';
import { PARENT_RECORD_TYPE } from './model.ts';

/** Live entries (any list) whose current parent is one of `recordIds`. */
export async function liveEntriesOf(
  tx: Tx,
  recordIds: string[],
): Promise<{ entryId: string; listId: string; recordId: string; createdAt: string }[]> {
  if (recordIds.length === 0) return [];
  const { rows } = await sql<{ entry_id: string; list_id: string; record_id: string; created_at: string }>`
    SELECT v.instance_id AS entry_id, v.entity_definition_id AS list_id, v.v_ref AS record_id, e.created_at
    FROM attribute_values v
    JOIN attribute_definitions a ON a.id = v.attribute_id AND a.system_attribute_type = ${PARENT_RECORD_TYPE}
    JOIN entity_instances e ON e.id = v.instance_id AND e.archived_at IS NULL AND e.merged_at IS NULL
    WHERE v.v_ref = ANY(${recordIds}::uuid[]) AND v.active_until IS NULL
    ORDER BY e.created_at, v.instance_id`.execute(tx.db);
  return rows.map((r) => ({ entryId: r.entry_id, listId: r.list_id, recordId: r.record_id, createdAt: r.created_at }));
}

/** Parent records of entries (current or past parent values). */
export async function parentsOfEntries(tx: Tx, entryIds: string[]): Promise<RecordRef[]> {
  if (entryIds.length === 0) return [];
  const { rows } = await sql<{ v_ref: string; v_ref_def: string }>`
    SELECT DISTINCT v.v_ref, v.v_ref_def FROM attribute_values v
    JOIN attribute_definitions a ON a.id = v.attribute_id AND a.system_attribute_type = ${PARENT_RECORD_TYPE}
    WHERE v.instance_id = ANY(${entryIds}::uuid[]) AND v.v_ref IS NOT NULL AND v.v_ref_def IS NOT NULL`.execute(tx.db);
  return rows.map((r) => ({ entityDefinitionId: r.v_ref_def, entityInstanceId: r.v_ref }));
}

/** Invalidates the activity timelines of records (one change_log entry per object). */
export function emitRecordTimelines(tx: Tx, records: RecordRef[]): void {
  const byDef = new Map<string, string[]>();
  for (const r of records)
    byDef.set(r.entityDefinitionId, [...(byDef.get(r.entityDefinitionId) ?? []), r.entityInstanceId]);
  for (const [defId, ids] of byDef) {
    tx.emit('record-timeline', defId, { entityDefinitionId: defId, entityInstanceIds: [...new Set(ids)] });
  }
}
