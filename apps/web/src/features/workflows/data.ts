// Workflows on the client (BACKLOG 8.01–8.11; procedures in research/architecture/decisions/slice8-9-contracts.md).
// Queries live under the realtime resources ['ws', ws, 'workflow' | 'workflow-list' | 'workflow-run' |
// 'workflow-run-list', …] so one invalidation prefix refreshes every screen showing them:
//   ['ws', ws, 'workflow-list', params]                     index, admin list, "Select workflow" dialog
//   ['ws', ws, 'workflow', id, 'version', versionId|draft]  header + a version (editor, run canvas, old versions)
//   ['ws', ws, 'workflow', id, 'versions']                  version history
//   ['ws', ws, 'workflow', id, 'variables', blockId, v]     variable picker
//   ['ws', ws, 'workflow', id, 'permissions']               Share popover / admin Permissions tab
//   ['ws', ws, 'workflow-run-list', id, …]                  run history + last-7-days overview, credits usage
//   ['ws', ws, 'workflow-run', runId]                       run viewer
// Header mutations (rename, publish, enable…) answer the canonical workflow; editor edits of the draft go through the
// serial op queue in editor/ops.ts.
import type { ListWorkflowsInput, PutPermissionInput, RemovePermissionInput, UsageInput } from '@agentic-crm/contracts';
import {
  BLOCK_CATEGORY_LABELS,
  type BlockDefinition,
  blockCategories,
  STEP_DEFINITIONS,
  TRIGGER_DEFINITIONS,
} from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../data/keys';
import { queryClient } from '../../data/queryClient';
import {
  api,
  errorEnvelopeOf,
  inWorkspace,
  noteAcceptAfter,
  type RouterOutputs,
  type WorkspaceRef,
} from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useWorkspace } from '../shell/workspaceContext';
import type { Workflow, WorkflowVersion } from './types';

export type WorkflowDetail = RouterOutputs['workflows']['get'];
export type VariablePickerData = RouterOutputs['workflows']['variables'];
export type RunList = RouterOutputs['workflows']['runs']['list'];
export type RunDetailData = RouterOutputs['workflows']['runs']['get'];
export type VersionSummaries = RouterOutputs['workflows']['versions'];
export type UsageData = RouterOutputs['workflows']['usage'];
export type PermissionsList = RouterOutputs['permissions']['list'];

export const wfKeys = {
  lists: (ws: string) => keys.resource(ws, 'workflow-list'),
  list: (ws: string, params: ListWorkflowsInput) => [...keys.resource(ws, 'workflow-list'), params] as const,
  workflow: (ws: string, id: string) => [...keys.resource(ws, 'workflow'), id] as const,
  detail: (ws: string, id: string, versionId: string | null) =>
    [...keys.resource(ws, 'workflow'), id, 'version', versionId ?? 'draft'] as const,
  versions: (ws: string, id: string) => [...keys.resource(ws, 'workflow'), id, 'versions'] as const,
  variables: (ws: string, id: string, blockId: string, versionId: string | null) =>
    [...keys.resource(ws, 'workflow'), id, 'variables', blockId, versionId ?? 'draft'] as const,
  permissions: (ws: string, id: string) => [...keys.resource(ws, 'workflow'), id, 'permissions'] as const,
  runs: (ws: string, id: string) => [...keys.resource(ws, 'workflow-run-list'), id] as const,
  runList: (ws: string, id: string) => [...keys.resource(ws, 'workflow-run-list'), id, 'list'] as const,
  usage: (ws: string, params: UsageInput) => [...keys.resource(ws, 'workflow-run-list'), 'usage', params] as const,
  run: (ws: string, runId: string) => [...keys.resource(ws, 'workflow-run'), runId] as const,
};

export function useWs(): WorkspaceRef {
  const { workspace } = useWorkspace();
  return { id: workspace.id, slug: workspace.slug };
}

// ---- reads ---------------------------------------------------------------------------------------------------------

export const workflowsQuery = (ws: WorkspaceRef, params: ListWorkflowsInput = {}) =>
  queryOptions({
    queryKey: wfKeys.list(ws.id, params),
    queryFn: async () => {
      const { workflows } = await api.workflows.list.query(params, inWorkspace(ws));
      return workflows;
    },
  });

export function useWorkflows(params: ListWorkflowsInput = {}, enabled = true) {
  const ws = useWs();
  return useQuery({ ...workflowsQuery(ws, params), enabled, placeholderData: (prev) => prev });
}

export const workflowQuery = (ws: WorkspaceRef, workflowId: string, versionId: string | null = null) =>
  queryOptions({
    queryKey: wfKeys.detail(ws.id, workflowId, versionId),
    queryFn: () => api.workflows.get.query({ workflowId, ...(versionId ? { versionId } : {}) }, inWorkspace(ws)),
    retry: (count, error) => count < 1 && !/not.?found|404|403/i.test(String((error as Error)?.message)),
  });

