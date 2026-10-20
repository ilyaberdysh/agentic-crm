// Record page reads and writes (BACKLOG 3.01–3.11): object by route slug, page layout (E: layouts.get/save), record
// state (live / merged / deleted / not found), tab counters, the activity timeline (contract E2), files (E5),
// favorites and member preferences. Keys live under ['ws', ws, <invalidation resource>, …] (data/keys.ts) so realtime
// invalidations of those resources refresh them (data/realtime/invalidation.ts).
import type {
  CustomLayout,
  EntityDefinition,
  ListTimelineInput,
  ListTimelineOutput,
  SaveLayoutInput,
} from '@agentic-crm/contracts';
import { queryOptions, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { keys } from '../../data/keys';
import { useObjects } from '../../data/objects';
import { queryClient } from '../../data/queryClient';
import { markCovered } from '../../data/realtime/invalidation';
import { api, inWorkspace, noteAcceptAfter, type RouterOutputs, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useWorkspace } from '../shell/workspaceContext';

export type RecordState = RouterOutputs['recordPage']['state'];
export type RelatedCounts = RouterOutputs['recordPage']['relatedCounts']['counts'][string];
/** Wire values carry `value: unknown`; the contract type is the same shape. */
export type TimelinePage = ListTimelineOutput;
export type StorageEntry = RouterOutputs['files']['list']['entries'][number];
export type MemberPreferences = RouterOutputs['preferences']['get'];
export type NoteHeader = RouterOutputs['notes']['list']['notes'][number];
export type TaskRow = RouterOutputs['tasks']['list']['groups'][number]['tasks'][number];

export interface RecordKey {
  entityDefinitionId: string;
  entityInstanceId: string;
}

export const recordKeys = {
  layout: (ws: string, def: string) => keys.customLayout(ws, def),
  state: (ws: string, def: string, id: string) => [...keys.record(ws, def, id), 'state'] as const,
  timeline: (ws: string, def: string, id: string) => keys.recordTimeline(ws, def, id),
  /** Tab badges and merge-card counters: every child write emits `record-timeline` for the record. */
  counts: (ws: string, def: string, id: string) => [...keys.recordTimeline(ws, def, id), 'counts'] as const,
  notes: (ws: string, def: string, id: string) => [...keys.recordTimeline(ws, def, id), 'notes'] as const,
  tasks: (ws: string, def: string, id: string) => [...keys.recordTimeline(ws, def, id), 'tasks'] as const,
  files: (ws: string, def: string, id: string, folder: string | null) =>
    [...keys.storageEntries(ws, def, id), folder ?? 'root'] as const,
  preferences: (ws: string) => keys.memberPreferences(ws),
};

// ---- objects ------------------------------------------------------------------------------------------------------

/** The object of a record route (`companies`, `people`, a standard object or a custom object's api slug). */
export function useObjectBySlug(apiSlug: string): { object: EntityDefinition | undefined; isPending: boolean } {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace);
  const object = objects.data?.find((o) => o.apiSlug === apiSlug) as EntityDefinition | undefined;
  return { object, isPending: objects.isPending };
}

// ---- layout -------------------------------------------------------------------------------------------------------

export const layoutQuery = (ws: WorkspaceRef, entityDefinitionId: string) =>
  queryOptions({
    queryKey: recordKeys.layout(ws.id, entityDefinitionId),
    queryFn: () => api.layouts.get.query({ entityDefinitionId }, inWorkspace(ws)) as Promise<CustomLayout>,
    staleTime: 60_000,
  });

export function useLayout(entityDefinitionId: string | undefined) {
  const { workspace } = useWorkspace();
  return useQuery({ ...layoutQuery(workspace, entityDefinitionId ?? ''), enabled: Boolean(entityDefinitionId) });
}

export async function saveLayout(ws: WorkspaceRef, input: SaveLayoutInput): Promise<CustomLayout> {
  const { layout, seq } = await api.layouts.save.mutate(input, inWorkspace(ws));
  noteAcceptAfter(ws.id, seq);
  const key = recordKeys.layout(ws.id, layout.entityDefinitionId);
  queryClient.setQueryData(key, layout);
  markCovered(key, seq);
  return layout as CustomLayout;
}

// ---- record state and counters ------------------------------------------------------------------------------------

