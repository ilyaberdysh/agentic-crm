// Calls on the client: the Calls list (infinite, grouped by the server), one call
// (detail, transcript, speakers, insights), the Calls of a record and of meetings, insight templates (list, detail,
// presets, previews, sections) and the member's default template. Reads are TanStack queries under the realtime
// resources in the query keys module; writes answer with canonical state and a change sequence, update the cache and refresh the
// lists they affect (X-27: a call imported through /v2 shows up without a reload because the server invalidates
// `call-recording-list`).
import type { ListCallsInput } from '@agentic-crm/contracts';
import { type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { keys } from '../../data/keys';
import {
  api,
  httpStatusOf,
  inWorkspace,
  noteAcceptAfter,
  type RouterOutputs,
  type WorkspaceRef,
} from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useWorkspace } from '../shell/workspaceContext';
import { callKeys } from './keys';

export type CallListItem = RouterOutputs['calls']['list']['items'][number];
export type CallList = RouterOutputs['calls']['list'];
export type CallDetail = RouterOutputs['calls']['get'];
export type CallTranscript = RouterOutputs['calls']['transcript'];
export type CallSpeakerStat = RouterOutputs['calls']['speakers'][number];
export type CallInsight = RouterOutputs['calls']['insights']['list'][number];
export type InsightTemplate = RouterOutputs['insightTemplates']['list'][number];
export type InsightTemplateDetail = RouterOutputs['insightTemplates']['get'];
export type InsightPreset = RouterOutputs['insightTemplates']['presets'][number];
export type TemplateSection = NonNullable<InsightTemplateDetail['draft']>['sections'][number];
export type TemplatePreview = InsightTemplateDetail['previews'][number];

export function useWsRef(): WorkspaceRef {
  const { workspace } = useWorkspace();
  return useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
}

const retry = (count: number, error: unknown) => httpStatusOf(error) !== 404 && count < 2;
const seqOf = (out: unknown): string | null => (out as { seq?: string | null } | null)?.seq ?? null;

// ---- the Calls list ------------------------------------------------------------------------------------------------

export type CallsListParams = Omit<ListCallsInput, 'acceptAfter' | 'cursor'>;

const PAGE = 100;

/**
 * The Calls list: pages of rows (`calls.list` cursor), the date groups and total of the first page, and the favourites
 * strip (the server answers it only without filters and query).
 */
export function useCallsList(params: CallsListParams, enabled = true) {
  const ws = useWsRef();
  const query = useInfiniteQuery({
    queryKey: callKeys.list(ws.id, params),
    queryFn: ({ pageParam }) =>
      api.calls.list.query({ limit: PAGE, ...params, ...(pageParam ? { cursor: pageParam } : {}) }, inWorkspace(ws)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: (prev) => prev,
    enabled,
  });
  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const data = useMemo(
    () =>
      first
        ? {
            items: pages.flatMap((p) => p.items),
            groups: first.groups,
            total: first.total,
            favorites: first.favorites,
          }
        : undefined,
    [pages.length, first],
  );
  return { ...query, data };
}

/** The number of calls (the tab badge): the unfiltered list, one row. */
export function useCallsTotal() {
  const ws = useWsRef();
  return useQuery({
    queryKey: callKeys.list(ws.id, { count: true }),
    queryFn: () => api.calls.list.query({ limit: 1, groupBy: 'none' }, inWorkspace(ws)),
    select: (out) => out.total,
  });
}

/** Calls of a record (company / person / any): the meeting's linked records and participants' people / companies. */
export function useRecordCalls(record: { entityDefinitionId: string; entityInstanceId: string }, limit = 50) {
  const ws = useWsRef();
  return useQuery({
    queryKey: callKeys.recordCalls(ws.id, record.entityInstanceId, { limit }),
    queryFn: () =>
      api.calls.list.query(
        {
          filters: [{ field: 'record', mode: 'must', operator: 'eq', value: record }],
          groupBy: 'none',
          limit,
        },
        inWorkspace(ws),
      ),
  });
}

/** Call cards of meetings (the activity meeting card); meetings without a call are simply absent. */
export function useCallsByMeetings(meetingIds: readonly string[]) {
  const ws = useWsRef();
  const ids = useMemo(() => [...new Set(meetingIds)].sort(), [meetingIds.join(',')]);
  const query = useQuery({
    queryKey: callKeys.byMeetings(ws.id, ids),
    queryFn: () => api.calls.byMeetings.query({ meetingIds: ids }, inWorkspace(ws)),
    enabled: ids.length > 0,
  });
  return useMemo(() => new Map((query.data ?? []).map((c) => [c.meetingId, c])), [query.data]);
}

// ---- one call --------------------------------------------------------------------------------------------------------

/** A call and everything the page header and the summary column need; a 404 (none, or not visible) is final. */
export function useCall(recordingId: string) {
  const ws = useWsRef();
  return useQuery({
    queryKey: callKeys.call(ws.id, recordingId),
    queryFn: () => api.calls.get.query({ recordingId }, inWorkspace(ws)),
    retry,
    // Summaries are written by the worker after the import: poll as a safety net until they are there.
    refetchInterval: (q) => (q.state.data && q.state.data.status === 'processing' ? 3000 : false),
  });
}

export function useTranscript(recordingId: string, enabled = true) {
  const ws = useWsRef();
  return useQuery({
    queryKey: callKeys.transcript(ws.id, recordingId),
    queryFn: () => api.calls.transcript.query({ recordingId }, inWorkspace(ws)),
    retry,
    enabled,
  });
}

export function useSpeakerStats(recordingId: string, enabled = true) {
  const ws = useWsRef();
  return useQuery({
    queryKey: callKeys.speakers(ws.id, recordingId),
    queryFn: () => api.calls.speakers.query({ recordingId }, inWorkspace(ws)),
    retry,
    enabled,
  });
}

export function useInsights(recordingId: string, enabled = true) {
  const ws = useWsRef();
  return useQuery({
    queryKey: callKeys.insights(ws.id, recordingId),
    queryFn: () => api.calls.insights.list.query({ recordingId }, inWorkspace(ws)),
    enabled,
    // Insights take a minute: refresh while one is generating even if a realtime message is missed.
    refetchInterval: (q) =>
      q.state.data?.some((i) => i.status === 'queued' || i.status === 'executing') ? 3000 : false,
  });
}

function refreshLists(client: QueryClient, ws: WorkspaceRef) {
  return client.invalidateQueries({ queryKey: callKeys.lists(ws.id) });
}

export function useDeleteCall() {
  const ws = useWsRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (recordingId: string) => {
      const out = await api.calls.delete.mutate({ recordingId }, inWorkspace(ws));
      noteAcceptAfter(ws.id, seqOf(out));
      client.removeQueries({ queryKey: callKeys.call(ws.id, recordingId) });
      await refreshLists(client, ws);
      return out;
    },
  });
}