export function useWorkflow(workflowId: string, versionId: string | null = null) {
  const ws = useWs();
  return useQuery({ ...workflowQuery(ws, workflowId, versionId), enabled: Boolean(workflowId) });
}

export function useVersions(workflowId: string, enabled = true) {
  const ws = useWs();
  return useQuery({
    queryKey: wfKeys.versions(ws.id, workflowId),
    queryFn: async () => (await api.workflows.versions.query({ workflowId }, inWorkspace(ws))).versions,
    enabled,
  });
}

export interface CatalogData {
  categories: { slug: string; label: string }[];
  triggers: BlockDefinition[];
  steps: BlockDefinition[];
}

/**
 * The block catalogue. `workflows.catalog` serves the same contracts module the client imports, so the editor reads it
 * locally (no request, no loading state); the procedure stays for other clients.
 */
export const CATALOG: CatalogData = {
  categories: blockCategories.map((slug) => ({ slug, label: BLOCK_CATEGORY_LABELS[slug] })),
  triggers: TRIGGER_DEFINITIONS,
  steps: STEP_DEFINITIONS,
};

export function useVariables(workflowId: string, blockId: string | null, versionId: string | null = null) {
  const ws = useWs();
  return useQuery({
    queryKey: wfKeys.variables(ws.id, workflowId, blockId ?? '', versionId),
    queryFn: () =>
      api.workflows.variables.query(
        { workflowId, blockId: blockId as string, ...(versionId ? { versionId } : {}) },
        inWorkspace(ws),
      ),
    enabled: Boolean(blockId),
    placeholderData: (prev) => prev,
  });
}

export function useRuns(workflowId: string) {
  const ws = useWs();
  return useQuery({
    queryKey: wfKeys.runList(ws.id, workflowId),
    queryFn: () => api.workflows.runs.list.query({ workflowId, limit: 200 }, inWorkspace(ws)),
    // Run status changes arrive as invalidations; a slow poll covers missed ones while runs execute.
    refetchInterval: (q) =>
      q.state.data?.runs.some((r) => r.status === 'executing' || r.status === 'queued') ? 3000 : false,
  });
}

export function useRun(runId: string | null) {
  const ws = useWs();
  return useQuery({
    queryKey: wfKeys.run(ws.id, runId ?? ''),
    queryFn: () => api.workflows.runs.get.query({ runId: runId as string }, inWorkspace(ws)),
    enabled: Boolean(runId),
    refetchInterval: (q) => {
      const status = q.state.data?.run.status;
      return status === 'executing' || status === 'queued' ? 1500 : false;
    },
  });
}

export function useUsage(params: UsageInput = {}) {
  const ws = useWs();
  return useQuery({
    queryKey: wfKeys.usage(ws.id, params),
    queryFn: () => api.workflows.usage.query(params, inWorkspace(ws)),
  });
}

export function useWorkflowPermissions(workflowId: string, enabled = true) {
  const ws = useWs();
  return useQuery({
    queryKey: wfKeys.permissions(ws.id, workflowId),
    queryFn: () => api.permissions.list.query({ resourceKind: 'workflow', resourceId: workflowId }, inWorkspace(ws)),
    enabled,
  });
}

// ---- cache writes ----------------------------------------------------------------------------------------------------

/** Writes a canonical workflow header into every cached read that shows it. */
export function writeWorkflow(client: QueryClient, ws: WorkspaceRef, workflow: Workflow, seq?: string | null) {
  noteAcceptAfter(ws.id, seq ?? null);
  client.setQueriesData<WorkflowDetail>({ queryKey: wfKeys.workflow(ws.id, workflow.id) }, (prev) =>
    prev && typeof prev === 'object' && 'workflow' in prev && 'version' in prev ? { ...prev, workflow } : prev,
  );
  client.setQueriesData<Workflow[]>({ queryKey: wfKeys.lists(ws.id) }, (prev) =>
    Array.isArray(prev) ? prev.map((w) => (w.id === workflow.id ? workflow : w)) : prev,
  );
}

/** Writes the draft (or a version) returned by publish / discard / restore. */
export function writeDetail(
  client: QueryClient,
  ws: WorkspaceRef,
  detail: { workflow: Workflow; version: WorkflowVersion },
  versionKey: string | null,
) {
  client.setQueryData<WorkflowDetail>(wfKeys.detail(ws.id, detail.workflow.id, versionKey), detail);
  writeWorkflow(client, ws, detail.workflow);
}

export function reportError(error: unknown, title?: string) {
  const env = errorEnvelopeOf(error);
  toast.error({
    title: title ?? env.message ?? 'Something went wrong',
    ...(title ? { description: env.message } : {}),
  });
}

