// "New data" (BACKLOG 9.10; H api §4.6, README §3.7; slice9-server.md "New data rule"). The server emits `report-stale`
// (resourceId = entity definition, scope.attributeDefinitionIds = the changed attributes or null) for definitions some
// saved report depends on. A dataset is stale when such a message has seq > its `freshness.seq`, names a definition
// in `freshness.entityDefinitionIds` and (null attributes, or an intersection with `freshness.attributeDefinitionIds`).
// Messages are remembered for the tab (newest 500 per workspace) so a cell that mounts or finishes loading after the
// message still knows. Clicking "New data" refetches with `acceptAfter` = the newest matching seq.
import type { DatasetFreshness } from '@agentic-crm/contracts';
import type { InvalidationMessage } from '@agentic-crm/realtime';
import { compareSeq } from '@agentic-crm/realtime/client';
import { useSyncExternalStore } from 'react';
import { tapInvalidations } from '../../data/realtime/invalidation';

export interface StaleEvent {
  seq: string;
  entityDefinitionId: string;
  /** null = records added/removed or unknown: every dataset over the definition. */
  attributeDefinitionIds: string[] | null;
}

const MAX_EVENTS = 500;
const events = new Map<string, StaleEvent[]>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** Records a `report-stale` message (the invalidation tap calls this; tests call it directly). */
export function recordStale(message: InvalidationMessage): void {
  if (message.resource !== 'report-stale') return;
  const definition = str(message.scope?.entityDefinitionId) ?? message.resourceId;
  if (!definition) return;
  const attrs = message.scope?.attributeDefinitionIds;
  const event: StaleEvent = {
    seq: message.seq,
    entityDefinitionId: definition,
    attributeDefinitionIds: Array.isArray(attrs) ? attrs.filter((a): a is string => typeof a === 'string') : null,
  };
  const list = events.get(message.workspaceId) ?? [];
  list.push(event);
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
  events.set(message.workspaceId, list);
  emit();
}

/** The newest stale event that makes a dataset with this freshness stale, or null. */
export function staleSeqFor(
  workspaceId: string,
  freshness: Pick<DatasetFreshness, 'seq' | 'entityDefinitionIds' | 'attributeDefinitionIds'> | null | undefined,
  source: ReadonlyMap<string, StaleEvent[]> = events,
): string | null {
  if (!freshness) return null;
  let newest: string | null = null;
  for (const e of source.get(workspaceId) ?? []) {
    if (compareSeq(e.seq, freshness.seq) <= 0) continue;
    if (!freshness.entityDefinitionIds.includes(e.entityDefinitionId)) continue;
    if (
      e.attributeDefinitionIds !== null &&
      !e.attributeDefinitionIds.some((a) => freshness.attributeDefinitionIds.includes(a))
    )
      continue;
    if (newest === null || compareSeq(e.seq, newest) > 0) newest = e.seq;
  }
  return newest;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The seq to refetch with when `freshness` is stale ("New data"), else null. Re-evaluates on every message. */
export function useStaleSeq(
  workspaceId: string,
  freshness: Pick<DatasetFreshness, 'seq' | 'entityDefinitionIds' | 'attributeDefinitionIds'> | null | undefined,
): string | null {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return staleSeqFor(workspaceId, freshness);
}

/** Tests and sign-out. */
export function resetStale(): void {
  events.clear();
  emit();
}

// Registered once when the module is imported (the reports routes import it at boot).
tapInvalidations(recordStale);
