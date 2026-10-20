// Table data (D-03, internal-api-shapes §3): attribute definitions of an object, query snapshots
// (`snapshots.query` → first 1000 ids; `snapshots.chunk` on scroll) and footer aggregations over a snapshot.
// Snapshot and aggregate keys sit under ['ws', ws, 'snapshot', def, …] so a `snapshot-selection` invalidation reaches
// them; `meta.snapshotDeps` narrows it to queries that depend on the changed attributes (data/realtime/invalidation).
import type { Path, Predicate, Sort } from '@agentic-crm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../data/keys';
import { api, inWorkspace, type RouterInputs, type RouterOutputs, type WorkspaceRef } from '../../data/trpc';
import { attributesQuery } from '../attributes';

export type SnapshotPage = RouterOutputs['snapshots']['query'];
export type AggregateResult = RouterOutputs['snapshots']['aggregate'];
export type AggregationKind = RouterInputs['snapshots']['aggregate']['aggregation'];

export const CHUNK_SIZE = 1000;

/**
 * Attribute definitions of an object, through the attributes feature's query (one cache entry per object for every
 * consumer; archived ones included — the table skips them where it matters).
 */
export function useAttributes(workspace: WorkspaceRef, entityDefinitionId: string | undefined) {
  return useQuery({
    ...attributesQuery(workspace, entityDefinitionId ?? ''),
    enabled: Boolean(entityDefinitionId),
  });
}

export { attributesQuery };

// ---- snapshots -------------------------------------------------------------------------------------------------

/** `snapshots.query` input of a view draft (`draft.query`: filter + sorts, relative dates in the viewer's zone). */
export interface SnapshotQueryInput {
  entityDefinitionId: string;
  filter: Predicate | null;
  sorts: Sort[];
  timeZone?: string;
}

function collectPaths(p: Predicate | null, out: Path[]): Path[] {
  if (!p) return out;
  if ('and' in p) for (const c of p.and) collectPaths(c, out);
  else if ('or' in p) for (const c of p.or) collectPaths(c, out);
  else out.push(p.path);
  return out;
}

/** Attribute ids whose value changes can change the row set or order of the snapshot. */
export function snapshotDependencies(params: Pick<SnapshotQueryInput, 'filter' | 'sorts'>): string[] {
  const ids = new Set<string>();
  for (const path of collectPaths(params.filter, [])) for (const hop of path) ids.add(hop.attributeDefinitionId);
  for (const sort of params.sorts) for (const hop of sort.path) ids.add(hop.attributeDefinitionId);
  return [...ids];
}

/** The snapshot of a view draft, keyed by `key` (the draft's `queryKey`, which changes with the drafts). */
export function snapshotQuery(workspace: WorkspaceRef, input: SnapshotQueryInput, key: string) {
  return queryOptions({
    queryKey: keys.snapshot(workspace.id, input.entityDefinitionId, key),
    queryFn: () =>
      api.snapshots.query.query({ ...input, initialRange: { start: 0, size: CHUNK_SIZE } }, inWorkspace(workspace)),
    meta: { snapshotDeps: snapshotDependencies(input) },
    // Server snapshots expire (hours); invalidations keep it fresh meanwhile.
    staleTime: 10 * 60_000,
    gcTime: 15 * 60_000,
  });
}

export function fetchChunk(workspace: WorkspaceRef, entityDefinitionId: string, snapshotId: string, start: number) {
  return api.snapshots.chunk.query({ entityDefinitionId, snapshotId, start, size: CHUNK_SIZE }, inWorkspace(workspace));
}

export function resolveSelection(
  workspace: WorkspaceRef,
  entityDefinitionId: string,
  snapshotId: string,
  zebraEdges: number[],
) {
  return api.snapshots.resolveSelection.query({ entityDefinitionId, snapshotId, zebraEdges }, inWorkspace(workspace));
}

// ---- aggregations ------------------------------------------------------------------------------------------------

export function aggregateQuery(
  workspace: WorkspaceRef,
  entityDefinitionId: string,
  snapshotId: string,
  path: Path,
  field: string | null,
  aggregation: AggregationKind,
) {
  const attributeId = path[path.length - 1]?.attributeDefinitionId ?? '';
  return queryOptions({
    queryKey: [
      ...keys.resource(workspace.id, 'snapshot'),
      entityDefinitionId,
      'aggregate',
      snapshotId,
      JSON.stringify(path),
      field ?? '',
      aggregation,
    ] as const,
    queryFn: () =>
      api.snapshots.aggregate.query(
        { snapshotId, path, aggregation, ...(field ? { field } : {}) },
        inWorkspace(workspace),
      ),
    meta: { snapshotDeps: [attributeId] },
  });
}
