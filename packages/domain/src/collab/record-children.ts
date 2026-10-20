// What happens to a record's notes, tasks, comments, files and favorites when the record is deleted, restored or
// merged (D README §3.10, §3.10a; decision X-22), plus the record-page reads built on them: merged-away state and the
// related-item counters of the merge cards and tab badges.
//   delete   notes / tasks whose every linked record is now gone are soft-deleted ("will delete associated notes and
//            tasks"); comments and files of the record are soft-deleted; favorites of the record are removed. All
//            soft deletes carry the record's archived_at, so a restore brings exactly them back.
//   merge    everything is re-pointed to the merged record (duplicate links collapse; clashing file names get " (n)").
import type {
  RecordRef,
  RecordStateInput,
  RecordStateOutput,
  RelatedCountsInput,
  RelatedCountsOutput,
} from '@agentic-crm/contracts';
import { recordStateInputSchema, relatedCountsInputSchema } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { type DefInfo, loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import type { CollabDeps } from './common.ts';
import { deleteFavoritesOfTargets, relinkRecordFavorites } from './favorites.ts';
import { emitTimelines } from './notes.ts';

function emitChildren(tx: Tx, refs: RecordRef[]): void {
  const ids = refs.map((r) => r.entityInstanceId);
  tx.emit('note-list', null, { entityInstanceIds: ids });
  tx.emit('task-list', null, { entityInstanceIds: ids });
  for (const r of refs) {
    tx.emit('comment-thread-list', r.entityDefinitionId, {
      entityDefinitionId: r.entityDefinitionId,
      entityInstanceIds: [r.entityInstanceId],
    });
    tx.emit('storage-entry-list', r.entityInstanceId, {
      entityDefinitionId: r.entityDefinitionId,
      entityInstanceId: r.entityInstanceId,
    });
  }
  emitTimelines(tx, refs);
}

/** Soft-deletes the children of deleted records (same transaction as the record delete; `tx.now` = archived_at). */
export async function cascadeRecordDelete(tx: Tx, def: DefInfo, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const actor = JSON.stringify(tx.ctx.actor);
  const orphanNotes = await sql<{ id: string }>`
    UPDATE notes n SET deleted_at = ${tx.now}, deleted_by = ${actor}::jsonb
    WHERE n.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM note_records r WHERE r.note_id = n.id AND r.entity_instance_id = ANY(${ids}::uuid[]))
      AND NOT EXISTS (
        SELECT 1 FROM note_records r JOIN entity_instances i ON i.id = r.entity_instance_id
        WHERE r.note_id = n.id AND i.archived_at IS NULL AND i.merged_at IS NULL)
    RETURNING n.id`.execute(tx.db);
  await sql`
    UPDATE tasks t SET deleted_at = ${tx.now}, deleted_by = ${actor}::jsonb
    WHERE t.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM task_records r WHERE r.task_id = t.id AND r.entity_instance_id = ANY(${ids}::uuid[]))
      AND NOT EXISTS (
        SELECT 1 FROM task_records r JOIN entity_instances i ON i.id = r.entity_instance_id
        WHERE r.task_id = t.id AND i.archived_at IS NULL AND i.merged_at IS NULL)`.execute(tx.db);
  await sql`
    UPDATE comments SET deleted_at = ${tx.now}, deleted_by = ${actor}::jsonb
    WHERE entity_instance_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL`.execute(tx.db);
  await sql`
    UPDATE storage_entries SET deleted_at = ${tx.now}, deleted_by = ${actor}::jsonb
    WHERE entity_instance_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL`.execute(tx.db);
  await deleteFavoritesOfTargets(tx, 'record', ids);
  await deleteFavoritesOfTargets(
    tx,
    'note',
    orphanNotes.rows.map((r) => r.id),
  );
  emitChildren(
    tx,
    ids.map((id) => ({ entityDefinitionId: def.id, entityInstanceId: id })),
  );
}

/** Brings back what cascadeRecordDelete soft-deleted for this record (rows deleted at the record's archived_at). */
export async function restoreRecordChildren(tx: Tx, def: DefInfo, id: string, archivedAt: string): Promise<void> {
  await sql`
    UPDATE notes n SET deleted_at = NULL, deleted_by = NULL
    WHERE n.deleted_at = ${archivedAt}::timestamptz
      AND EXISTS (SELECT 1 FROM note_records r WHERE r.note_id = n.id AND r.entity_instance_id = ${id}::uuid)`.execute(
    tx.db,
  );
  await sql`
    UPDATE tasks t SET deleted_at = NULL, deleted_by = NULL
    WHERE t.deleted_at = ${archivedAt}::timestamptz
      AND EXISTS (SELECT 1 FROM task_records r WHERE r.task_id = t.id AND r.entity_instance_id = ${id}::uuid)`.execute(
    tx.db,
  );
  await sql`
    UPDATE comments SET deleted_at = NULL, deleted_by = NULL
    WHERE entity_instance_id = ${id}::uuid AND deleted_at = ${archivedAt}::timestamptz`.execute(tx.db);
  await sql`
    UPDATE storage_entries SET deleted_at = NULL, deleted_by = NULL
    WHERE entity_instance_id = ${id}::uuid AND deleted_at = ${archivedAt}::timestamptz`.execute(tx.db);
  emitChildren(tx, [{ entityDefinitionId: def.id, entityInstanceId: id }]);
}

/**
 * Re-points the children of merged-away records to the merged record (D §3.10 "Merge carries over list entries,
 * notes, files, tasks, comments"). `sourceIds` are in priority order (target first).
 */
export async function relinkRecordChildren(tx: Tx, def: DefInfo, sourceIds: string[], mergedId: string): Promise<void> {
  for (const table of ['note_records', 'task_records'] as const) {
    const key = table === 'note_records' ? 'note_id' : 'task_id';
    await sql`
      INSERT INTO ${sql.table(table)} (${sql.ref(key)}, workspace_id, entity_definition_id, entity_instance_id, position)
      SELECT ${sql.ref(key)}, workspace_id, ${def.id}::uuid, ${mergedId}::uuid, min(position)
      FROM ${sql.table(table)} WHERE entity_instance_id = ANY(${sourceIds}::uuid[])
      GROUP BY ${sql.ref(key)}, workspace_id
      ON CONFLICT DO NOTHING`.execute(tx.db);
    await sql`DELETE FROM ${sql.table(table)} WHERE entity_instance_id = ANY(${sourceIds}::uuid[])`.execute(tx.db);
  }
  await sql`
    UPDATE comments SET entity_instance_id = ${mergedId}::uuid, entity_definition_id = ${def.id}::uuid
    WHERE target_kind = 'record' AND entity_instance_id = ANY(${sourceIds}::uuid[])`.execute(tx.db);
  await sql`
    UPDATE upload_sessions SET entity_instance_id = ${mergedId}::uuid
    WHERE entity_instance_id = ANY(${sourceIds}::uuid[]) AND state = 'pending'`.execute(tx.db);
  // Files: names stay unique per folder of the merged record.
  const entries = await tx.db
    .selectFrom('storage_entries')
    .select(['id', 'entity_instance_id', 'parent_folder_id', 'name'])
    .where('entity_instance_id', 'in', sourceIds)
    .where('deleted_at', 'is', null)
    .execute();
  const priority = new Map(sourceIds.map((id, i) => [id, i]));
  entries.sort((a, b) => (priority.get(a.entity_instance_id) ?? 0) - (priority.get(b.entity_instance_id) ?? 0));
  const taken = new Set<string>();
  for (const entry of entries) {
    const folder = entry.parent_folder_id ?? '';
    let name = entry.name;
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let n = 2; taken.has(`${folder}/${name.toLowerCase()}`); n++) name = `${stem} (${n})${ext}`;
    taken.add(`${folder}/${name.toLowerCase()}`);
    await tx.db
      .updateTable('storage_entries')
      .set({ entity_instance_id: mergedId, entity_definition_id: def.id, name, updated_at: tx.now })
      .where('id', '=', entry.id)
      .execute();
  }
  await relinkRecordFavorites(tx, sourceIds, mergedId, def.id);
  emitChildren(
    tx,
    [...sourceIds, mergedId].map((id) => ({ entityDefinitionId: def.id, entityInstanceId: id })),
  );
}

