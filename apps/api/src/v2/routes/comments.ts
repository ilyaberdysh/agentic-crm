// Threads and comments (E README §6; data-model-documented §5.3): list threads of a record or list entry, get a
// thread with paged comments, create a comment (new thread on a record / entry, or a reply), get, delete.
import type { Comment, CommentTarget, EntityDefinition, Mention } from '@agentic-crm/contracts';
import {
  createCommentBody,
  getCommentPathParams,
  getThreadPathParams,
  getThreadQuery,
  listThreadsQuery,
  v2Operations,
} from '@agentic-crm/contracts/v2';
import { newId } from '@agentic-crm/domain';
import { type CommentContextLookups, commentToPublic } from '../collab-mappers';
import type { V2Context } from '../context';
import { publicErrors, toPublicError, withHints } from '../errors';
import { attioTimestamp } from '../mappers';
import { params, parseInput, type RouteSpec } from '../route';

const DEFAULT_THREADS = 10;
const MAX_THREADS = 50;
/** Replies included per thread in list responses (has_more_comments flags the rest). */
const LIST_REPLIES = 80;
const MAX_THREAD_PAGE = 250;

const commentNotFound = (id: string) => publicErrors.notFound(`Comment with ID "${id}" not found.`);
const threadNotFound = (id: string) => publicErrors.notFound(`Thread with ID "${id}" not found.`);

/** `{list}`: a list by api_slug or id (lists are collection-entry definitions). */
async function list(v2: V2Context, slugOrId: string): Promise<EntityDefinition> {
  const key = slugOrId.toLowerCase();
  const def = (await v2.allDefinitions()).find(
    (d) => d.entityType === 'collection-entry' && (d.apiSlug === slugOrId || d.id === key),
  );
  if (!def) throw publicErrors.listNotFound(slugOrId);
  return def;
}

async function lookups(v2: V2Context, comments: Comment[]): Promise<CommentContextLookups> {
  const members = new Map((await v2.workspaceMembers()).map((m) => [m.id, m]));
  const entryParents: CommentContextLookups['entryParents'] = new Map();
  for (const c of comments) {
    if (c.target.kind !== 'list-entry' || entryParents.has(c.target.entityInstanceId)) continue;
    const located = await v2.domain.comments.locate(v2.ctx, c.id);
    entryParents.set(c.target.entityInstanceId, located.parentRecord);
  }
  return { members, entryParents };
}

/** Members mentioned by email address in plain-text content (create-a-comment). */
async function emailMentions(v2: V2Context, text: string): Promise<Mention[]> {
  const members = await v2.workspaceMembers();
  const mentions: Mention[] = [];
  for (const member of members) {
    const email = member.emailAddress.toLowerCase();
    if (!email) continue;
    const lower = text.toLowerCase();
    for (let i = lower.indexOf(email); i !== -1; i = lower.indexOf(email, i + email.length)) {
      mentions.push({ kind: 'workspace-member', start: i, length: email.length, memberId: member.id });
    }
  }
  return mentions.sort((a, b) => a.start - b.start);
}

async function getComment(v2: V2Context, id: string): Promise<Comment> {
  try {
    return await v2.domain.comments.get(v2.ctx, id);
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) throw commentNotFound(id);
    throw err;
  }
}

