// Comments, threads and reactions (BACKLOG 3.16; E README §2.8, §3.5, §4.4; public API data-model-documented §5.3).
// Threads are one level deep; only thread roots can be resolved; only the author deletes (a workspace-level API token
// may delete any comment); deleting a root deletes the thread. Visible to everyone who can read the record (entry
// comments: everyone who can read the list).
import {
  type AddReactionInput,
  addReactionInputSchema,
  type Comment,
  type CommentContent,
  type CommentCountsInput,
  type CommentCountsOutput,
  type CommentLocation,
  type CommentTarget,
  type CreateCommentInput,
  commentCountsInputSchema,
  createCommentInputSchema,
  type ListThreadsInput,
  type ListThreadsOutput,
  listThreadsInputSchema,
  type Mention,
  type ReactionGroup,
  type RemoveReactionInput,
  type ResolveCommentInput,
  removeReactionInputSchema,
  resolveCommentInputSchema,
  type TextStyle,
  type Thread,
  type ThreadSummary,
} from '@agentic-crm/contracts';
import { type CommentsTable, jsonb, type Selectable, sql } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import { notifyCommentCreated } from '../notifications/producers.ts';
import { loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { commentEvent } from '../webhooks/events.ts';
import {
  actorJson,
  type CollabDeps,
  readableDefinitions,
  requireMember,
  resolveRecordRefs,
  toActor,
  toActorOrNull,
} from './common.ts';
import { emitTimelines } from './notes.ts';

type CommentRow = Selectable<CommentsTable>;

export const commentNotFound = (id: string) => notFound("We can't find that comment", { comment_id: id });

function targetOf(row: CommentRow): CommentTarget {
  return {
    kind: row.target_kind,
    entityDefinitionId: row.entity_definition_id,
    entityInstanceId: row.entity_instance_id,
  };
}

async function reactionsOf(tx: Tx, commentIds: string[]): Promise<Map<string, ReactionGroup[]>> {
  const out = new Map<string, ReactionGroup[]>(commentIds.map((id) => [id, []]));
  if (commentIds.length === 0) return out;
  const me = actingMemberId(tx.ctx);
  const rows = await tx.db
    .selectFrom('comment_reactions')
    .selectAll()
    .where('comment_id', 'in', commentIds)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  for (const row of rows) {
    const groups = out.get(row.comment_id) as ReactionGroup[];
    let group = groups.find((g) => g.emoji === row.emoji);
    if (!group) {
      group = { emoji: row.emoji, count: 0, memberIds: [], myReactionId: null };
      groups.push(group);
    }
    group.count++;
    group.memberIds.push(row.member_id);
    if (row.member_id === me) group.myReactionId = row.id;
  }
  return out;
}

async function toComments(tx: Tx, rows: CommentRow[]): Promise<Comment[]> {
  const reactions = await reactionsOf(
    tx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const author = toActor(r.author);
    const createdBy = toActor(r.created_by);
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      threadId: r.thread_id,
      isThreadRoot: r.id === r.thread_id,
      target: targetOf(r),
      content: {
        text: r.content,
        mentions: (r.mentions ?? []) as Mention[],
        styles: (r.styles ?? []) as TextStyle[],
      } satisfies CommentContent,
      author,
      createdBy,
      viaApi: createdBy.type === 'api-token' || createdBy.id !== author.id,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolvedBy: toActorOrNull(r.resolved_by),
      reactions: reactions.get(r.id) ?? [],
    };
  });
}

/** Read access to a comment's target: the record's object (or the list) must be readable and the target live. */
async function assertTargetReadable(tx: Tx, deps: CollabDeps, target: CommentTarget): Promise<void> {
  const live = await tx.db
    .selectFrom('entity_instances')
    .select('id')
    .where('id', '=', target.entityInstanceId)
    .where('archived_at', 'is', null)
    .where('merged_at', 'is', null)
    .executeTakeFirst();
  const readable = await readableDefinitions(tx, deps, [target.entityDefinitionId]);
  if (!live || !readable.has(target.entityDefinitionId)) throw commentNotFound(target.entityInstanceId);
}

