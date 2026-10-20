// Notification producers, called by the services that own the events, inside their write transaction (I1):
//   comments  → comment-mentioned (members @mentioned in a comment) and comment-replied (a reply in a thread you
//               started or replied in; mention wins when both apply), E README §3.5 / notifications §2, §4;
//   tasks     → task-assigned (members newly assigned, on create and on edit);
//   documents → note-mentioned (members newly @mentioned in a note body, on every body write);
//   lists     → list-shared (a member gains access to a list through a member grant).
// Recipients must be able to read what the notification is about (the record's object, the list, a note parent or a
// linked record of the task); self-notifications are never produced (produce.ts).
import type { AccessScope, Actor, RecordRef } from '@agentic-crm/contracts';
import type { Block } from '@agentic-crm/editor/model';
import { mentionsOf } from '@agentic-crm/editor/model';
import type { Policies } from '../permissions.ts';
import { type DefInfo, isUuid, loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { type NotificationEvent, notify } from './produce.ts';

/** Members among `memberIds` who may read records of at least one of `defIds` (all of them when `defIds` is empty). */
async function readers(tx: Tx, policies: Policies, memberIds: string[], defIds: string[]): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  if (defIds.length === 0) return new Set(memberIds);
  const defs: DefInfo[] = [...(await loadDefinitionsByIds(tx, [...new Set(defIds)])).values()];
  const out = new Set<string>();
  for (const memberId of new Set(memberIds)) {
    if ((await policies.allowedFor(tx, memberId, defs, 'read_entity_instance')).length > 0) out.add(memberId);
  }
  return out;
}

const memberIdOf = (actor: Actor): string | null => (actor.type === 'workspace-member' && actor.id ? actor.id : null);

export interface CreatedComment {
  id: string;
  threadId: string;
  target: { kind: 'record' | 'list-entry'; entityDefinitionId: string; entityInstanceId: string };
  author: Actor;
  mentionedMemberIds: string[];
}

/** A new comment: mentions, then replies to the thread's participants. */
export async function notifyCommentCreated(tx: Tx, policies: Policies, comment: CreatedComment): Promise<void> {
  const author = memberIdOf(comment.author);
  const mentioned = comment.mentionedMemberIds.filter((m) => m !== author);
  let participants: string[] = [];
  if (comment.threadId !== comment.id) {
    const rows = await tx.db
      .selectFrom('comments')
      .select('author')
      .where('thread_id', '=', comment.threadId)
      .where('id', '!=', comment.id)
      .where('deleted_at', 'is', null)
      .execute();
    participants = [
      ...new Set(rows.map((r) => memberIdOf(r.author as Actor)).filter((m): m is string => m !== null)),
    ].filter((m) => m !== author && !mentioned.includes(m));
  }
  const allowed = await readers(tx, policies, [...mentioned, ...participants], [comment.target.entityDefinitionId]);
  const payload = {
    entityDefinitionId: comment.target.entityDefinitionId,
    entityInstanceId: comment.target.entityInstanceId,
    commentId: comment.id,
    threadId: comment.threadId,
  };
  const events: NotificationEvent[] = [
    ...mentioned.map((m) => ({ type: 'comment-mentioned' as const, recipientMemberId: m })),
    ...participants.map((m) => ({ type: 'comment-replied' as const, recipientMemberId: m })),
  ]
    .filter((e) => allowed.has(e.recipientMemberId))
    .map((e) => ({ ...e, payload, actor: comment.author, dedupeKey: `comment:${comment.id}` }));
  await notify(tx, events);
}

/** Members newly assigned to a task (create, or the assignees added by an edit). */
export async function notifyTaskAssigned(
  tx: Tx,
  policies: Policies,
  taskId: string,
  newAssignees: string[],
  linkedRecords: RecordRef[],
): Promise<void> {
  if (newAssignees.length === 0) return;
  const allowed = await readers(
    tx,
    policies,
    newAssignees,
    linkedRecords.map((r) => r.entityDefinitionId),
  );
  await notify(
    tx,
    newAssignees
      .filter((m) => allowed.has(m))
      .map((m) => ({ type: 'task-assigned' as const, recipientMemberId: m, payload: { taskId } })),
  );
}

/** Members newly @mentioned in the body of a note (`before` → `after`). Other document types are ignored. */
export async function notifyDocumentMentions(
  tx: Tx,
  policies: Policies,
  documentId: string,
  before: readonly Block[],
  after: readonly Block[],
): Promise<void> {
  const members = (blocks: readonly Block[]) =>
    mentionsOf(blocks).flatMap((m) => (m.type === 'member' && isUuid(m.id) ? [m.id.toLowerCase()] : []));
  const previous = new Set(members(before));
  const added = [...new Set(members(after))].filter((m) => !previous.has(m));
  if (added.length === 0) return;
  const note = await tx.db
    .selectFrom('notes')
    .select(['id'])
    .where('document_id', '=', documentId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!note) return;
  const parents = await tx.db
    .selectFrom('note_records')
    .select(['entity_definition_id', 'entity_instance_id'])
    .where('note_id', '=', note.id)
    .orderBy('position')
    .execute();
  const known = await tx.db.selectFrom('workspace_members').select('id').where('id', 'in', added).execute();
  const allowed = await readers(
    tx,
    policies,
    known.map((k) => k.id),
    parents.map((p) => p.entity_definition_id),
  );
  const primary = parents[0];
  await notify(
    tx,
    added
      .filter((m) => allowed.has(m))
      .map((m) => ({
        type: 'note-mentioned' as const,
        recipientMemberId: m,
        payload: {
          entityDefinitionId: primary?.entity_definition_id ?? null,
          entityInstanceId: primary?.entity_instance_id ?? null,
          noteId: note.id,
        },
        dedupeKey: `note-mentioned:${note.id}`,
      })),
  );
}

const GRANTING: ReadonlySet<AccessScope> = new Set(['read-only', 'read-write', 'full-access']);

/** Member grants of a list (member id → scope). */
export async function memberGrantsOf(tx: Tx, listId: string): Promise<Map<string, AccessScope>> {
  const rows = await tx.db
    .selectFrom('entity_definition_permissions')
    .select(['target_id', 'scope'])
    .where('entity_definition_id', '=', listId)
    .where('target_type', '=', 'workspace-member')
    .execute();
  return new Map(rows.map((r) => [r.target_id, r.scope]));
}

/** Members whose own grant on a list went from none / No access to an access level. */
export async function notifyListShared(
  tx: Tx,
  listId: string,
  before: Map<string, AccessScope>,
  after: Map<string, AccessScope>,
): Promise<void> {
  const events: NotificationEvent[] = [];
  for (const [memberId, scope] of after) {
    const previous = before.get(memberId);
    if (!GRANTING.has(scope) || (previous && GRANTING.has(previous))) continue;
    events.push({ type: 'list-shared', recipientMemberId: memberId, payload: { listId, level: scope } });
  }
  await notify(tx, events);
}
