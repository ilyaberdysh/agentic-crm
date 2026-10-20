// The one data module the import wizard talks to: the `imports.*` procedures (server.ts) with their cache keys.
// Keys sit under ['ws', ws, 'import', …] / 'import-history'.
import { useQuery } from '@tanstack/react-query';
import { useContext, useMemo } from 'react';
import { queryClient } from '../../../data/queryClient';
import { getCurrentWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { WorkspaceContext } from '../../shell/workspaceContext';
import {
  type CreateImportInput,
  type ImportHistoryQuery,
  type ImportJob,
  ImportNotFoundError,
  type ImportPlan,
  type ImportsBackend,
  type ReviewValuesResult,
  type SetMappingInput,
  type ValueOverride,
} from './contract';
import { createServerImportsBackend } from './server';

const backends = new Map<string, ImportsBackend>();

export function importsBackend(ws: WorkspaceRef): ImportsBackend {
  let b = backends.get(ws.id);
  if (!b) {
    b = createServerImportsBackend(ws);
    backends.set(ws.id, b);
  }
  return b;
}

/** Tests: forget the backends. */
export function resetImportsBackends(): void {
  backends.clear();
}

export function useImportsWorkspace(): WorkspaceRef {
  const ctx = useContext(WorkspaceContext);
  const ws = ctx?.workspace ?? getCurrentWorkspace();
  if (!ws) throw new Error('Imports need a workspace route');
  return useMemo(() => ({ id: ws.id, slug: ws.slug }), [ws.id, ws.slug]);
}

// ---- keys ------------------------------------------------------------------------------------------------------------

export const importKeys = {
  all: (wsId: string) => ['ws', wsId, 'import'] as const,
  job: (wsId: string, jobId: string) => ['ws', wsId, 'import', jobId] as const,
  review: (wsId: string, jobId: string, propertyId: string) =>
    ['ws', wsId, 'import', jobId, 'review', propertyId] as const,
  reviews: (wsId: string, jobId: string) => ['ws', wsId, 'import', jobId, 'review'] as const,
  summary: (wsId: string, jobId: string) => ['ws', wsId, 'import', jobId, 'review', 'summary'] as const,
  plan: (wsId: string, jobId: string) => ['ws', wsId, 'import', jobId, 'plan'] as const,
  history: (wsId: string, query: ImportHistoryQuery) => ['ws', wsId, 'import-history', query] as const,
  histories: (wsId: string) => ['ws', wsId, 'import-history'] as const,
};

const ACTIVE = new Set(['ingesting', 'confirmed', 'executing']);

const notFoundRetry = (count: number, error: unknown) => !(error instanceof ImportNotFoundError) && count < 2;

export function useImportJob(jobId: string | null) {
  const ws = useImportsWorkspace();
  return useQuery({
    queryKey: importKeys.job(ws.id, jobId ?? ''),
    queryFn: async () => importsBackend(ws).status(jobId as string),
    enabled: Boolean(jobId),
    retry: notFoundRetry,
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.status) ? 600 : false),
  });
}

export function useReviewValues(jobId: string, propertyId: string | null, enabled = true) {
  const ws = useImportsWorkspace();
  return useQuery({
    queryKey: importKeys.review(ws.id, jobId, propertyId ?? ''),
    queryFn: async () => importsBackend(ws).reviewValues({ jobId, propertyId: propertyId as string }),
    enabled: enabled && Boolean(propertyId),
    retry: notFoundRetry,
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 500 : false),
  });
}

/** Orange dots of the Columns rail (one read for every mapped column). */
export function useReviewSummary(jobId: string) {
  const ws = useImportsWorkspace();
  return useQuery({
    queryKey: importKeys.summary(ws.id, jobId),
    queryFn: () => importsBackend(ws).reviewSummary(jobId),
    retry: notFoundRetry,
  });
}

