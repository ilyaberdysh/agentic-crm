// Notifications on the client (BACKLOG 5.05–5.06;  "Procedures"): the inbox list (rows = groups, 25 per
// page), the unread badge, read / unread / archive writes and the preferences. Everything lives under
// ['ws', ws, 'notification'] / ['ws', ws, 'notification-preferences'], the realtime vocabulary, so a `notification`
// invalidation (a new row for me, or a read / archive from another tab) refetches the list and the count.
import type {
  ListNotificationsInput,
  NotificationGroup,
  NotificationPreferenceGroup,
  NotificationPreferences,
  NotificationUnreadCount,
} from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { keys } from '../../data/keys';
import { api, errorEnvelopeOf, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../data/trpc';
import { useWorkspace } from '../shell/workspaceContext';

export type InboxTab = 'notifications' | 'requests';

interface ListPage {
  items: NotificationGroup[];
  nextCursor: string | null;
}

const root = (ws: string) => keys.resource(ws, 'notification');
export const notificationKeys = {
  all: root,
  list: (ws: string, tab: InboxTab) => [...root(ws), 'list', tab] as const,
  unread: (ws: string) => [...root(ws), 'unread-count'] as const,
  preferences: (ws: string) => keys.resource(ws, 'notification-preferences'),
};

function useWs(): WorkspaceRef {
  const { workspace } = useWorkspace();
  return useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
}

// ---- unread badge ----------------------------------------------------------------------------------------------------

export function useUnreadCount() {
  const ws = useWs();
  return useQuery({
    queryKey: notificationKeys.unread(ws.id),
    queryFn: () => api.notifications.unreadCount.query(undefined, inWorkspace(ws)),
    staleTime: 60_000,
  });
}

/** "99+" from 100 (notifications). */
export function badgeLabel(count: number): string {
  return count >= 100 ? '99+' : String(count);
}

// ---- inbox list --------------------------------------------------------------------------------------------------------

const PAGE_SIZE = 25;

function paramsOf(tab: InboxTab): Omit<ListNotificationsInput, 'cursor'> {
  return tab === 'requests'
    ? { state: 'all', actionNeeded: true, limit: PAGE_SIZE }
    : { state: 'all', limit: PAGE_SIZE };
}

export function useInboxList(tab: InboxTab, enabled = true) {
  const ws = useWs();
  return useInfiniteQuery({
    queryKey: notificationKeys.list(ws.id, tab),
    queryFn: ({ pageParam }) =>
      api.notifications.list.query({ ...paramsOf(tab), ...(pageParam ? { cursor: pageParam } : {}) }, inWorkspace(ws)),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ListPage) => last.nextCursor,
    enabled,
    // Opening the inbox always fetches page one: a realtime invalidation that lands while a closed inbox's request is
    // still in flight is absorbed by that request (the inactive query takes its answer as fresh).
    refetchOnMount: 'always',
  });
}

// ---- writes (optimistic on the cached list and count; the realtime echo refetches) ------------------------------------------

type ListData = InfiniteData<ListPage, string | null>;

function patchGroups(
  client: QueryClient,
  ws: string,
  patch: (group: NotificationGroup) => NotificationGroup | null,
): void {
  client.setQueriesData<ListData>({ queryKey: [...root(ws), 'list'] }, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.flatMap((group) => {
              const next = patch(group);
              return next ? [next] : [];
            }),
          })),
        }
      : data,
  );
}

function adjustUnread(client: QueryClient, ws: string, delta: number): void {
  client.setQueryData<NotificationUnreadCount>(notificationKeys.unread(ws), (count) =>
    count ? { ...count, count: Math.max(0, count.count + delta) } : count,
  );
}

const markedRead = (group: NotificationGroup): NotificationGroup => ({
  ...group,
  isRead: true,
  unreadCount: 0,
  entries: group.entries.map((e) => ({ ...e, readAt: e.readAt ?? new Date().toISOString() })),
});

