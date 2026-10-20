// Sample events for "Test subscription".
// In cases where this is not possible … we'll fallback to randomly generated fake data"). Filters are not applied.
import { sql } from '@agentic-crm/db';
import { newId } from '../ids.ts';
import type { Tx } from '../tx.ts';

const OBJECT_TYPES = ['person-record', 'company-record', 'standard-object', 'custom-record'];

async function latestInstance(tx: Tx, entityTypes: string[]) {
  return tx.db
    .selectFrom('entity_instances as i')
    .innerJoin('entity_definitions as d', 'd.id', 'i.entity_definition_id')
    .select(['i.id', 'i.entity_definition_id'])
    .where('d.entity_type', 'in', entityTypes)
    .where('i.archived_at', 'is', null)
    .where('i.merged_at', 'is', null)
    .orderBy('i.created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
}

async function parentOfEntry(tx: Tx, entryId: string) {
  const { rows } = await sql<{ object_id: string; record_id: string }>`
    SELECT r.entity_definition_id AS object_id, r.id AS record_id
    FROM attribute_values v
    JOIN attribute_definitions a ON a.id = v.attribute_id AND a.system_attribute_type = 'entry-parent-record'
    JOIN entity_instances r ON r.id = v.v_ref
    WHERE v.instance_id = ${entryId}::uuid
    ORDER BY v.active_from DESC LIMIT 1`.execute(tx.db);
  return rows[0] ?? null;
}

async function firstAttribute(tx: Tx, defId: string) {
  return tx.db
    .selectFrom('attribute_definitions')
    .select('id')
    .where('entity_definition_id', '=', defId)
    .where('is_archived', '=', false)
    .orderBy('sort_order')
    .limit(1)
    .executeTakeFirst();
}

export async function samplePayloadEvent(tx: Tx, eventType: string): Promise<Record<string, unknown>> {
  const [resource] = eventType.split('.') as [string];
  const ws = tx.workspaceId;
  const actor =
    tx.ctx.actor.type === 'workspace-member' || tx.ctx.actor.type === 'api-token'
      ? { type: tx.ctx.actor.type, id: tx.ctx.actor.id }
      : { type: 'system', id: null };
  const base = { event_type: eventType, actor };
  switch (resource) {
    case 'record': {
      const r = await latestInstance(tx, OBJECT_TYPES);
      const object_id = r?.entity_definition_id ?? newId();
      const record_id = r?.id ?? newId();
      if (eventType === 'record.updated') {
        const attr = r ? await firstAttribute(tx, object_id) : null;
        return { ...base, id: { workspace_id: ws, object_id, record_id, attribute_id: attr?.id ?? newId() } };
      }
      if (eventType === 'record.merged') {
        return {
          ...base,
          id: { workspace_id: ws, object_id, record_id },
          duplicate_object_id: object_id,
          duplicate_record_id: newId(),
        };
      }
      return { ...base, id: { workspace_id: ws, object_id, record_id } };
    }
    case 'list-entry': {
      const e = await latestInstance(tx, ['collection-entry']);
      const parent = e ? await parentOfEntry(tx, e.id) : null;
      const id: Record<string, string> = {
        workspace_id: ws,
        list_id: e?.entity_definition_id ?? newId(),
        entry_id: e?.id ?? newId(),
      };
      if (eventType === 'list-entry.updated')
        id.attribute_id = (e ? await firstAttribute(tx, e.entity_definition_id) : null)?.id ?? newId();
      return {
        ...base,
        id,
        parent_object_id: parent?.object_id ?? newId(),
        parent_record_id: parent?.record_id ?? newId(),
      };
    }
    case 'list': {
      const l = await tx.db
        .selectFrom('collections')
        .select('id')
        .where('deleted_at', 'is', null)
        .limit(1)
        .executeTakeFirst();
      return { ...base, id: { workspace_id: ws, list_id: l?.id ?? newId() } };
    }
    case 'list-attribute':
    case 'object-attribute': {
      const r = await latestInstance(tx, resource === 'list-attribute' ? ['collection-entry'] : OBJECT_TYPES);
      const defId = r?.entity_definition_id ?? newId();
      const attr = r ? await firstAttribute(tx, defId) : null;
      const key = resource === 'list-attribute' ? 'list_id' : 'object_id';
      return { ...base, id: { workspace_id: ws, [key]: defId, attribute_id: attr?.id ?? newId() } };
    }
    case 'note':
    case 'note-content': {
      const n = await tx.db
        .selectFrom('notes as n')
        .leftJoin('note_records as r', 'r.note_id', 'n.id')
        .select(['n.id', 'r.entity_definition_id', 'r.entity_instance_id'])
        .where('n.deleted_at', 'is', null)
        .orderBy('n.created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return {
        ...base,
        id: { workspace_id: ws, note_id: n?.id ?? newId() },
        parent_object_id: n?.entity_definition_id ?? newId(),
        parent_record_id: n?.entity_instance_id ?? newId(),
      };
    }
    case 'task': {
      const t = await tx.db
        .selectFrom('tasks')
        .select('id')
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return { ...base, id: { workspace_id: ws, task_id: t?.id ?? newId() } };
    }
    case 'comment': {
      const c = await tx.db
        .selectFrom('comments')
        .select(['id', 'thread_id', 'target_kind', 'entity_definition_id', 'entity_instance_id'])
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (c && c.target_kind === 'list-entry') {
        const parent = await parentOfEntry(tx, c.entity_instance_id);
        return {
          ...base,
          id: { workspace_id: ws, comment_id: c.id },
          thread_id: c.thread_id,
          object_id: parent?.object_id ?? newId(),
          record_id: parent?.record_id ?? newId(),
          list_id: c.entity_definition_id,
          entry_id: c.entity_instance_id,
        };
      }
      return {
        ...base,
        id: { workspace_id: ws, comment_id: c?.id ?? newId() },
        thread_id: c?.thread_id ?? newId(),
        object_id: c?.entity_definition_id ?? newId(),
        record_id: c?.entity_instance_id ?? newId(),
        list_id: null,
        entry_id: null,
      };
    }
    case 'workspace-member': {
      const m = await tx.db
        .selectFrom('workspace_members')
        .select('id')
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      return { ...base, id: { workspace_id: ws, workspace_member_id: m?.id ?? newId() } };
    }
    case 'call-recording':
      return { ...base, id: { workspace_id: ws, meeting_id: newId(), call_recording_id: newId() } };
    default:
      return { ...base, id: { workspace_id: ws } };
  }
}
