// Formula editor and annotation reads: attribute lists of every object the editor
// needs (type check, picker), the preview of an unsaved formula against a record, AI composer requests (refetched on
// `formula-generation-request` invalidations), and per-record entity annotations ("Calculating...", errors, "AI is
// thinking...") batched per attribute by design (50 ms window, ≤ 1000 ids), refetched on `entity-annotation`.
import type {
  AttributeDefinition,
  CreateFormulaGenerationInput,
  EntityAnnotation,
  FormulaGenerationRequest,
  FormulaSnapshot,
  PreviewFormulaOutput,
} from '@agentic-crm/contracts';
import type { FormulaSource, OutputOverride } from '@agentic-crm/formula';
import { queryOptions, useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { BatchLoader } from '../../data/batchLoader';
import { queryClient } from '../../data/queryClient';
import { api, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../data/trpc';
import { attributesQuery } from '../attributes';
import type { AttributeLookup } from './model/schema';
import { wireSource } from './model/source';

// ---- attribute lists -------------------------------------------------------------------------------------------------

/** Attribute lists of several objects (the formula's object and the objects its paths / drills reach). */
export function useAttributeLookup(
  workspace: WorkspaceRef,
  entityDefinitionIds: readonly string[],
): { lookup: AttributeLookup; isLoading: boolean } {
  const ids = useMemo(() => [...new Set(entityDefinitionIds)].filter(Boolean).sort(), [entityDefinitionIds]);
  const results = useQueries({
    queries: ids.map((id) => ({ ...attributesQuery(workspace, id), enabled: Boolean(workspace.id) })),
  });
  const datas = results.map((r) => r.data);
  const isLoading = results.some((r) => r.isPending);
  const lookup = useMemo<AttributeLookup>(() => {
    const byId = new Map<string, readonly AttributeDefinition[]>();
    ids.forEach((id, i) => {
      const d = datas[i];
      if (d) byId.set(id, d as AttributeDefinition[]);
    });
    return (id) => byId.get(id);
  }, [ids.join(','), ...datas]);
  return { lookup, isLoading };
}

// ---- snapshots ---------------------------------------------------------------------------------------------------------

/** The active snapshot of a formula attribute (the edit dialog's formula; refreshed with the attribute). */
export function useFormulaSnapshot(
  workspace: WorkspaceRef,
  attribute: Pick<AttributeDefinition, 'id' | 'entityDefinitionId' | 'formulaConfiguration'> | null,
) {
  const snapshotId = attribute?.formulaConfiguration?.activeSnapshotId ?? '';
  return useQuery({
    queryKey: [
      'ws',
      workspace.id,
      'attribute-definition',
      attribute?.entityDefinitionId ?? '',
      attribute?.id ?? '',
      'formula-snapshot',
      snapshotId,
    ],
    queryFn: () => api.formulas.snapshots.get.query({ snapshotId }, inWorkspace(workspace)) as Promise<FormulaSnapshot>,
    enabled: Boolean(workspace.id && snapshotId),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

// ---- preview -----------------------------------------------------------------------------------------------------------

export interface PreviewParams {
  entityDefinitionId: string;
  entityInstanceId: string | null;
  source: FormulaSource;
  outputTypeOverride: OutputOverride | null;
  attributeDefinitionId?: string | null;
}

export function usePreview(workspace: WorkspaceRef, params: PreviewParams, enabled: boolean) {
  const { entityDefinitionId, entityInstanceId, source, outputTypeOverride } = params;
  return useQuery({
    queryKey: [
      'ws',
      workspace.id,
      'formula-preview',
      entityDefinitionId,
      entityInstanceId,
      source.plaintext,
      JSON.stringify(source.annotations),
      outputTypeOverride,
    ],
    queryFn: () =>
      api.formulas.preview.query(
        {
          entityDefinitionId,
          entityInstanceId: entityInstanceId as string,
          ...wireSource(source),
          outputTypeOverride,
        },
        inWorkspace(workspace),
      ) as Promise<PreviewFormulaOutput>,
    enabled: enabled && Boolean(workspace.id && entityInstanceId && source.plaintext.trim()),
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

/** The default preview record: the first record of the object (newest first, like an empty search). */
export function useFirstRecord(workspace: WorkspaceRef, entityDefinitionId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['ws', workspace.id, 'record-search', entityDefinitionId, 'formula-preview-first'],
    queryFn: async () => {
      const { hits } = await api.search.records.query(
        { query: '', entityDefinitionIds: [entityDefinitionId], limit: 1 },
        inWorkspace(workspace),
      );
      return hits[0] ?? null;
    },
    enabled: enabled && Boolean(workspace.id),
    staleTime: 60_000,
  });
}

// ---- AI composer -------------------------------------------------------------------------------------------------------

export const generationRequestQuery = (workspace: WorkspaceRef, id: string) =>
  queryOptions({
    queryKey: ['ws', workspace.id, 'formula-generation-request', id] as const,
    queryFn: () =>
      api.formulas.generationRequest.query({ id }, inWorkspace(workspace)) as Promise<FormulaGenerationRequest>,
  });

export function useGenerationRequest(workspace: WorkspaceRef, id: string | null) {
  return useQuery({
    ...generationRequestQuery(workspace, id ?? ''),
    enabled: Boolean(workspace.id && id),
    // Invalidations drive the refetch; a slow poll covers a dropped socket while the request is open.
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === 'completed' || status === 'failed' ? false : 2_000;
    },
  });
}

export async function requestGeneration(
  workspace: WorkspaceRef,
  kind: 'generate' | 'fix',
  input: CreateFormulaGenerationInput,
): Promise<FormulaGenerationRequest> {
  const res =
    kind === 'fix'
      ? await api.formulas.fix.mutate(input, inWorkspace(workspace))
      : await api.formulas.generate.mutate(input, inWorkspace(workspace));
  noteAcceptAfter(workspace.id, res.seq);
  return res.request as FormulaGenerationRequest;
}

// ---- AI availability ---------------------------------------------------------------------------------------------------

/** Whether the server has an LLM provider ("not configured" states otherwise). */
export function useAiConfigured(workspace: WorkspaceRef): boolean | undefined {
  const q = useQuery({
    queryKey: ['ws', workspace.id, 'ai-settings', 'ai-attributes-status'],
    queryFn: () => api.aiAttributes.status.query(undefined, inWorkspace(workspace)),
    enabled: Boolean(workspace.id),
    staleTime: 10 * 60_000,
  });
  return q.data?.configured;
}

// ---- entity annotations ------------------------------------------------------------------------------------------------

interface AnnotationKey {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  attributeDefinitionId: string;
  entityInstanceId: string;
}

export const annotationLoader = new BatchLoader<AnnotationKey, EntityAnnotation>({
  windowMs: 50,
  maxBatchSize: 1000,
  groupOf: (k) => `${k.workspace.id}:${k.entityDefinitionId}:${k.attributeDefinitionId}`,
  idOf: (k) => k.entityInstanceId,
  fetchBatch: async (batch) => {
    const first = batch[0] as AnnotationKey;
    const res = (await api.formulas.annotations.query(
      {
        entityDefinitionId: first.entityDefinitionId,
        attributeDefinitionId: first.attributeDefinitionId,
        entityInstanceIds: batch.map((k) => k.entityInstanceId),
      },
      inWorkspace(first.workspace),
    )) as Record<string, EntityAnnotation>;
    return new Map(Object.entries(res));
  },
});

export const annotationKey = (workspaceId: string, attributeId: string, recordId: string) =>
  ['ws', workspaceId, 'entity-annotation', attributeId, recordId] as const;

export const annotationQuery = (key: AnnotationKey) =>
  queryOptions({
    queryKey: annotationKey(key.workspace.id, key.attributeDefinitionId, key.entityInstanceId),
    queryFn: () => annotationLoader.load(key),
  });

/** Whether an attribute has per-record state worth reading (formula, or AI autofill switched on). */
export function isAnnotated(attribute: Pick<AttributeDefinition, 'formulaConfiguration' | 'aiAutofillConfiguration'>) {
  return Boolean(attribute.formulaConfiguration) || Boolean(attribute.aiAutofillConfiguration?.isEnabled);
}

export function useAnnotation(
  workspace: WorkspaceRef,
  attribute: Pick<
    AttributeDefinition,
    'id' | 'entityDefinitionId' | 'formulaConfiguration' | 'aiAutofillConfiguration'
  >,
  recordId: string | undefined,
  enabled = true,
): EntityAnnotation | undefined {
  const q = useQuery({
    ...annotationQuery({
      workspace,
      entityDefinitionId: attribute.entityDefinitionId,
      attributeDefinitionId: attribute.id,
      entityInstanceId: recordId ?? '',
    }),
    enabled: enabled && Boolean(workspace.id && recordId) && isAnnotated(attribute),
  });
  return q.data;
}

/**
 * Writes the annotations a run returned into the cache (cells switch to "AI is thinking..." at once) and refetches
 * the attribute's other annotations (a column run queues records whose cells are not mounted yet).
 */
export function seedAnnotations(
  workspaceId: string,
  attributeId: string,
  annotations: Record<string, EntityAnnotation>,
): void {
  for (const [recordId, annotation] of Object.entries(annotations)) {
    queryClient.setQueryData(annotationKey(workspaceId, attributeId, recordId), annotation);
  }
  void queryClient.invalidateQueries({
    queryKey: ['ws', workspaceId, 'entity-annotation', attributeId],
    predicate: (q) => !(String(q.queryKey[4]) in annotations),
  });
}