export const recordPageOps = {
  /** Record page states (D §2.6): live / merged (→ the live record at the end of the merge chain) / deleted / not found. */
  async state(tx: Tx, deps: CollabDeps, input: RecordStateInput): Promise<RecordStateOutput> {
    const data = recordStateInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    await deps.policies.assertCan(tx, def.id, 'read_entity_instance');
    const row = await tx.db
      .selectFrom('entity_instances')
      .selectAll()
      .where('id', '=', data.entityInstanceId)
      .executeTakeFirst();
    const empty = { entityInstanceId: data.entityInstanceId, mergedAt: null, mergedInto: null, deletedAt: null };
    if (!row || row.entity_definition_id !== def.id) return { state: 'not-found', entityDefinitionId: null, ...empty };
    if (row.merged_at !== null) {
      let current = row;
      const seen = new Set([row.id]);
      while (current.merged_into_id && !seen.has(current.merged_into_id)) {
        seen.add(current.merged_into_id);
        const next = await tx.db
          .selectFrom('entity_instances')
          .selectAll()
          .where('id', '=', current.merged_into_id)
          .executeTakeFirst();
        if (!next) break;
        current = next;
      }
      const live = current.id !== row.id && current.archived_at === null && current.merged_at === null;
      return {
        state: 'merged',
        entityDefinitionId: def.id,
        ...empty,
        mergedAt: row.merged_at,
        mergedInto: live ? { entityDefinitionId: current.entity_definition_id, entityInstanceId: current.id } : null,
      };
    }
    if (row.archived_at !== null)
      return { state: 'deleted', entityDefinitionId: def.id, ...empty, deletedAt: row.archived_at };
    return { state: 'live', entityDefinitionId: def.id, ...empty };
  },

  /** Merge-card counters and tab badges (D §3.10, §2.4): lists, notes, tasks (open), comments, files. */
  async relatedCounts(tx: Tx, deps: CollabDeps, input: RelatedCountsInput): Promise<RelatedCountsOutput> {
    const data = relatedCountsInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    await deps.policies.assertCan(tx, def.id, 'read_entity_instance');
    const ids = data.entityInstanceIds;
    const counts: RelatedCountsOutput['counts'] = Object.fromEntries(
      ids.map((id) => [id, { lists: 0, notes: 0, tasks: 0, openTasks: 0, comments: 0, files: 0 }]),
    );
    const add = (rows: { id: string; n: string }[], key: keyof RelatedCountsOutput['counts'][string]) => {
      for (const r of rows) {
        const entry = counts[r.id];
        if (entry) entry[key] = Number(r.n);
      }
    };
    add(
      (
        await sql<{ id: string; n: string }>`
          SELECT v.v_ref AS id, count(DISTINCT v.instance_id) AS n
          FROM attribute_values v
          JOIN attribute_definitions a ON a.id = v.attribute_id AND a.system_attribute_type = 'entry-parent-record'
          JOIN entity_instances e ON e.id = v.instance_id AND e.archived_at IS NULL AND e.merged_at IS NULL
          WHERE v.v_ref = ANY(${ids}::uuid[]) AND v.active_until IS NULL
          GROUP BY v.v_ref`.execute(tx.db)
      ).rows,
      'lists',
    );
    add(
      (
        await sql<{ id: string; n: string }>`
          SELECT r.entity_instance_id AS id, count(*) AS n FROM note_records r JOIN notes n ON n.id = r.note_id
          WHERE r.entity_instance_id = ANY(${ids}::uuid[]) AND n.deleted_at IS NULL GROUP BY r.entity_instance_id`.execute(
          tx.db,
        )
      ).rows,
      'notes',
    );
    add(
      (
        await sql<{ id: string; n: string }>`
          SELECT r.entity_instance_id AS id, count(*) AS n FROM task_records r JOIN tasks t ON t.id = r.task_id
          WHERE r.entity_instance_id = ANY(${ids}::uuid[]) AND t.deleted_at IS NULL GROUP BY r.entity_instance_id`.execute(
          tx.db,
        )
      ).rows,
      'tasks',
    );
    add(
      (
        await sql<{ id: string; n: string }>`
          SELECT r.entity_instance_id AS id, count(*) AS n FROM task_records r JOIN tasks t ON t.id = r.task_id
          WHERE r.entity_instance_id = ANY(${ids}::uuid[]) AND t.deleted_at IS NULL AND t.completed_at IS NULL
          GROUP BY r.entity_instance_id`.execute(tx.db)
      ).rows,
      'openTasks',
    );
    add(
      (
        await sql<{ id: string; n: string }>`
          SELECT entity_instance_id AS id, count(*) AS n FROM comments
          WHERE entity_instance_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL GROUP BY entity_instance_id`.execute(
          tx.db,
        )
      ).rows,
      'comments',
    );
    add(
      (
        await sql<{ id: string; n: string }>`
          SELECT entity_instance_id AS id, count(*) AS n FROM storage_entries
          WHERE entity_instance_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL AND entry_type = 'file'
          GROUP BY entity_instance_id`.execute(tx.db)
      ).rows,
      'files',
    );
    return { counts };
  },
};