export const commentRoutes: RouteSpec[] = [
  {
    method: 'GET',
    url: '/threads',
    scopes: v2Operations.listThreads.scopes,
    async handler(v2, request) {
      const query = parseInput(listThreadsQuery, request.query, 'query parameters');
      let target: CommentTarget;
      if (query.record_id && query.object) {
        const def = await v2.object(query.object);
        target = { kind: 'record', entityDefinitionId: def.id, entityInstanceId: query.record_id };
      } else if (query.entry_id && query.list) {
        const def = await list(v2, query.list);
        target = { kind: 'list-entry', entityDefinitionId: def.id, entityInstanceId: query.entry_id };
      } else {
        throw publicErrors.validation('Provide record_id with object, or entry_id with list.');
      }
      const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_THREADS), 1), MAX_THREADS);
      const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
      const { threads } = await withHints({ object: query.object, recordId: query.record_id }, () =>
        v2.domain.comments.listThreads(v2.ctx, { target, includeResolved: true, limit, offset }),
      );
      const full = await Promise.all(threads.map((t) => v2.domain.comments.getThread(v2.ctx, t.threadId)));
      const all = full.flatMap((t) => [t.root, ...t.replies]);
      const look = await lookups(v2, all);
      return {
        // Oldest thread first (Attio orders threads by creation).
        data: full.reverse().map((t) => ({
          id: { workspace_id: v2.workspaceId, thread_id: t.threadId },
          created_at: attioTimestamp(t.root.createdAt),
          comments: [t.root, ...t.replies.slice(0, LIST_REPLIES)].map((c) => commentToPublic(c, look)),
          has_more_comments: t.replies.length > LIST_REPLIES,
        })),
      };
    },
  },
  {
    method: 'GET',
    url: '/threads/:thread_id',
    scopes: v2Operations.getThread.scopes,
    async handler(v2, request) {
      const parsed = getThreadPathParams.safeParse(params(request));
      if (!parsed.success) throw threadNotFound(params(request).thread_id ?? '');
      const id = parsed.data.thread_id.toLowerCase();
      const query = parseInput(getThreadQuery, request.query, 'query parameters');
      const limit = Math.min(Math.max(Math.trunc(query.limit ?? MAX_THREAD_PAGE), 1), MAX_THREAD_PAGE);
      let offset = 0;
      if (query.cursor) {
        const decoded = Number(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (!Number.isInteger(decoded) || decoded < 0) throw publicErrors.validation('Invalid cursor.');
        offset = decoded;
      }
      let thread: Awaited<ReturnType<typeof v2.domain.comments.getThread>>;
      try {
        thread = await v2.domain.comments.getThread(v2.ctx, id);
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) throw threadNotFound(id);
        throw err;
      }
      const after = query.created_after ? Date.parse(query.created_after) : null;
      const comments = [thread.root, ...thread.replies].filter(
        (c) => after === null || Date.parse(c.createdAt) > after,
      );
      const page = comments.slice(offset, offset + limit);
      const look = await lookups(v2, page);
      return {
        data: {
          id: { workspace_id: v2.workspaceId, thread_id: thread.threadId },
          created_at: attioTimestamp(thread.root.createdAt),
          comments: page.map((c) => commentToPublic(c, look)),
        },
        pagination: {
          next_cursor:
            offset + limit < comments.length ? Buffer.from(String(offset + limit)).toString('base64url') : null,
        },
      };
    },
  },
  {
    method: 'POST',
    url: '/comments',
    scopes: v2Operations.createComment.scopes,
    async handler(v2, request) {
      const { data } = parseInput(createCommentBody, request.body, 'request body');
      const members = await v2.workspaceMembers();
      const author = members.find((m) => m.id === data.author.id.toLowerCase());
      if (!author) throw publicErrors.valueNotFound(`Workspace member with ID "${data.author.id}" not found.`);
      if (data.content.trim() === '') throw publicErrors.validation('content must not be empty.');
      let createdAt: string | undefined;
      if (data.created_at !== undefined) {
        const t = Date.parse(data.created_at);
        if (Number.isNaN(t) || t > Date.now() + 60_000)
          throw publicErrors.validation('created_at must be in the past.');
        createdAt = new Date(t).toISOString();
      }
      const content = { text: data.content, mentions: await emailMentions(v2, data.content), styles: [] };
      let input: Parameters<typeof v2.domain.comments.create>[1];
      if ('thread_id' in data && data.thread_id) {
        input = { id: newId(), content, threadId: data.thread_id.toLowerCase() };
      } else if ('record' in data && data.record) {
        const def = await v2.object(data.record.object);
        input = {
          id: newId(),
          content,
          target: { kind: 'record', entityDefinitionId: def.id, entityInstanceId: data.record.record_id },
        };
      } else if ('entry' in data && data.entry) {
        const def = await list(v2, data.entry.list);
        input = {
          id: newId(),
          content,
          target: { kind: 'list-entry', entityDefinitionId: def.id, entityInstanceId: data.entry.entry_id },
        };
      } else {
        throw publicErrors.validation('Provide thread_id, record or entry.');
      }
      let comment: Comment;
      try {
        comment = await v2.domain.comments.create(v2.ctx, input, {
          authorMemberId: author.id,
          ...(createdAt ? { createdAt } : {}),
        });
      } catch (err) {
        if ('threadId' in input && input.threadId && (err as { statusCode?: number }).statusCode === 404) {
          throw threadNotFound(input.threadId);
        }
        throw toPublicError(err);
      }
      return { data: commentToPublic(comment, await lookups(v2, [comment])) };
    },
  },
  {
    method: 'GET',
    url: '/comments/:comment_id',
    scopes: v2Operations.getComment.scopes,
    async handler(v2, request) {
      const parsed = getCommentPathParams.safeParse(params(request));
      if (!parsed.success) throw commentNotFound(params(request).comment_id ?? '');
      const comment = await getComment(v2, parsed.data.comment_id.toLowerCase());
      return { data: commentToPublic(comment, await lookups(v2, [comment])) };
    },
  },
  {
    method: 'DELETE',
    url: '/comments/:comment_id',
    scopes: v2Operations.deleteComment.scopes,
    async handler(v2, request) {
      const parsed = getCommentPathParams.safeParse(params(request));
      if (!parsed.success) throw commentNotFound(params(request).comment_id ?? '');
      const id = parsed.data.comment_id.toLowerCase();
      await getComment(v2, id);
      await withHints({}, () => v2.domain.comments.delete(v2.ctx, id));
      return {};
    },
  },
];