function refreshWorkflow(ws: WorkspaceRef, workflowId: string) {
  void queryClient.invalidateQueries({ queryKey: wfKeys.workflow(ws.id, workflowId) });
  void queryClient.invalidateQueries({ queryKey: wfKeys.lists(ws.id) });
}

// ---- header mutations --------------------------------------------------------------------------------------------------

/** "New workflow": a transient draft (client-minted ids) the editor opens at once (README §2.2, B.21). */
export async function createWorkflow(ws: WorkspaceRef): Promise<Workflow> {
  const id = newId();
  const { workflow, seq } = await api.workflows.create.mutate({ id, draftVersionId: newId() }, inWorkspace(ws));
  noteAcceptAfter(ws.id, seq);
  return workflow;
}

export async function updateWorkflow(
  ws: WorkspaceRef,
  workflowId: string,
  patch: { title?: string | null; description?: string | null; isArchived?: boolean; timezone?: string | null },
  failure = 'Failed to update workflow',
): Promise<Workflow | null> {
  try {
    const { workflow, seq } = await api.workflows.update.mutate({ workflowId, ...patch }, inWorkspace(ws));
    writeWorkflow(queryClient, ws, workflow, seq);
    void queryClient.invalidateQueries({ queryKey: wfKeys.lists(ws.id) });
    return workflow;
  } catch (error) {
    reportError(error, failure);
    refreshWorkflow(ws, workflowId);
    return null;
  }
}

export async function updateSettings(
  ws: WorkspaceRef,
  workflowId: string,
  patch: { timezone?: string | null; failureNotifications?: boolean },
): Promise<void> {
  try {
    const { workflow, seq } = await api.workflows.settings.update.mutate({ workflowId, ...patch }, inWorkspace(ws));
    writeWorkflow(queryClient, ws, workflow, seq);
  } catch (error) {
    reportError(error, 'Failed to update settings');
    refreshWorkflow(ws, workflowId);
  }
}

export interface PublishFailure {
  message: string;
  checklist: { errorCount: number; blocksWithErrors: string[]; messages: string[] } | null;
}

/** Publish the draft; a 400 WORKFLOW_INVALID answers the checklist (the editor shows it). */
export async function publishWorkflow(
  ws: WorkspaceRef,
  workflowId: string,
): Promise<
  { ok: true; detail: { workflow: Workflow; version: WorkflowVersion } } | { ok: false; failure: PublishFailure }
> {
  try {
    const result = await api.workflows.publish.mutate({ workflowId, versionId: newId() }, inWorkspace(ws));
    noteAcceptAfter(ws.id, result.seq);
    writeWorkflow(queryClient, ws, result.workflow);
    refreshWorkflow(ws, workflowId);
    return { ok: true, detail: { workflow: result.workflow, version: result.version } };
  } catch (error) {
    const env = errorEnvelopeOf(error);
    const info = checklistOf(error);
    refreshWorkflow(ws, workflowId);
    return { ok: false, failure: { message: env.message ?? 'Failed to publish workflow', checklist: info } };
  }
}

function checklistOf(error: unknown): PublishFailure['checklist'] {
  const shape = (error as { shape?: { additional_information?: { checklist?: PublishFailure['checklist'] } } }).shape;
  return shape?.additional_information?.checklist ?? null;
}

export async function setLive(ws: WorkspaceRef, workflowId: string, live: boolean): Promise<void> {
  try {
    const call = live ? api.workflows.enable : api.workflows.disable;
    const { workflow, seq } = await call.mutate({ workflowId }, inWorkspace(ws));
    writeWorkflow(queryClient, ws, workflow, seq);
    refreshWorkflow(ws, workflowId);
  } catch (error) {
    reportError(error, live ? 'Failed to enable workflow' : 'Failed to pause workflow');
    refreshWorkflow(ws, workflowId);
  }
}

export async function discardDraft(ws: WorkspaceRef, workflowId: string): Promise<boolean> {
  try {
    const result = await api.workflows.discardDraft.mutate({ workflowId, draftVersionId: newId() }, inWorkspace(ws));
    noteAcceptAfter(ws.id, result.seq);
    writeDetail(queryClient, ws, { workflow: result.workflow, version: result.version }, null);
    refreshWorkflow(ws, workflowId);
    return true;
  } catch (error) {
    reportError(error, 'Failed to discard changes');
    refreshWorkflow(ws, workflowId);
    return false;
  }
}

