// Comments, threads and reactions on the client (BACKLOG 3.16; E README §2.8, §3.5). Thread lists live under
// ['ws', ws, 'comment-thread-list', params], one thread under ['ws', ws, 'comment-thread', threadId] (realtime: one
// prefix per resource). Posting appends optimistically; reactions and resolve toggle optimistically and revert on
// error.
import type {
  Comment,
  CommentContent,
  CommentTargetInput,
  ListThreadsInput,
  ListThreadsOutput,
  Thread,
} from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { keys } from '../../data/keys';
import { api, errorEnvelopeOf, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useWorkspaceRef } from '../notes/data';

export type { Comment, Thread };
export type ThreadSummary = ListThreadsOutput['threads'][number];

export const commentKeys = {
  threads: (ws: string, params: ListThreadsInput) => [...keys.resource(ws, 'comment-thread-list'), params] as const,
  allThreads: (ws: string) => keys.resource(ws, 'comment-thread-list'),
  thread: (ws: string, threadId: string) => [...keys.resource(ws, 'comment-thread'), threadId] as const,
  allThread: (ws: string) => keys.resource(ws, 'comment-thread'),
};

export function useThreads(params: ListThreadsInput, enabled = true) {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: commentKeys.threads(ws.id, params),
    queryFn: () => api.comments.listThreads.query(params, inWorkspace(ws)),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useThread(threadId: string | null) {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: commentKeys.thread(ws.id, threadId ?? ''),
    queryFn: () => api.comments.getThread.query({ threadId: threadId as string }, inWorkspace(ws)),
    enabled: Boolean(threadId),
    retry: (count, error) => count < 2 && !/not found|404/i.test(String((error as Error)?.message)),
  });
}

/** Thread counts per record (record header "View comment(s)" count, table dots). */
export function useCommentCounts(entityDefinitionId: string, entityInstanceIds: string[]) {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: [...keys.resource(ws.id, 'comment-thread-list'), 'counts', entityDefinitionId, entityInstanceIds],
    queryFn: () => api.comments.counts.query({ entityDefinitionId, entityInstanceIds }, inWorkspace(ws)),
    enabled: entityInstanceIds.length > 0 && Boolean(entityDefinitionId),
  });
}

// ---- writes -------------------------------------------------------------------------------------------------------

function refresh(client: QueryClient, ws: WorkspaceRef) {
  void client.invalidateQueries({ queryKey: commentKeys.allThreads(ws.id) });
  void client.invalidateQueries({ queryKey: commentKeys.allThread(ws.id) });
}

/** Patches a comment wherever it is cached (thread views and the roots of thread lists). */
function patchComment(client: QueryClient, ws: string, commentId: string, patch: (c: Comment) => Comment) {
  client.setQueriesData<Thread>({ queryKey: commentKeys.allThread(ws) }, (prev) => {
    if (!prev || !('root' in prev) || !('replies' in prev)) return prev;
    return {
      ...prev,
      root: prev.root.id === commentId ? patch(prev.root) : prev.root,
      replies: prev.replies.map((r) => (r.id === commentId ? patch(r) : r)),
    };
  });
  client.setQueriesData<ListThreadsOutput>({ queryKey: commentKeys.allThreads(ws) }, (prev) => {
    if (!prev || !('threads' in prev)) return prev;
    return { ...prev, threads: prev.threads.map((t) => (t.root.id === commentId ? { ...t, root: patch(t.root) } : t)) };
  });
}

export async function postComment(
  client: QueryClient,
  ws: WorkspaceRef,
  input: { content: CommentContent; target?: CommentTargetInput; threadId?: string },
): Promise<Comment | null> {
  try {
    const { comment, seq } = await api.comments.create.mutate({ id: newId(), ...input }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
    if (input.threadId) {
      client.setQueryData<Thread>(commentKeys.thread(ws.id, input.threadId), (prev) =>
        prev ? { ...prev, replies: [...prev.replies.filter((r) => r.id !== comment.id), comment] } : prev,
      );
    }
    refresh(client, ws);
    return comment;
  } catch (error) {
    toast.error({ title: 'Failed to post the comment', description: errorEnvelopeOf(error).message });
    return null;
  }
}

export async function resolveThread(client: QueryClient, ws: WorkspaceRef, root: Comment, resolved: boolean) {
  const before = root;
  patchComment(client, ws.id, root.id, (c) => ({
    ...c,
    resolvedAt: resolved ? new Date().toISOString() : null,
    resolvedBy: resolved ? c.resolvedBy : null,
  }));
  try {
    const { seq } = await api.comments.resolve.mutate({ commentId: root.id, resolved }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
  } catch (error) {
    patchComment(client, ws.id, root.id, () => before);
    toast.error({ title: 'Failed to update the comment', description: errorEnvelopeOf(error).message });
  } finally {
    refresh(client, ws);
  }
}

export async function deleteComment(client: QueryClient, ws: WorkspaceRef, comment: Comment): Promise<boolean> {
  try {
    const { seq } = await api.comments.delete.mutate({ commentId: comment.id }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
    if (!comment.isThreadRoot) {
      client.setQueryData<Thread>(commentKeys.thread(ws.id, comment.threadId), (prev) =>
        prev ? { ...prev, replies: prev.replies.filter((r) => r.id !== comment.id) } : prev,
      );
    }
    refresh(client, ws);
    toast({ title: 'Comment deleted' });
    return true;
  } catch (error) {
    toast.error({ title: 'Failed to delete the comment', description: errorEnvelopeOf(error).message });
    return false;
  }
}

/** Adds the member's reaction, or removes it when they already reacted with that emoji. */
export async function toggleReaction(
  client: QueryClient,
  ws: WorkspaceRef,
  comment: Comment,
  emoji: string,
  memberId: string,
) {
  const group = comment.reactions.find((r) => r.emoji === emoji);
  const mine = group?.myReactionId ?? null;
  const reactionId = mine ?? newId();
  patchComment(client, ws.id, comment.id, (c) => {
    const groups = c.reactions.map((r) => ({ ...r, memberIds: [...r.memberIds] }));
    const g = groups.find((r) => r.emoji === emoji);
    if (mine && g) {
      g.count -= 1;
      g.memberIds = g.memberIds.filter((m) => m !== memberId);
      g.myReactionId = null;
      return { ...c, reactions: groups.filter((r) => r.count > 0) };
    }
    if (g) {
      g.count += 1;
      g.memberIds.push(memberId);
      g.myReactionId = reactionId;
      return { ...c, reactions: groups };
    }
    return { ...c, reactions: [...groups, { emoji, count: 1, memberIds: [memberId], myReactionId: reactionId }] };
  });
  try {
    const out = mine
      ? await api.comments.removeReaction.mutate({ commentId: comment.id, reactionId: mine }, inWorkspace(ws))
      : await api.comments.addReaction.mutate({ commentId: comment.id, reactionId, emoji }, inWorkspace(ws));
    noteAcceptAfter(ws.id, out.seq);
    patchComment(client, ws.id, comment.id, () => out.comment);
  } catch (error) {
    patchComment(client, ws.id, comment.id, () => comment);
    toast.error({ title: 'Failed to react', description: errorEnvelopeOf(error).message });
  } finally {
    refresh(client, ws);
  }
}
