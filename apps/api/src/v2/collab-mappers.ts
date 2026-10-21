// Notes, tasks, comments, threads, files and folders mapped from domain entities to public REST responses.
import type { Comment, Note, StorageEntry, Task, WorkspaceMember } from '@agentic-crm/contracts';
import { BUILTIN_STORAGE_PROVIDER } from '@agentic-crm/contracts/v2';
import type { V2Context } from './context';
import { publicActor, publicTimestamp } from './mappers';

/** api_slug of a definition (public `parent_object`, `object_slug`); falls back to the id. */
export async function slugOf(v2: V2Context, entityDefinitionId: string): Promise<string> {
  return (await v2.definitionById(entityDefinitionId))?.apiSlug ?? entityDefinitionId;
}

type Tag =
  | { type: 'workspace-member'; workspace_member_id: string }
  | { type: 'record'; object: string; record_id: string };

/**
 * Mentions in a note body (`tags`): members and records referenced by the flat blocks. The block shape belongs to
 * packages/editor, so this walks the supported camelCase and snake_case reference shapes:
 * `{memberId | workspaceMemberId | referenced_actor_id}` and `{entityDefinitionId, entityInstanceId}`.
 */
export async function noteTags(v2: V2Context, blocks: unknown[] | null): Promise<Tag[]> {
  if (!blocks) return [];
  const members = new Set<string>();
  const records = new Map<string, string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const o = node as Record<string, unknown>;
    const memberId = o.memberId ?? o.workspaceMemberId ?? o.workspace_member_id ?? o.referenced_actor_id;
    if (typeof memberId === 'string') members.add(memberId);
    const def = o.entityDefinitionId ?? o.entity_definition_id ?? o.target_entity_definition_id;
    const inst = o.entityInstanceId ?? o.entity_instance_id ?? o.target_entity_instance_id;
    if (typeof def === 'string' && typeof inst === 'string') records.set(inst, def);
    for (const v of Object.values(o)) if (typeof v === 'object') walk(v);
  };
  walk(blocks);
  const tags: Tag[] = [...members].map((id) => ({ type: 'workspace-member', workspace_member_id: id }));
  for (const [recordId, defId] of records)
    tags.push({ type: 'record', object: await slugOf(v2, defId), record_id: recordId });
  return tags;
}

export async function noteToPublic(v2: V2Context, note: Note) {
  const parent = note.parentRecords[0];
  return {
    id: { workspace_id: note.workspaceId, note_id: note.id },
    parent_object: parent ? await slugOf(v2, parent.entityDefinitionId) : '',
    parent_record_id: parent?.entityInstanceId ?? '',
    title: note.title,
    meeting_id: note.meetingId,
    content_plaintext: note.content?.plaintext ?? '',
    content_markdown: note.content?.markdown ?? '',
    tags: await noteTags(v2, note.content?.blocks ?? null),
    created_by_actor: publicActor(note.createdBy),
    created_at: publicTimestamp(note.createdAt),
  };
}

export function taskToPublic(task: Task) {
  return {
    id: { workspace_id: task.workspaceId, task_id: task.id },
    content_plaintext: task.content.text,
    deadline_at: task.deadlineAt === null ? null : publicTimestamp(task.deadlineAt),
    is_completed: task.isCompleted,
    completed_at: task.completedAt === null ? null : publicTimestamp(task.completedAt),
    linked_records: task.linkedRecords.map((r) => ({
      target_object_id: r.entityDefinitionId,
      target_record_id: r.entityInstanceId,
    })),
    assignees: task.assigneeMemberIds.map((id) => ({
      referenced_actor_type: 'workspace-member',
      referenced_actor_id: id,
    })),
    created_by_actor: publicActor(task.createdBy),
    created_at: publicTimestamp(task.createdAt),
  };
}

/** Public `content_plaintext`: member mentions become their email addresses (data-model-documented §5.3). */
export function commentPlaintext(comment: Comment, members: Map<string, WorkspaceMember>): string {
  let text = comment.content.text;
  const mentions = comment.content.mentions
    .filter((m) => m.kind === 'workspace-member')
    .sort((a, b) => b.start - a.start);
  for (const m of mentions) {
    if (m.kind !== 'workspace-member') continue;
    const email = members.get(m.memberId)?.emailAddress;
    if (email) text = `${text.slice(0, m.start)}${email}${text.slice(m.start + m.length)}`;
  }
  return text;
}

export interface CommentContextLookups {
  members: Map<string, WorkspaceMember>;
  /** Entry id → its parent record (for entry comments the public `record` is the entry's record). */
  entryParents: Map<string, { entityDefinitionId: string; entityInstanceId: string } | null>;
}

export function commentToPublic(comment: Comment, lookups: CommentContextLookups) {
  const isEntry = comment.target.kind === 'list-entry';
  const parent = isEntry ? lookups.entryParents.get(comment.target.entityInstanceId) : null;
  return {
    id: { workspace_id: comment.workspaceId, comment_id: comment.id },
    thread_id: comment.threadId,
    content_plaintext: commentPlaintext(comment, lookups.members),
    entry: isEntry ? { entry_id: comment.target.entityInstanceId, list_id: comment.target.entityDefinitionId } : null,
    record: isEntry
      ? {
          record_id: parent?.entityInstanceId ?? comment.target.entityInstanceId,
          object_id: parent?.entityDefinitionId ?? comment.target.entityDefinitionId,
        }
      : { record_id: comment.target.entityInstanceId, object_id: comment.target.entityDefinitionId },
    resolved_at: comment.resolvedAt === null ? null : publicTimestamp(comment.resolvedAt),
    resolved_by: publicActor(comment.resolvedBy),
    created_at: publicTimestamp(comment.createdAt),
    author: publicActor(comment.author),
  };
}

export async function fileToPublic(v2: V2Context, entry: StorageEntry, options: { hasChildren?: boolean } = {}) {
  const common = {
    id: { workspace_id: entry.workspaceId, file_id: entry.id },
    object_id: entry.entityDefinitionId,
    object_slug: await slugOf(v2, entry.entityDefinitionId),
    record_id: entry.entityInstanceId,
    // Storage is owned by this service; persisted provider identifiers are an internal implementation detail.
    storage_provider: BUILTIN_STORAGE_PROVIDER,
    created_by_actor: publicActor(entry.createdBy),
    created_at: publicTimestamp(entry.createdAt),
  };
  if (entry.entryType === 'folder') {
    return {
      ...common,
      file_type: 'folder' as const,
      name: entry.name,
      parent_folder_id: entry.parentFolderId,
      ...(options.hasChildren ? { has_children: entry.hasChildren ?? false } : {}),
    };
  }
  return {
    ...common,
    file_type: 'file' as const,
    name: entry.name,
    content_type: entry.contentType,
    content_size: entry.contentSize,
    parent_folder_id: entry.parentFolderId,
  };
}