export async function restoreVersion(ws: WorkspaceRef, workflowId: string, versionId: string): Promise<boolean> {
  try {
    const result = await api.workflows.restoreVersion.mutate(
      { workflowId, versionId, draftVersionId: newId() },
      inWorkspace(ws),
    );
    noteAcceptAfter(ws.id, result.seq);
    writeDetail(queryClient, ws, { workflow: result.workflow, version: result.version }, null);
    refreshWorkflow(ws, workflowId);
    return true;
  } catch (error) {
    reportError(error, 'Failed to restore version');
    refreshWorkflow(ws, workflowId);
    return false;
  }
}

export async function duplicateWorkflow(ws: WorkspaceRef, workflowId: string): Promise<Workflow | null> {
  try {
    const { workflow, seq } = await api.workflows.duplicate.mutate(
      { workflowId, targetWorkflowId: newId() },
      inWorkspace(ws),
    );
    noteAcceptAfter(ws.id, seq);
    void queryClient.invalidateQueries({ queryKey: wfKeys.lists(ws.id) });
    return workflow;
  } catch (error) {
    reportError(error, 'Failed to duplicate workflow');
    return null;
  }
}

export async function deleteWorkflow(ws: WorkspaceRef, workflowId: string, failure = 'Failed to delete workflow') {
  try {
    const { seq } = await api.workflows.delete.mutate({ workflowId }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
    queryClient.setQueriesData<Workflow[]>({ queryKey: wfKeys.lists(ws.id) }, (prev) =>
      Array.isArray(prev) ? prev.filter((w) => w.id !== workflowId) : prev,
    );
    void queryClient.invalidateQueries({ queryKey: wfKeys.lists(ws.id) });
    return true;
  } catch (error) {
    reportError(error, failure);
    return false;
  }
}

// ---- runs ------------------------------------------------------------------------------------------------------------

function refreshRuns(ws: WorkspaceRef, workflowId: string, runId?: string) {
  void queryClient.invalidateQueries({ queryKey: wfKeys.runs(ws.id, workflowId) });
  if (runId) void queryClient.invalidateQueries({ queryKey: wfKeys.run(ws.id, runId) });
}

export async function triggerManual(
  ws: WorkspaceRef,
  workflowId: string,
  refs: { recordRefs?: { entityDefinitionId: string; entityInstanceId: string }[]; entryRefs?: typeof refs.recordRefs },
): Promise<{ runId: string; versionId: string; sequenceNumber: number }[] | null> {
  try {
    const result = await api.workflows.trigger.manual.mutate({ workflowId, ...refs }, inWorkspace(ws));
    noteAcceptAfter(ws.id, result.seq);
    refreshRuns(ws, workflowId);
    void queryClient.invalidateQueries({ queryKey: wfKeys.lists(ws.id) });
    return result.runs;
  } catch (error) {
    reportError(error, 'Failed to trigger workflow');
    return null;
  }
}

export async function retryRun(ws: WorkspaceRef, workflowId: string, runId: string, fromBlockExecutionId: string) {
  try {
    const { run, seq } = await api.workflows.runs.retry.mutate({ runId, fromBlockExecutionId }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
    refreshRuns(ws, workflowId, runId);
    return run;
  } catch (error) {
    reportError(error, 'Unable to retry');
    return null;
  }
}

export async function rerun(ws: WorkspaceRef, workflowId: string, runId: string, live = false) {
  try {
    const { run, seq } = await api.workflows.runs.rerun.mutate({ runId, ...(live ? { live } : {}) }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
    refreshRuns(ws, workflowId, runId);
    return run;
  } catch (error) {
    reportError(error, 'Unable to retry');
    return null;
  }
}

export async function cancelRun(ws: WorkspaceRef, workflowId: string, runId: string) {
  try {
    const { run, seq } = await api.workflows.runs.cancel.mutate({ runId }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
    refreshRuns(ws, workflowId, runId);
    return run;
  } catch (error) {
    reportError(error, 'Failed to cancel run');
    return null;
  }
}

// ---- permissions (Share popover, admin Permissions tab) ------------------------------------------------------------

export async function putPermission(ws: WorkspaceRef, input: Omit<PutPermissionInput, 'resourceKind'>) {
  try {
    const { seq } = await api.permissions.put.mutate({ resourceKind: 'workflow', ...input }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
  } catch (error) {
    reportError(error, 'Failed to update permissions');
  } finally {
    void queryClient.invalidateQueries({ queryKey: wfKeys.workflow(ws.id, String(input.resourceId)) });
  }
}

export async function removePermission(ws: WorkspaceRef, input: Omit<RemovePermissionInput, 'resourceKind'>) {
  try {
    const { seq } = await api.permissions.remove.mutate({ resourceKind: 'workflow', ...input }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
  } catch (error) {
    reportError(error, 'Failed to update permissions');
  } finally {
    void queryClient.invalidateQueries({ queryKey: wfKeys.workflow(ws.id, String(input.resourceId)) });
  }
}