async function requireComment(tx: Tx, deps: CollabDeps, commentId: string): Promise<CommentRow> {
  const row = await tx.db
    .selectFrom('comments')
    .selectAll()
    .where('id', '=', commentId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw commentNotFound(commentId);
  try {
    await assertTargetReadable(tx, deps, targetOf(row));
  } catch {
    throw commentNotFound(commentId);
  }
  return row;
}

async function resolveTarget(
  tx: Tx,
  deps: CollabDeps,
  input: { kind: 'record' | 'list-entry'; entityDefinitionId: string; entityInstanceId: string },
): Promise<CommentTarget> {
  const def = await loadDefinition(tx, input.entityDefinitionId);
  const isEntry = def.entityType === 'collection-entry';
  if ((input.kind === 'list-entry') !== isEntry) {
    throw badRequest('VALIDATION_ERROR', `"${def.apiSlug}" is not a ${input.kind === 'record' ? 'object' : 'list'}`, {
      entity_definition_id: def.id,
    });
  }
  const [ref] = await resolveRecordRefs(
    tx,
    deps,
    [{ entityDefinitionId: def.id, entityInstanceId: input.entityInstanceId }],
    {
      allowEntries: true,
      what: input.kind,
    },
  );
  return { kind: input.kind, ...(ref as { entityDefinitionId: string; entityInstanceId: string }) };
}

function emitThread(tx: Tx, threadId: string, target: CommentTarget): void {
  tx.emit('comment-thread', threadId, { threadId });
  tx.emit('comment-thread-list', target.entityDefinitionId, {
    entityDefinitionId: target.entityDefinitionId,
    entityInstanceIds: [target.entityInstanceId],
  });
  if (target.kind === 'record') emitTimelines(tx, [target]);
}

async function threadReplies(tx: Tx, threadIds: string[]) {
  if (threadIds.length === 0) return [];
  return tx.db
    .selectFrom('comments')
    .selectAll()
    .where('thread_id', 'in', threadIds)
    .where('deleted_at', 'is', null)
    .whereRef('id', '!=', 'thread_id')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

async function summaries(tx: Tx, roots: CommentRow[]): Promise<ThreadSummary[]> {
  const replies = await threadReplies(
    tx,
    roots.map((r) => r.id),
  );
  const comments = await toComments(tx, roots);
  return comments.map((root) => {
    const mine = replies.filter((r) => r.thread_id === root.id);
    const repliers: string[] = [];
    for (const reply of [...mine].reverse()) {
      const a = toActor(reply.author);
      if (a.type === 'workspace-member' && a.id && !repliers.includes(a.id)) repliers.push(a.id);
    }
    return {
      threadId: root.id,
      root,
      replyCount: mine.length,
      replierMemberIds: repliers,
      lastReplyAt: mine.at(-1)?.created_at ?? null,
    };
  });
}

/** Member mentions (comment-mentioned notifications). */
function mentionedMembers(content: CommentContent): string[] {
  return [...new Set(content.mentions.flatMap((m) => (m.kind === 'workspace-member' ? [m.memberId] : [])))];
}

export interface CommentWriteOptions {
  /** Public API: the member the comment is written on behalf of (`author`), and a backdated `created_at`. */
  authorMemberId?: string;
  createdAt?: string;
}

export const commentOps = {
  /** PUT create with a client id (I3): a new thread on `target`, or a reply in `threadId`. */
  async create(
    tx: Tx,
    deps: CollabDeps,
    input: CreateCommentInput,
    options: CommentWriteOptions = {},
  ): Promise<Comment> {
    const data = createCommentInputSchema.parse(input);
    const existing = await tx.db.selectFrom('comments').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (existing) {
      if (existing.deleted_at !== null) throw conflict('ID_CONFLICT', 'This comment id belonged to a deleted comment');
      return (await toComments(tx, [existing]))[0] as Comment;
    }
    let target: CommentTarget;
    let threadId: string;
    if (data.threadId) {
      const root = await requireComment(tx, deps, data.threadId);
      if (root.id !== root.thread_id) {
        throw badRequest('VALIDATION_ERROR', 'Replies go to the thread root (threads are one level deep)', {
          thread_id: data.threadId,
        });
      }
      target = targetOf(root);
      threadId = root.id;
    } else {
      target = await resolveTarget(tx, deps, data.target as NonNullable<typeof data.target>);
      threadId = data.id;
    }
    let author = tx.ctx.actor;
    if (options.authorMemberId) {
      const member = await tx.db
        .selectFrom('workspace_members')
        .select('id')
        .where('id', '=', options.authorMemberId)
        .executeTakeFirst();
      if (!member)
        throw notFound('The workspace member could not be found', { workspace_member_id: options.authorMemberId });
      author = { type: 'workspace-member', id: member.id };
    }
    const row = await tx.db
      .insertInto('comments')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        thread_id: threadId,
        target_kind: target.kind,
        entity_definition_id: target.entityDefinitionId,
        entity_instance_id: target.entityInstanceId,
        content: data.content.text,
        mentions: jsonb(data.content.mentions),
        styles: jsonb(data.content.styles),
        mentioned_member_ids: mentionedMembers(data.content),
        author: jsonb(author),
        created_by: actorJson(tx),
        created_at: options.createdAt ?? tx.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    emitThread(tx, threadId, target);
    commentEvent(tx, 'created', row.id, threadId, target);
    await notifyCommentCreated(tx, deps.policies, {
      id: row.id,
      threadId,
      target,
      author,
      mentionedMemberIds: row.mentioned_member_ids,
    });
    return (await toComments(tx, [row]))[0] as Comment;
  },

  /** Resolve / re-open a thread (roots only, E README §3.5). */
  async resolve(tx: Tx, deps: CollabDeps, input: ResolveCommentInput): Promise<Comment> {
    const data = resolveCommentInputSchema.parse(input);
    const row = await requireComment(tx, deps, data.commentId);
    if (row.id !== row.thread_id) throw badRequest('VALIDATION_ERROR', 'Only thread roots can be resolved');
    const changed = data.resolved !== (row.resolved_at !== null);
    const updated = changed
      ? await tx.db
          .updateTable('comments')
          .set(
            data.resolved
              ? { resolved_at: tx.now, resolved_by: actorJson(tx) }
              : { resolved_at: null, resolved_by: null },
          )
          .where('id', '=', row.id)
          .returningAll()
          .executeTakeFirstOrThrow()
      : row;
    if (changed) {
      emitThread(tx, row.thread_id, targetOf(row));
      commentEvent(tx, data.resolved ? 'resolved' : 'unresolved', row.id, row.thread_id, targetOf(row));
    }
    return (await toComments(tx, [updated]))[0] as Comment;
  },

  /**
   * Delete (author only; workspace-level API tokens may delete any comment). Deleting a thread root deletes the
   * replies. Answers the deleted ids.
   */
  async delete(tx: Tx, deps: CollabDeps, commentId: string): Promise<{ deletedIds: string[] }> {
    const row = await requireComment(tx, deps, commentId);
    const actor = tx.ctx.actor;
    const author = toActor(row.author);
    const isAuthor = actor.type === author.type && actor.id === author.id;
    const isWorkspaceToken = actor.type === 'api-token' || actor.type === 'system';
    if (!isAuthor && !isWorkspaceToken)
      throw forbidden('Only the author can delete this comment', { comment_id: commentId });
    const deleted = await tx.db
      .updateTable('comments')
      .set({ deleted_at: tx.now, deleted_by: actorJson(tx) })
      .where((eb) => (row.id === row.thread_id ? eb('thread_id', '=', row.id) : eb('id', '=', row.id)))
      .where('deleted_at', 'is', null)
      .returning('id')
      .execute();
    emitThread(tx, row.thread_id, targetOf(row));
    for (const d of deleted) commentEvent(tx, 'deleted', d.id, row.thread_id, targetOf(row));
    return { deletedIds: deleted.map((d) => d.id) };
  },

  async addReaction(tx: Tx, deps: CollabDeps, input: AddReactionInput): Promise<Comment> {
    const data = addReactionInputSchema.parse(input);
    const memberId = requireMember(tx);
    const row = await requireComment(tx, deps, data.commentId);
    const byId = await tx.db
      .selectFrom('comment_reactions')
      .selectAll()
      .where('id', '=', data.reactionId)
      .executeTakeFirst();
    if (byId && (byId.comment_id !== row.id || byId.member_id !== memberId)) {
      throw conflict('ID_CONFLICT', 'This reaction id is already used', { reaction_id: data.reactionId });
    }
    if (!byId) {
      const inserted = await tx.db
        .insertInto('comment_reactions')
        .values({
          id: data.reactionId,
          workspace_id: tx.workspaceId,
          comment_id: row.id,
          emoji: data.emoji,
          member_id: memberId,
          created_at: tx.now,
        })
        .onConflict((oc) => oc.columns(['comment_id', 'emoji', 'member_id']).doNothing())
        .returning('id')
        .execute();
      if (inserted.length > 0) emitThread(tx, row.thread_id, targetOf(row));
    }
    return (await toComments(tx, [row]))[0] as Comment;
  },

  /** Removes the caller's reaction (idempotent). */
  async removeReaction(tx: Tx, deps: CollabDeps, input: RemoveReactionInput): Promise<Comment> {
    const data = removeReactionInputSchema.parse(input);
    const memberId = requireMember(tx);
    const row = await requireComment(tx, deps, data.commentId);
    const deleted = await tx.db
      .deleteFrom('comment_reactions')
      .where('id', '=', data.reactionId)
      .where('comment_id', '=', row.id)
      .where('member_id', '=', memberId)
      .returning('id')
      .execute();
    if (deleted.length > 0) emitThread(tx, row.thread_id, targetOf(row));
    return (await toComments(tx, [row]))[0] as Comment;
  },

  /** "All comments" panels: threads of a record / entry or of every record of an object, newest first. */
  async listThreads(tx: Tx, deps: CollabDeps, input: ListThreadsInput): Promise<ListThreadsOutput> {
    const data = listThreadsInputSchema.parse(input);
    let query = tx.db
      .selectFrom('comments as c')
      .selectAll('c')
      .where('c.deleted_at', 'is', null)
      .whereRef('c.id', '=', 'c.thread_id');
    if (data.target) {
      const target = await resolveTarget(tx, deps, data.target);
      query = query.where('c.entity_instance_id', '=', target.entityInstanceId);
    } else {
      const def = await loadDefinition(tx, data.entityDefinitionId as string);
      await deps.policies.assertCan(tx, def.id, 'read_entity_instance');
      query = query
        .where('c.entity_definition_id', '=', def.id)
        .where(({ exists, selectFrom }) =>
          exists(
            selectFrom('entity_instances as ei')
              .select('ei.id')
              .whereRef('ei.id', '=', 'c.entity_instance_id')
              .where('ei.archived_at', 'is', null)
              .where('ei.merged_at', 'is', null),
          ),
        );
      if (data.snapshotId) {
        // Rows of a view's snapshot (list Comments panel: comments on the entries of the current view).
        const snapshot = await tx.db
          .selectFrom('list_snapshots')
          .select('entity_definition_id')
          .where('id', '=', data.snapshotId)
          .where('expires_at', '>', tx.now)
          .executeTakeFirst();
        if (!snapshot || snapshot.entity_definition_id !== def.id) {
          throw notFound(
            'The snapshot has expired or does not exist',
            { snapshot_id: data.snapshotId },
            'SNAPSHOT_NOT_FOUND',
          );
        }
        query = query.where(
          sql<boolean>`c.entity_instance_id IN (SELECT unnest(ch.ids) FROM list_snapshot_chunks ch
            WHERE ch.snapshot_id = ${data.snapshotId}::uuid)`,
        );
      }
    }
    if (!data.includeResolved) query = query.where('c.resolved_at', 'is', null);
    if (data.onlyMine) {
      const me = requireMember(tx);
      // My threads: I started it or replied in it.
      query = query.where(
        sql<boolean>`(c.author ->> 'id' = ${me} OR EXISTS (SELECT 1 FROM comments r WHERE r.thread_id = c.id
          AND r.deleted_at IS NULL AND r.author ->> 'id' = ${me}))`,
      );
    }
    const roots = await query.orderBy('c.created_at', 'desc').orderBy('c.id', 'desc').execute();
    const page = roots.slice(data.offset, data.offset + data.limit);
    return { threads: await summaries(tx, page), total: roots.length };
  },

  async getThread(tx: Tx, deps: CollabDeps, threadId: string): Promise<Thread> {
    const root = await requireComment(tx, deps, threadId);
    if (root.id !== root.thread_id) throw commentNotFound(threadId);
    const replies = await threadReplies(tx, [root.id]);
    const [rootComment, ...replyComments] = await toComments(tx, [root, ...replies]);
    return { threadId: root.id, root: rootComment as Comment, replies: replyComments };
  },

  async get(tx: Tx, deps: CollabDeps, commentId: string): Promise<Comment> {
    const row = await requireComment(tx, deps, commentId);
    return (await toComments(tx, [row]))[0] as Comment;
  },

  /** Deep link `/comment/$commentHeaderId` → where to open it (record + thread, or list entry + thread). */
  async locate(tx: Tx, deps: CollabDeps, commentId: string): Promise<CommentLocation> {
    const row = await requireComment(tx, deps, commentId);
    let parentRecord: CommentLocation['parentRecord'] = null;
    if (row.target_kind === 'list-entry') {
      const { rows } = await sql<{ v_ref: string; v_ref_def: string }>`
        SELECT v.v_ref, v.v_ref_def FROM attribute_values v
        JOIN attribute_definitions a ON a.id = v.attribute_id AND a.system_attribute_type = 'entry-parent-record'
        WHERE v.instance_id = ${row.entity_instance_id} AND v.active_until IS NULL AND v.v_ref IS NOT NULL
        LIMIT 1`.execute(tx.db);
      const ref = rows[0];
      if (ref) parentRecord = { entityDefinitionId: ref.v_ref_def, entityInstanceId: ref.v_ref };
    }
    const root =
      row.id === row.thread_id
        ? row
        : await tx.db.selectFrom('comments').select(['resolved_at']).where('id', '=', row.thread_id).executeTakeFirst();
    return {
      commentId: row.id,
      threadId: row.thread_id,
      target: targetOf(row),
      parentRecord,
      isResolved: (root?.resolved_at ?? null) !== null,
    };
  },

  /** Thread counts per record (table dots, header count). Unreadable objects answer zeros. */
  async counts(tx: Tx, deps: CollabDeps, input: CommentCountsInput): Promise<CommentCountsOutput> {
    const data = commentCountsInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    const counts: CommentCountsOutput['counts'] = Object.fromEntries(
      data.entityInstanceIds.map((id) => [id, { threads: 0, unresolvedThreads: 0, comments: 0 }]),
    );
    const readable = await readableDefinitions(tx, deps, [def.id]);
    if (!readable.has(def.id)) return { counts };
    const { rows } = await sql<{ entity_instance_id: string; threads: string; unresolved: string; comments: string }>`
      SELECT c.entity_instance_id,
             count(*) FILTER (WHERE c.id = c.thread_id) AS threads,
             count(*) FILTER (WHERE c.id = c.thread_id AND r.resolved_at IS NULL) AS unresolved,
             count(*) AS comments
      FROM comments c JOIN comments r ON r.id = c.thread_id AND r.deleted_at IS NULL
      WHERE c.entity_instance_id = ANY(${data.entityInstanceIds}::uuid[]) AND c.deleted_at IS NULL
      GROUP BY c.entity_instance_id`.execute(tx.db);
    for (const r of rows) {
      counts[r.entity_instance_id] = {
        threads: Number(r.threads),
        unresolvedThreads: Number(r.unresolved),
        comments: Number(r.comments),
      };
    }
    return { counts };
  },
};
