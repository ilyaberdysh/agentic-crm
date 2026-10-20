// Webhook events at the write path. Services call these producers next to their invalidations; Tx.flush() normalises
// the transaction's events, keeps types subscribed to by active webhooks, and writes them as one change_log row. The worker
// completes each event (workspace id, actor, parent ids that are cheaper to look up only when someone listens) and
// fans it out to the matching subscriptions.
import type { Tx } from '../tx.ts';

/** An event as recorded in change_log: Attio's payload without workspace_id and actor (added at fan-out). */
export interface DomainEvent {
  event_type: string;
  id: Record<string, string | null>;
  [key: string]: unknown;
}

interface DefLike {
  id: string;
  entityType: string;
}

const OBJECT_TYPES = new Set(['person-record', 'company-record', 'standard-object', 'custom-record']);
const isList = (def: DefLike) => def.entityType === 'collection-entry';
const isObject = (def: DefLike) => OBJECT_TYPES.has(def.entityType);

/** record.* for objects, list-entry.* for lists; other definitions (tasks, members) have their own events. */
export function recordEvent(
  tx: Tx,
  def: DefLike,
  op: 'created' | 'updated' | 'deleted',
  instanceId: string,
  attributeId?: string,
): void {
  if (isList(def)) {
    tx.event({
      event_type: `list-entry.${op}`,
      id: { list_id: def.id, entry_id: instanceId, ...(op === 'updated' ? { attribute_id: attributeId ?? null } : {}) },
    });
  } else if (isObject(def)) {
    tx.event({
      event_type: `record.${op}`,
      id: {
        object_id: def.id,
        record_id: instanceId,
        ...(op === 'updated' ? { attribute_id: attributeId ?? null } : {}),
      },
    });
  }
}

/** "Merging produces a new record …; each merge fires two events" (record.merged reference). */
export function recordMergedEvent(tx: Tx, def: DefLike, mergedId: string, duplicateId: string): void {
  if (!isObject(def)) return;
  tx.event({
    event_type: 'record.merged',
    id: { object_id: def.id, record_id: mergedId },
    duplicate_object_id: def.id,
    duplicate_record_id: duplicateId,
  });
}

export function attributeEvent(tx: Tx, def: DefLike, op: 'created' | 'updated', attributeId: string): void {
  if (isList(def)) tx.event({ event_type: `list-attribute.${op}`, id: { list_id: def.id, attribute_id: attributeId } });
  else if (isObject(def)) {
    tx.event({ event_type: `object-attribute.${op}`, id: { object_id: def.id, attribute_id: attributeId } });
  }
}

export function listEvent(tx: Tx, op: 'created' | 'updated' | 'deleted', listId: string): void {
  tx.event({ event_type: `list.${op}`, id: { list_id: listId } });
}

export function noteEvent(
  tx: Tx,
  op: 'created' | 'updated' | 'deleted' | 'content-updated',
  noteId: string,
  parent: { entityDefinitionId: string; entityInstanceId: string } | null,
): void {
  tx.event({
    event_type: op === 'content-updated' ? 'note-content.updated' : `note.${op}`,
    id: { note_id: noteId },
    ...(parent ? { parent_object_id: parent.entityDefinitionId, parent_record_id: parent.entityInstanceId } : {}),
  });
}

export function taskEvent(tx: Tx, op: 'created' | 'updated' | 'deleted', taskId: string): void {
  tx.event({ event_type: `task.${op}`, id: { task_id: taskId } });
}

export function commentEvent(
  tx: Tx,
  op: 'created' | 'resolved' | 'unresolved' | 'deleted',
  commentId: string,
  threadId: string,
  target: { kind: 'record' | 'list-entry'; entityDefinitionId: string; entityInstanceId: string },
): void {
  tx.event({
    event_type: `comment.${op}`,
    id: { comment_id: commentId },
    thread_id: threadId,
    // Entry comments name their list and entry; the parent record is completed at fan-out.
    ...(target.kind === 'record'
      ? { object_id: target.entityDefinitionId, record_id: target.entityInstanceId, list_id: null, entry_id: null }
      : { list_id: target.entityDefinitionId, entry_id: target.entityInstanceId }),
  });
}

export function workspaceMemberCreatedEvent(tx: Tx, memberId: string): void {
  tx.event({ event_type: 'workspace-member.created', id: { workspace_member_id: memberId } });
}

const keyOf = (e: DomainEvent) => JSON.stringify([e.event_type, e.id, e.duplicate_record_id ?? null]);

/**
 * One transaction's events as Attio sends them: duplicates dropped; a record or entry created (or produced by a merge)
 * in the transaction does not also report `updated`; notes created in it do not report content updates.
 */
export function normalizeEvents(events: DomainEvent[]): DomainEvent[] {
  const created = new Set<string>();
  for (const e of events) {
    if (e.event_type === 'record.created' || e.event_type === 'record.merged') created.add(`r:${e.id.record_id}`);
    if (e.event_type === 'list-entry.created') created.add(`e:${e.id.entry_id}`);
    if (e.event_type === 'note.created') created.add(`n:${e.id.note_id}`);
  }
  const merged = new Set(events.filter((e) => e.event_type === 'record.merged').map((e) => `r:${e.id.record_id}`));
  const seen = new Set<string>();
  const out: DomainEvent[] = [];
  for (const e of events) {
    if (e.event_type === 'record.updated' && created.has(`r:${e.id.record_id}`)) continue;
    if (e.event_type === 'record.created' && merged.has(`r:${e.id.record_id}`)) continue;
    if (e.event_type === 'list-entry.updated' && created.has(`e:${e.id.entry_id}`)) continue;
    if (
      (e.event_type === 'note-content.updated' || e.event_type === 'note.updated') &&
      created.has(`n:${e.id.note_id}`)
    )
      continue;
    const key = keyOf(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** The events some active webhook of the workspace subscribes to (none → nothing is written). */
export async function subscribedEvents(tx: Tx, events: DomainEvent[]): Promise<DomainEvent[]> {
  if (events.length === 0) return events;
  const rows = await tx.db
    .selectFrom('webhook_subscriptions as s')
    .innerJoin('webhooks as w', 'w.id', 's.webhook_id')
    .select('s.event_type')
    .distinct()
    .where('w.deleted_at', 'is', null)
    .where('w.status', '!=', 'inactive')
    .execute();
  if (rows.length === 0) return [];
  const types = new Set(rows.map((r) => r.event_type));
  return events.filter((e) => types.has(e.event_type));
}
