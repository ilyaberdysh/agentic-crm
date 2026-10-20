// Cell value hydration (D-03; C1 README §5 "Column values"): each visible cell reads its normalised values key; the
// slice-1 batching loader merges the reads of one frame into one `values.list` per attribute (≤ 1337 ids), like
// Attio's per-column batches while scrolling. Pending writes from the mutation queue overlay the server values.
// Path columns ("Company › Domain") resolve hop by hop through record-reference values.
import type { AttributeDefinition, AttributeValue, Path } from '@agentic-crm/contracts';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { keys, valueOverlayKey } from '../../data/keys';
import { appQueue } from '../../data/mutations';
import { useOverlayEntry } from '../../data/mutations/react';
import { queryClient } from '../../data/queryClient';
import { valuesLoader, valuesQuery } from '../../data/records';
import type { WorkspaceRef } from '../../data/trpc';
import { formatValue, overlayValues } from './contracts';

export interface CellValues {
  values: AttributeValue[] | undefined;
  isLoading: boolean;
  error: unknown;
  /** Path cells: the one record holding the values (writes of editable path columns go to it). */
  ownerId?: string;
}

export function useRecordValues(
  workspace: WorkspaceRef,
  entityDefinitionId: string,
  attributeId: string | undefined,
  recordId: string | undefined,
  enabled: boolean,
): CellValues {
  const q = useQuery({
    ...valuesQuery({
      workspace,
      entityDefinitionId,
      attributeDefinitionId: attributeId ?? '',
      entityInstanceId: recordId ?? '',
    }),
    enabled: enabled && Boolean(recordId && attributeId),
  });
  const overlay = useOverlayEntry(appQueue(), recordId && attributeId ? valueOverlayKey(recordId, attributeId) : null);
  // The wire type (tRPC-inferred) marks `value` optional; it is always present.
  const server = q.data?.values as AttributeValue[] | undefined;
  const values = useMemo(() => (overlay ? overlayValues(overlay.value, server) : server), [overlay, server]);
  return { values, isLoading: values === undefined && q.error == null, error: q.error };
}

/** Values at the end of a multi-hop path for one record (all related records' values, in reference order). */
export function usePathValues(
  workspace: WorkspaceRef,
  path: Path,
  recordId: string | undefined,
  enabled: boolean,
): CellValues {
  // Hop 0 on the table's object, then each hop on the referenced records. Hooks run for a fixed max of 5 hops.
  const hop0 = useHop(workspace, path, 0, recordId ? [recordId] : [], enabled);
  const hop1 = useHop(workspace, path, 1, hop0.next, enabled && hop0.done);
  const hop2 = useHop(workspace, path, 2, hop1.next, enabled && hop1.done);
  const hop3 = useHop(workspace, path, 3, hop2.next, enabled && hop2.done);
  const hop4 = useHop(workspace, path, 4, hop3.next, enabled && hop3.done);
  const hops = [hop0, hop1, hop2, hop3, hop4];
  const last = hops[path.length - 1] as HopResult;
  const blocked = hops.slice(0, path.length - 1).some((h) => h.done && h.next.length === 0);
  if (blocked) return { values: [], isLoading: false, error: null };
  const owners = path.length > 1 ? (hops[path.length - 2] as HopResult).next : [];
  return {
    values: last.done ? last.values : undefined,
    isLoading: !last.done,
    error: last.error,
    ...(owners.length === 1 ? { ownerId: owners[0] } : {}),
  };
}

interface HopResult {
  values: AttributeValue[];
  next: string[];
  done: boolean;
  error: unknown;
}

