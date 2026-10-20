// Synced email on the client (BACKLOG 7.03; F README §2.2–2.3): the record's threads (paged), one message, a thread
// and sharing grants. Reads are TanStack queries under the realtime resources of `emailKeys` (an `email-thread-list`
// or `email-grant-list` invalidation refetches them); writes answer the canonical item plus a change seq (the next
// reads are not served older than it) and refresh the affected prefixes.
import type { EmailAccess, GrantResource, GrantTarget, RecordRefInput, VisibilityLevel } from '@agentic-crm/contracts';
import { type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emailKeys } from '../../data/emailKeys';
import { keys } from '../../data/keys';
import {
  api,
  httpStatusOf,
  inWorkspace,
  noteAcceptAfter,
  type RouterOutputs,
  type WorkspaceRef,
} from '../../data/trpc';
import { useWorkspace } from '../shell/workspaceContext';

export type ThreadSummary = RouterOutputs['email']['threads']['threads'][number];
export type EmailMessage = RouterOutputs['email']['get'];
export type EmailThread = RouterOutputs['email']['thread'];
export type EmailGrant = RouterOutputs['email']['grants']['list'][number];

export function useWsRef(): WorkspaceRef {
  const { workspace } = useWorkspace();
  return { id: workspace.id, slug: workspace.slug };
}

const seqOf = (out: unknown): string | null => (out as { seq?: string | null } | null)?.seq ?? null;

async function settle(client: QueryClient, ws: WorkspaceRef, out: unknown): Promise<void> {
  noteAcceptAfter(ws.id, seqOf(out));
  await Promise.all([
    client.invalidateQueries({ queryKey: keys.resource(ws.id, 'email-grant-list') }),
    client.invalidateQueries({ queryKey: keys.resource(ws.id, 'email-thread-list') }),
  ]);
}

// ---- reads -----------------------------------------------------------------------------------------------------

export interface ThreadFilters {
  hasAttachments?: boolean;
}

export const THREADS_PAGE = 25;

/** The record's threads, newest first, paged by the server's cursor (the Emails tab). */
export function useRecordThreads(record: RecordRefInput, filters: ThreadFilters, enabled = true) {
  const ws = useWsRef();
  return useInfiniteQuery({
    queryKey: emailKeys.recordThreads(ws.id, record.entityInstanceId, { filters, paged: true }),
    queryFn: ({ pageParam }) =>
      api.email.threads.query(
        {
          record,
          limit: THREADS_PAGE,
          ...(pageParam ? { cursor: pageParam } : {}),
          ...(filters.hasAttachments ? { hasAttachments: true } : {}),
        },
        inWorkspace(ws),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** The first few threads and the total (Overview section: 3 rows; tab count: 1 row). */
export function useRecordThreadPreview(record: RecordRefInput, limit: number, enabled = true) {
  const ws = useWsRef();
  return useQuery({
    queryKey: emailKeys.recordThreads(ws.id, record.entityInstanceId, { limit }),
    queryFn: () => api.email.threads.query({ record, limit }, inWorkspace(ws)),
    enabled,
  });
}

/** One message (the email modal); a 404 (protected or unknown) is final. */
export function useEmailMessage(messageId: string) {
  const ws = useWsRef();
  return useQuery({
    queryKey: emailKeys.message(ws.id, messageId),
    queryFn: () => api.email.get.query({ messageId }, inWorkspace(ws)),
    retry: (count, error) => httpStatusOf(error) !== 404 && count < 2,
  });
}

/** Every message of a thread the viewer can see, oldest first. */
export function useEmailThread(threadId: string | undefined) {
  const ws = useWsRef();
  return useQuery({
    queryKey: emailKeys.thread(ws.id, threadId ?? ''),
    queryFn: () => api.email.thread.query({ threadId: threadId as string }, inWorkspace(ws)),
    enabled: Boolean(threadId),
    retry: (count, error) => httpStatusOf(error) !== 404 && count < 2,
  });
}

/** The caller's own grants of a resource (thread: "Share"; record: "Manage access"). */
export function useEmailGrants(resource: GrantResource, enabled = true) {
  const ws = useWsRef();
  return useQuery({
    queryKey: emailKeys.grants(ws.id, resource),
    queryFn: () => api.email.grants.list.query({ resource }, inWorkspace(ws)),
    enabled,
    // A viewer who owns no copy of a thread has nothing to list (404): treat as no grants, do not retry.
    retry: (count, error) => httpStatusOf(error) !== 404 && count < 2,
  });
}

// ---- writes ----------------------------------------------------------------------------------------------------

export function usePutGrant() {
  const ws = useWsRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { resource: GrantResource; target: GrantTarget; level?: VisibilityLevel }) => {
      const out = await api.email.grants.put.mutate(input, inWorkspace(ws));
      await settle(client, ws, out);
      return out.grant;
    },
  });
}

export function useRemoveGrant() {
  const ws = useWsRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (grantId: string) => {
      const out = await api.email.grants.remove.mutate({ grantId }, inWorkspace(ws));
      await settle(client, ws, out);
      return out;
    },
  });
}

/** The highest level among a thread's messages (the thread row's access). */
export function bestAccess(levels: readonly EmailAccess[]): EmailAccess {
  const rank: Record<EmailAccess, number> = { none: 0, 'metadata-only': 1, 'subject-line': 2, 'full-access': 3 };
  return levels.reduce<EmailAccess>((a, b) => (rank[b] > rank[a] ? b : a), 'none');
}