/** "Choose template" / "Update": a new insight from the template's latest published version (idempotent by id). */
export function useGenerateInsight(recordingId: string) {
  const ws = useWsRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { templateId: string; insightId?: string }) => {
      const out = await api.calls.insights.generate.mutate(
        { recordingId, templateId: input.templateId, insightId: input.insightId ?? newId() },
        inWorkspace(ws),
      );
      noteAcceptAfter(ws.id, seqOf(out));
      await client.invalidateQueries({ queryKey: callKeys.insights(ws.id, recordingId) });
      return out.insight;
    },
  });
}

// ---- member settings -----------------------------------------------------------------------------------------------------

export function useCallSettings() {
  const ws = useWsRef();
  return useQuery({
    queryKey: callKeys.settings(ws.id),
    queryFn: () => api.calls.settings.get.query({}, inWorkspace(ws)),
  });
}

export function useUpdateCallSettings() {
  const ws = useWsRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (defaultInsightTemplateId: string | null) => {
      const out = await api.calls.settings.update.mutate({ defaultInsightTemplateId }, inWorkspace(ws));
      noteAcceptAfter(ws.id, seqOf(out));
      client.setQueryData(callKeys.settings(ws.id), out.settings);
      return out.settings;
    },
    // The call page pre-selects the default template: refresh the open calls.
    onSuccess: () => client.invalidateQueries({ queryKey: ['ws', ws.id, 'call-recording'] }),
  });
}

// ---- insight templates ---------------------------------------------------------------------------------------------------

/** The templates index (non-transient). `enabledOnly`: the insight picker and the default-template select. */
export function useInsightTemplates(options: { enabledOnly?: boolean } = {}, enabled = true) {
  const ws = useWsRef();
  const enabledOnly = options.enabledOnly ?? false;
  return useQuery({
    queryKey: callKeys.templates(ws.id, { enabledOnly }),
    queryFn: () => api.insightTemplates.list.query({ enabledOnly }, inWorkspace(ws)),
    enabled,
  });
}

export function useInsightTemplate(templateId: string) {
  const ws = useWsRef();
  return useQuery({
    queryKey: callKeys.template(ws.id, templateId),
    queryFn: () => api.insightTemplates.get.query({ templateId }, inWorkspace(ws)),
    retry,
    // A preview that is generating refreshes even if a realtime message is missed.
    refetchInterval: (q) =>
      q.state.data?.previews.some((p) => p.status === 'queued' || p.status === 'executing') ? 2500 : false,
  });
}