function useHop(workspace: WorkspaceRef, path: Path, hop: number, recordIds: string[], enabled: boolean): HopResult {
  const step = path[hop];
  const results = useQueries({
    queries: step
      ? recordIds.map((id) => ({
          ...valuesQuery({
            workspace,
            entityDefinitionId: step.entityDefinitionId,
            attributeDefinitionId: step.attributeDefinitionId,
            entityInstanceId: id,
          }),
          enabled,
        }))
      : [],
  });
  const done = Boolean(step) && results.every((r) => r.data !== undefined);
  const dataKey = results.map((r) => r.dataUpdatedAt).join(',');
  return useMemo(() => {
    const values = results.flatMap((r) => (r.data?.values ?? []) as AttributeValue[]);
    const next = values
      .map((v) => (v.value as { entityInstanceId?: string } | null)?.entityInstanceId)
      .filter((id): id is string => typeof id === 'string');
    return { values, next, done, error: results.find((r) => r.error)?.error ?? null };
  }, [dataKey, done]);
}

// ---- record titles -------------------------------------------------------------------------------------------------

/** The record label attribute: the object's display path (epithet), else a `name` attribute (A §4.3). */
export function titleAttributeOf(
  object: { epithetPath?: Path | null },
  attributes: AttributeDefinition[],
): AttributeDefinition | undefined {
  const fromPath = object.epithetPath?.[0]?.attributeDefinitionId;
  return attributes.find((a) => a.id === fromPath) ?? attributes.find((a) => a.apiSlug === 'name');
}

export function titleText(attribute: AttributeDefinition | undefined, values: AttributeValue[] | undefined): string {
  const v = values?.[0]?.value;
  if (!attribute || v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  const o = v as Record<string, unknown>;
  if (attribute.type === 'personal-name') {
    const full = typeof o.fullName === 'string' ? o.fullName : '';
    return full || [o.firstName, o.lastName].filter((x) => typeof x === 'string' && x).join(' ');
  }
  return formatValue(attribute, v);
}

// ---- reads outside React (clipboard, export) ---------------------------------------------------------------------------

/** Cached values (overlay applied) of a cell, or undefined when not loaded yet. */
export function cachedValues(
  workspace: WorkspaceRef,
  entityDefinitionId: string,
  attributeId: string,
  recordId: string,
): AttributeValue[] | undefined {
  const entry = appQueue().get(valueOverlayKey(recordId, attributeId));
  const server = queryClient.getQueryData<{ values: AttributeValue[] }>(
    keys.values(workspace.id, entityDefinitionId, attributeId, recordId),
  )?.values;
  if (entry) return overlayValues(entry.value, server);
  return server;
}

/** Loads (batched) the values of one attribute for many records; path columns resolve hop by hop. */
export async function loadPathValues(
  workspace: WorkspaceRef,
  path: Path,
  recordIds: string[],
): Promise<Map<string, AttributeValue[]>> {
  const out = new Map<string, AttributeValue[]>();
  let frontier = new Map<string, string[]>(recordIds.map((id) => [id, [id]]));
  for (let hop = 0; hop < path.length; hop++) {
    const step = path[hop] as Path[number];
    const unique = [...new Set([...frontier.values()].flat())];
    const loaded = await Promise.all(
      unique.map((id) =>
        valuesLoader
          .load({
            workspace,
            entityDefinitionId: step.entityDefinitionId,
            attributeDefinitionId: step.attributeDefinitionId,
            entityInstanceId: id,
          })
          .then((v) => v as AttributeValue[])
          .catch(() => [] as AttributeValue[]),
      ),
    );
    const byId = new Map(unique.map((id, i) => [id, loaded[i] ?? []]));
    if (hop === path.length - 1) {
      for (const [root, ids] of frontier)
        out.set(
          root,
          ids.flatMap((id) => byId.get(id) ?? []),
        );
      break;
    }
    const next = new Map<string, string[]>();
    for (const [root, ids] of frontier) {
      next.set(
        root,
        ids.flatMap((id) =>
          (byId.get(id) ?? [])
            .map((v) => (v.value as { entityInstanceId?: string } | null)?.entityInstanceId)
            .filter((x): x is string => typeof x === 'string'),
        ),
      );
    }
    frontier = next;
  }
  return out;
}
