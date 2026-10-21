// Ask AI on the client: tRPC queries and mutations for threads, models, settings, prompts, credits and record
// summaries. Keys live under the realtime resources (`ai-thread`, `ai-thread-list`, `ai-prompt(-list)`,
// `ai-settings`, `credit-usage`, `record-ai-summary`), so a `change_log` invalidation maps onto them with no lookup
// table (data/realtime/invalidation.ts). Answers stream separately (stream/live.ts).
import type {
  AiThreadDetail,
  CreatePromptInput,
  CreditsUsage,
  ListPromptsInput,
  SharePromptInput,
  UpdateAiMemberSettingsInput,
  UpdateAiWorkspaceSettingsInput,
  UpdatePromptInput,
} from '@agentic-crm/contracts';
import { type QueryClient, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { keys } from '../../data/keys';
import { api, inWorkspace, noteAcceptAfter, type RouterOutputs, type WorkspaceRef } from '../../data/trpc';
import { useWorkspaceRef } from '../notes/data';

export type AiThreadList = RouterOutputs['ai']['threads']['list'];
export type AiThreadSummary = AiThreadList['threads'][number];
/** The router infers `input?: unknown` for tool parts; the contracts type (required key) is what the UI uses. */
export type AiThreadDetailData = AiThreadDetail;
export type AiModels = RouterOutputs['ai']['models']['list'];
export type AiMemberSettingsData = RouterOutputs['ai']['settings']['get'];
export type AiWorkspaceSettingsData = RouterOutputs['ai']['workspaceSettings']['get'];
export type PromptList = RouterOutputs['prompts']['list'];
export type PromptItem = PromptList['prompts'][number];

export const askKeys = {
  threads: (ws: string, params: { query?: string; sort?: string } = {}) =>
    [...keys.resource(ws, 'ai-thread-list'), params] as const,
  thread: (ws: string, threadId: string) => [...keys.resource(ws, 'ai-thread'), threadId] as const,
  threadsAll: (ws: string) => keys.resource(ws, 'ai-thread-list'),
  threadAll: (ws: string) => keys.resource(ws, 'ai-thread'),
  suggestions: (ws: string, turnId: string) => [...keys.resource(ws, 'ai-turn'), 'suggestions', turnId] as const,
  models: (ws: string) => [...keys.resource(ws, 'ai-settings'), 'models'] as const,
  settings: (ws: string) => [...keys.resource(ws, 'ai-settings'), 'member'] as const,
  workspaceSettings: (ws: string) => [...keys.resource(ws, 'ai-settings'), 'workspace'] as const,
  prompts: (ws: string, params: ListPromptsInput = undefined) =>
    [...keys.resource(ws, 'ai-prompt-list'), params ?? {}] as const,
  prompt: (ws: string, id: string) => [...keys.resource(ws, 'ai-prompt'), id] as const,
  sharing: (ws: string, id: string) => [...keys.resource(ws, 'ai-prompt'), 'sharing', id] as const,
  usage: (ws: string, period: string) => [...keys.resource(ws, 'credit-usage'), 'usage', period] as const,
  ledger: (ws: string) => [...keys.resource(ws, 'credit-usage'), 'ledger'] as const,
  summary: (ws: string, defId: string, id: string) => [...keys.resource(ws, 'record-ai-summary'), defId, id] as const,
};

/** Notes the change seq of a mutation (I4a): reads after a write never serve older data. */
export async function written<T extends { seq?: string | null }>(ws: WorkspaceRef, call: Promise<T>): Promise<T> {
  const result = await call;
  noteAcceptAfter(ws.id, result.seq);
  return result;
}

// ---- threads -------------------------------------------------------------------------------------------------------------------

export const threadsQuery = (ws: WorkspaceRef, params: { query?: string; sort?: 'updated' | 'created' } = {}) =>
  queryOptions({
    queryKey: askKeys.threads(ws.id, params),
    queryFn: () => api.ai.threads.list.query({ ...params, limit: 100 }, inWorkspace(ws)),
  });

export function useThreads(params: { query?: string; sort?: 'updated' | 'created' } = {}, enabled = true) {
  const ws = useWorkspaceRef();
  return useQuery({ ...threadsQuery(ws, params), enabled, placeholderData: (prev) => prev });
}

export const threadQuery = (ws: WorkspaceRef, threadId: string) =>
  queryOptions({
    queryKey: askKeys.thread(ws.id, threadId),
    queryFn: async () =>
      (await api.ai.threads.get.query({ threadId }, inWorkspace(ws))) as unknown as AiThreadDetailData,
    retry: (count, error) => count < 2 && !/not found|404/i.test(String((error as Error)?.message)),
  });

export function useThread(threadId: string | null) {
  const ws = useWorkspaceRef();
  return useQuery({ ...threadQuery(ws, threadId ?? ''), enabled: Boolean(threadId) });
}

export async function renameThread(ws: WorkspaceRef, threadId: string, title: string | null): Promise<void> {
  await written(ws, api.ai.threads.rename.mutate({ threadId, title }, inWorkspace(ws)));
}

export async function deleteThread(client: QueryClient, ws: WorkspaceRef, threadId: string): Promise<void> {
  await written(ws, api.ai.threads.delete.mutate({ threadId }, inWorkspace(ws)));
  client.removeQueries({ queryKey: askKeys.thread(ws.id, threadId) });
  await client.invalidateQueries({ queryKey: askKeys.threadsAll(ws.id) });
}

/** The title a thread shows (`title ?? aiTitle ?? "Untitled chat"`). */
export function threadTitle(thread: { title: string | null; aiTitle: string | null } | undefined | null): string {
  return thread?.title?.trim() || thread?.aiTitle?.trim() || 'Untitled chat';
}

// ---- models, settings --------------------------------------------------------------------------------------------------

export const modelsQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: askKeys.models(ws.id),
    queryFn: () => api.ai.models.list.query({}, inWorkspace(ws)),
    staleTime: 60_000,
  });