export function useTemplatePresets() {
  const ws = useWsRef();
  return useQuery({
    queryKey: callKeys.presets(ws.id),
    queryFn: () => api.insightTemplates.presets.query({}, inWorkspace(ws)),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

async function settleTemplate(
  client: QueryClient,
  ws: WorkspaceRef,
  out: { template?: InsightTemplateDetail; seq?: string | null },
  options: { list?: boolean } = {},
) {
  noteAcceptAfter(ws.id, seqOf(out));
  if (out.template) client.setQueryData(callKeys.template(ws.id, out.template.id), out.template);
  if (options.list !== false)
    await client.invalidateQueries({ queryKey: keys.resource(ws.id, 'insight-template-list') });
}

/** One generic template write: runs the procedure, writes the canonical template into the cache. */
function useTemplateWrite<Input>(
  run: (input: Input, ws: WorkspaceRef) => Promise<{ template?: InsightTemplateDetail; seq?: string | null }>,
  options: { list?: boolean } = {},
) {
  const ws = useWsRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: Input) => {
      const out = await run(input, ws);
      await settleTemplate(client, ws, out, options);
      return out;
    },
  });
}

export const useCreateTemplate = () =>
  useTemplateWrite((input: { id: string; presetId?: string; title?: string | null }, ws) =>
    api.insightTemplates.create.mutate(input, inWorkspace(ws)),
  );

export const useUpdateTemplate = () =>
  useTemplateWrite((input: { templateId: string; title?: string | null; archived?: boolean }, ws) =>
    api.insightTemplates.update.mutate(input, inWorkspace(ws)),
  );

export const useDuplicateTemplate = () =>
  useTemplateWrite((input: { templateId: string; newTemplateId: string }, ws) =>
    api.insightTemplates.duplicate.mutate(input, inWorkspace(ws)),
  );

export const usePublishTemplate = () =>
  useTemplateWrite((input: { templateId: string }, ws) => api.insightTemplates.publish.mutate(input, inWorkspace(ws)));

export const useDiscardTemplate = () =>
  useTemplateWrite((input: { templateId: string }, ws) => api.insightTemplates.discard.mutate(input, inWorkspace(ws)));

export const useApplyPreset = () =>
  useTemplateWrite((input: { templateId: string; presetId: string }, ws) =>
    api.insightTemplates.applyPreset.mutate(input, inWorkspace(ws)),
  );

export function useDeleteTemplate() {
  const ws = useWsRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (templateId: string) => {
      const out = await api.insightTemplates.delete.mutate({ templateId }, inWorkspace(ws));
      noteAcceptAfter(ws.id, seqOf(out));
      client.removeQueries({ queryKey: callKeys.template(ws.id, templateId) });
      await client.invalidateQueries({ queryKey: keys.resource(ws.id, 'insight-template-list') });
      return out;
    },
  });
}

/** "Generate preview": the draft against a call; the preview appears on the template (queued → completed). */
export function useGeneratePreview() {
  const ws = useWsRef();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { templateId: string; recordingId: string; previewId?: string }) => {
      const out = await api.insightTemplates.preview.mutate(
        { templateId: input.templateId, recordingId: input.recordingId, previewId: input.previewId ?? newId() },
        inWorkspace(ws),
      );
      noteAcceptAfter(ws.id, seqOf(out));
      await client.invalidateQueries({ queryKey: callKeys.template(ws.id, input.templateId) });
      return out.preview;
    },
  });
}

export const useCreateSection = () =>
  useTemplateWrite(
    (
      input: { templateId: string; sectionId: string; type?: 'plaintext' | 'list'; title?: string; prompt?: string },
      ws,
    ) => api.insightTemplates.sections.create.mutate(input, inWorkspace(ws)),
  );

export const useUpdateSection = () =>
  useTemplateWrite((input: { sectionId: string; type?: 'plaintext' | 'list'; sortOrder?: string }, ws) =>
    api.insightTemplates.sections.update.mutate(input, inWorkspace(ws)),
  );

export const useDeleteSection = () =>
  useTemplateWrite((input: { sectionId: string }, ws) =>
    api.insightTemplates.sections.delete.mutate(input, inWorkspace(ws)),
  );

export const useDuplicateSection = () =>
  useTemplateWrite((input: { sectionId: string; newSectionId: string }, ws) =>
    api.insightTemplates.sections.duplicate.mutate(input, inWorkspace(ws)),
  );

export const useMoveSection = () =>
  useTemplateWrite((input: { sectionId: string; direction: 'up' | 'down' }, ws) =>
    api.insightTemplates.sections.move.mutate(input, inWorkspace(ws)),
  );

/** The incomplete-template issues of a refused publish / preview (`TEMPLATE_INCOMPLETE`). */
export function incompleteIssues(
  error: unknown,
): Array<{ sectionId: string; section: number; missing: string[] }> | null {
  const shape = (error as { shape?: { additional_information?: { code?: string; issues?: unknown } } } | null)?.shape;
  const info = shape?.additional_information;
  if (info?.code !== 'TEMPLATE_INCOMPLETE') return null;
  return Array.isArray(info.issues)
    ? (info.issues as Array<{ sectionId: string; section: number; missing: string[] }>)
    : [];
}

export { retry as retryUnless404 };