export function useRecordState(key: RecordKey | null) {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: recordKeys.state(workspace.id, key?.entityDefinitionId ?? '', key?.entityInstanceId ?? ''),
    queryFn: () => api.recordPage.state.query(key as RecordKey, inWorkspace(workspace)),
    enabled: Boolean(key?.entityDefinitionId && key.entityInstanceId),
  });
}

export function useRelatedCounts(key: RecordKey) {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: recordKeys.counts(workspace.id, key.entityDefinitionId, key.entityInstanceId),
    queryFn: async () => {
      const { counts } = await api.recordPage.relatedCounts.query(
        { entityDefinitionId: key.entityDefinitionId, entityInstanceIds: [key.entityInstanceId] },
        inWorkspace(workspace),
      );
      return counts[key.entityInstanceId] ?? null;
    },
  });
}

// ---- timeline (contract E2) ----------------------------------------------------------------------------------------

type TimelineParams = Pick<ListTimelineInput, 'filters' | 'disableGrouping' | 'limit'>;

/** Past events, newest first, paging backwards from now (100 per page, grouped). */
export function usePastTimeline(key: RecordKey, params: TimelineParams, enabled = true) {
  const { workspace } = useWorkspace();
  return useInfiniteQuery({
    queryKey: [
      ...recordKeys.timeline(workspace.id, key.entityDefinitionId, key.entityInstanceId),
      'past',
      params,
    ] as const,
    queryFn: ({ pageParam }) =>
      api.timeline.list.query(
        { ...key, ...params, mode: 'past', ...(pageParam ? { before: pageParam } : {}) },
        inWorkspace(workspace),
      ) as Promise<TimelinePage>,
    initialPageParam: null as string | null,
    getNextPageParam: (last: TimelinePage) => last.nextBefore,
    enabled,
  });
}

/** Upcoming events (tasks due, scheduled meetings), soonest first, 3 per page ("Show more upcoming events"). */
export function useUpcomingTimeline(key: RecordKey, params: Pick<ListTimelineInput, 'filters'>, enabled = true) {
  const { workspace } = useWorkspace();
  return useInfiniteQuery({
    queryKey: [
      ...recordKeys.timeline(workspace.id, key.entityDefinitionId, key.entityInstanceId),
      'upcoming',
      params,
    ] as const,
    queryFn: ({ pageParam }) =>
      api.timeline.list.query(
        { ...key, ...params, mode: 'upcoming', limit: 3, ...(pageParam ? { after: pageParam } : {}) },
        inWorkspace(workspace),
      ) as Promise<TimelinePage>,
    initialPageParam: null as string | null,
    getNextPageParam: (last: TimelinePage) => last.nextAfter,
    enabled,
  });
}

/** After our own writes that the timeline derives events from (values, merges): refetch now. */
export function invalidateTimeline(ws: WorkspaceRef, key: RecordKey): void {
  void queryClient.invalidateQueries({
    queryKey: recordKeys.timeline(ws.id, key.entityDefinitionId, key.entityInstanceId),
  });
}

// ---- notes and tasks of the record (Overview sections) ----------------------------------------------------------

export function useRecordNotes(key: RecordKey, limit = 3) {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: [...recordKeys.notes(workspace.id, key.entityDefinitionId, key.entityInstanceId), limit],
    queryFn: () =>
      api.notes.list.query(
        { record: key, limit, includeContent: true, sort: 'created_at:desc' },
        inWorkspace(workspace),
      ),
  });
}

export function useRecordOpenTasks(key: RecordKey) {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: [...recordKeys.tasks(workspace.id, key.entityDefinitionId, key.entityInstanceId), 'open'],
    queryFn: async () => {
      const out = await api.tasks.list.query(
        {
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          groupBy: 'none',
          showCompleted: false,
          sort: { field: 'deadline', direction: 'asc' },
          filter: { records: { operator: 'is', records: [key] } },
          limit: 200,
        },
        inWorkspace(workspace),
      );
      return { tasks: out.groups.flatMap((g) => g.tasks), total: out.total };
    },
  });
}

// ---- preferences --------------------------------------------------------------------------------------------------

export function useWeekStart(): number {
  const { workspace } = useWorkspace();
  const q = useQuery({
    queryKey: recordKeys.preferences(workspace.id),
    queryFn: () => api.preferences.get.query(undefined, inWorkspace(workspace)),
    staleTime: 5 * 60_000,
  });
  return q.data?.effectiveWeekStartDay ?? 1;
}