export function usePlan(jobId: string, options: { enabled?: boolean; live?: boolean } = {}) {
  const ws = useImportsWorkspace();
  return useQuery({
    queryKey: importKeys.plan(ws.id, jobId),
    queryFn: async () => importsBackend(ws).preview({ jobId, range: { start: 0, size: 1000 } }),
    enabled: options.enabled ?? true,
    retry: notFoundRetry,
    refetchInterval: (q) => (options.live || q.state.data?.status === 'planning' ? 700 : false),
  });
}

export function useImportHistory(query: ImportHistoryQuery) {
  const ws = useImportsWorkspace();
  return useQuery({
    queryKey: importKeys.history(ws.id, query),
    queryFn: async () => importsBackend(ws).history(query),
    refetchInterval: (q) => (q.state.data?.some((j) => ACTIVE.has(j.status)) ? 1500 : false),
  });
}

// ---- writes ----------------------------------------------------------------------------------------------------------

function putJob(ws: WorkspaceRef, job: ImportJob): ImportJob {
  queryClient.setQueryData(importKeys.job(ws.id, job.jobId), job);
  void queryClient.invalidateQueries({ queryKey: importKeys.histories(ws.id) });
  return job;
}

function putReview(ws: WorkspaceRef, jobId: string, result: ReviewValuesResult): ReviewValuesResult {
  queryClient.setQueryData(importKeys.review(ws.id, jobId, result.propertyId), result);
  void queryClient.invalidateQueries({ queryKey: importKeys.summary(ws.id, jobId) });
  queryClient.removeQueries({ queryKey: importKeys.plan(ws.id, jobId) });
  return result;
}

export async function createImport(ws: WorkspaceRef, input: CreateImportInput): Promise<ImportJob> {
  return putJob(ws, await importsBackend(ws).create(input));
}

export async function setMapping(ws: WorkspaceRef, input: SetMappingInput): Promise<ImportJob> {
  const job = await importsBackend(ws).setMapping(input);
  // Config / mapping changes re-resolve the affected columns and invalidate the plan.
  await queryClient.invalidateQueries({ queryKey: importKeys.reviews(ws.id, input.jobId) });
  queryClient.removeQueries({ queryKey: importKeys.plan(ws.id, input.jobId) });
  return putJob(ws, job);
}

export async function setOverride(
  ws: WorkspaceRef,
  input: { jobId: string; propertyId: string; hash: string; raw: string; override: ValueOverride | null },
): Promise<ReviewValuesResult> {
  return putReview(ws, input.jobId, await importsBackend(ws).setOverride(input));
}

export async function createMissingOptions(
  ws: WorkspaceRef,
  input: { jobId: string; propertyId: string; values: string[] },
): Promise<ReviewValuesResult> {
  const result = await importsBackend(ws).createOptions(input);
  // Other columns may map to the same attribute.
  await queryClient.invalidateQueries({ queryKey: importKeys.reviews(ws.id, input.jobId) });
  return putReview(ws, input.jobId, result);
}

export async function runImport(ws: WorkspaceRef, jobId: string): Promise<ImportJob> {
  const job = await importsBackend(ws).run(jobId);
  queryClient.removeQueries({ queryKey: importKeys.plan(ws.id, jobId) });
  return putJob(ws, job);
}

export async function cancelImport(ws: WorkspaceRef, jobId: string): Promise<ImportJob> {
  return putJob(ws, await importsBackend(ws).cancel(jobId));
}

export async function removeImport(ws: WorkspaceRef, jobId: string): Promise<void> {
  await importsBackend(ws).remove(jobId);
  queryClient.removeQueries({ queryKey: importKeys.job(ws.id, jobId) });
  await queryClient.invalidateQueries({ queryKey: importKeys.histories(ws.id) });
}

export async function fetchPlan(ws: WorkspaceRef, jobId: string): Promise<ImportPlan> {
  return queryClient.fetchQuery({
    queryKey: importKeys.plan(ws.id, jobId),
    queryFn: async () => importsBackend(ws).preview({ jobId, range: { start: 0, size: 1000 } }),
  });
}