export function useModels() {
  const ws = useWorkspaceRef();
  return useQuery(modelsQuery(ws));
}

export function useAiSettings() {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: askKeys.settings(ws.id),
    queryFn: () => api.ai.settings.get.query({}, inWorkspace(ws)),
  });
}

export function useAiWorkspaceSettings(enabled = true) {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: askKeys.workspaceSettings(ws.id),
    queryFn: () => api.ai.workspaceSettings.get.query({}, inWorkspace(ws)),
    enabled,
  });
}

export async function updateAiSettings(client: QueryClient, ws: WorkspaceRef, patch: UpdateAiMemberSettingsInput) {
  const { settings, seq } = await api.ai.settings.update.mutate(patch, inWorkspace(ws));
  noteAcceptAfter(ws.id, seq);
  client.setQueryData(askKeys.settings(ws.id), settings);
  return settings;
}

export async function updateAiWorkspaceSettings(
  client: QueryClient,
  ws: WorkspaceRef,
  patch: UpdateAiWorkspaceSettingsInput,
) {
  const { settings, seq } = await api.ai.workspaceSettings.update.mutate(patch, inWorkspace(ws));
  noteAcceptAfter(ws.id, seq);
  client.setQueryData(askKeys.workspaceSettings(ws.id), settings);
  return settings;
}

// ---- credits ---------------------------------------------------------------------------------------------------------------------

export function useCreditsUsage(period: 'current' | 'previous' = 'current') {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: askKeys.usage(ws.id, period),
    queryFn: () => api.credits.usage.query({ period }, inWorkspace(ws)),
  });
}

/** Formats thousands with a thin non-breaking space, for example `1 000`. */
export function formatCredits(n: number): string {
  return n.toLocaleString('en-US').replace(/,/g, ' ');
}

export type { CreditsUsage };

// ---- prompts ---------------------------------------------------------------------------------------------------------------------

export function usePrompts(params: ListPromptsInput = { scope: 'mine' }, enabled = true) {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: askKeys.prompts(ws.id, params),
    queryFn: () => api.prompts.list.query(params, inWorkspace(ws)),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function usePrompt(promptId: string | null) {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: askKeys.prompt(ws.id, promptId ?? ''),
    queryFn: () => api.prompts.get.query({ promptId: promptId as string }, inWorkspace(ws)),
    enabled: Boolean(promptId),
  });
}

export function usePromptSharing(promptId: string | null) {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: askKeys.sharing(ws.id, promptId ?? ''),
    queryFn: () => api.prompts.sharing.query({ promptId: promptId as string }, inWorkspace(ws)),
    enabled: Boolean(promptId),
  });
}

export const promptTitle = (p: Pick<PromptItem, 'title' | 'aiTitle'>): string =>
  p.title?.trim() || p.aiTitle?.trim() || 'Untitled prompt';

export async function createPrompt(client: QueryClient, ws: WorkspaceRef, input: CreatePromptInput) {
  const { prompt, seq } = await api.prompts.create.mutate(input, inWorkspace(ws));
  noteAcceptAfter(ws.id, seq);
  await client.invalidateQueries({ queryKey: keys.resource(ws.id, 'ai-prompt-list') });
  return prompt;
}

export async function updatePrompt(client: QueryClient, ws: WorkspaceRef, input: UpdatePromptInput) {
  const { prompt, seq } = await api.prompts.update.mutate(input, inWorkspace(ws));
  noteAcceptAfter(ws.id, seq);
  client.setQueryData(askKeys.prompt(ws.id, prompt.id), prompt);
  await client.invalidateQueries({ queryKey: keys.resource(ws.id, 'ai-prompt-list') });
  return prompt;
}

export async function deletePrompt(client: QueryClient, ws: WorkspaceRef, promptId: string) {
  await written(ws, api.prompts.delete.mutate({ promptId }, inWorkspace(ws)));
  await client.invalidateQueries({ queryKey: keys.resource(ws.id, 'ai-prompt-list') });
}

export async function savePrompt(client: QueryClient, ws: WorkspaceRef, promptId: string, saved: boolean) {
  const result = saved
    ? await api.prompts.save.mutate({ promptId }, inWorkspace(ws))
    : await api.prompts.unsave.mutate({ promptId }, inWorkspace(ws));
  noteAcceptAfter(ws.id, result.seq);
  await client.invalidateQueries({ queryKey: keys.resource(ws.id, 'ai-prompt-list') });
}

export async function sharePrompt(client: QueryClient, ws: WorkspaceRef, input: SharePromptInput) {
  const { sharing, seq } = await api.prompts.share.mutate(input, inWorkspace(ws));
  noteAcceptAfter(ws.id, seq);
  client.setQueryData(askKeys.sharing(ws.id, input.promptId), sharing);
  return sharing;
}

// ---- record summary -------------------------------------------------------------------------------------------------------

export function useRecordSummary(entityDefinitionId: string, entityInstanceId: string, enabled = true) {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: askKeys.summary(ws.id, entityDefinitionId, entityInstanceId),
    queryFn: () =>
      api.records.summary.get.query({ recordRef: { entityDefinitionId, entityInstanceId } }, inWorkspace(ws)),
    enabled,
  });
}

export function useAskClient() {
  return useQueryClient();
}