/** Opening a row marks it read (notifications, acceptance 4). */
export function useMarkRead() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.notifications.markRead.mutate({ ids }, inWorkspace(ws)),
    onMutate: (ids) => {
      const wanted = new Set(ids);
      let flipped = 0;
      patchGroups(client, ws.id, (group) => {
        if (!wanted.has(group.id) || group.isRead) return group;
        flipped += 1;
        return markedRead(group);
      });
      if (flipped > 0) adjustUnread(client, ws.id, -flipped);
    },
    onSuccess: (out) => {
      noteAcceptAfter(ws.id, out.seq);
      void client.invalidateQueries({ queryKey: notificationKeys.all(ws.id) });
    },
    onError: (error) => {
      toast.error({ title: 'Unable to mark notifications as read', description: errorEnvelopeOf(error).message });
      void client.invalidateQueries({ queryKey: notificationKeys.all(ws.id) });
    },
  });
}

export function useMarkAllRead() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.notifications.markRead.mutate({ all: true }, inWorkspace(ws)),
    onMutate: () => {
      patchGroups(client, ws.id, (group) => (group.isRead ? group : markedRead(group)));
      client.setQueryData<NotificationUnreadCount>(notificationKeys.unread(ws.id), (count) =>
        count ? { ...count, count: 0, byTopic: {} as NotificationUnreadCount['byTopic'] } : count,
      );
    },
    onSuccess: (out) => {
      noteAcceptAfter(ws.id, out.seq);
      void client.invalidateQueries({ queryKey: notificationKeys.all(ws.id) });
    },
    onError: (error) => {
      toast.error({ title: 'Unable to mark notifications as read', description: errorEnvelopeOf(error).message });
      void client.invalidateQueries({ queryKey: notificationKeys.all(ws.id) });
    },
  });
}

export function useMarkUnread() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.notifications.markUnread.mutate({ ids }, inWorkspace(ws)),
    onSuccess: (out) => {
      noteAcceptAfter(ws.id, out.seq);
      void client.invalidateQueries({ queryKey: notificationKeys.all(ws.id) });
    },
    onError: (error) => {
      toast.error({ title: 'Unable to mark the notification as unread', description: errorEnvelopeOf(error).message });
    },
  });
}

export function useArchive() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.notifications.archive.mutate({ ids }, inWorkspace(ws)),
    onMutate: (ids) => {
      const wanted = new Set(ids);
      let unreadRemoved = 0;
      patchGroups(client, ws.id, (group) => {
        if (!wanted.has(group.id)) return group;
        if (!group.isRead) unreadRemoved += 1;
        return null;
      });
      if (unreadRemoved > 0) adjustUnread(client, ws.id, -unreadRemoved);
    },
    onSuccess: (out) => {
      noteAcceptAfter(ws.id, out.seq);
      void client.invalidateQueries({ queryKey: notificationKeys.all(ws.id) });
    },
    onError: (error) => {
      toast.error({ title: 'Unable to archive the notification', description: errorEnvelopeOf(error).message });
      void client.invalidateQueries({ queryKey: notificationKeys.all(ws.id) });
    },
  });
}

// ---- preferences (Settings → Notifications) -----------------------------------------------------------------------------

export function useNotificationPreferences() {
  const ws = useWs();
  return useQuery({
    queryKey: notificationKeys.preferences(ws.id),
    queryFn: () => api.notifications.preferences.get.query(undefined, inWorkspace(ws)),
  });
}

/** One toggle saves at once (optimistic); a failure reverts and toasts "Failed to update notification preferences". */
export function useUpdatePreference() {
  const ws = useWs();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { group: NotificationPreferenceGroup; channel: 'in-app' | 'email'; enabled: boolean }) =>
      api.notifications.preferences.update.mutate(input, inWorkspace(ws)),
    onMutate: async (input) => {
      const key = notificationKeys.preferences(ws.id);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<NotificationPreferences>(key);
      client.setQueryData<NotificationPreferences>(key, (prefs) =>
        prefs
          ? {
              groups: prefs.groups.map((g) =>
                g.group === input.group
                  ? {
                      ...g,
                      channels: g.channels.map((c) =>
                        c.channel === input.channel ? { ...c, enabled: input.enabled } : c,
                      ),
                    }
                  : g,
              ),
            }
          : prefs,
      );
      return { previous };
    },
    onSuccess: (out) => {
      noteAcceptAfter(ws.id, out.seq);
    },
    onError: (_error, _input, context) => {
      if (context?.previous) client.setQueryData(notificationKeys.preferences(ws.id), context.previous);
      toast.error({ title: 'Failed to update notification preferences' });
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: notificationKeys.preferences(ws.id) });
    },
  });
}
