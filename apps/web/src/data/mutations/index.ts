// The app's mutation queue: one per tab, persisted in sessionStorage per user, failures surfaced as toasts with
// Retry (D-03, CROSS-DOMAIN B.2/B.15). Kinds for record values are registered here; each reconciles the overlay with
// the canonical state of the mutation response and marks it covered up to the response seq, so the realtime echo of
// our own write does not refetch.
import type { PutValueInput, RetireValueInput } from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { newId } from '../../lib/ids';
import { keys, valueOverlayKey } from '../keys';
import { queryClient } from '../queryClient';
import { markCovered } from '../realtime/invalidation';
import {
  api,
  errorEnvelopeOf,
  inWorkspace,
  isRetryable,
  noteAcceptAfter,
  type RouterOutputs,
  type WorkspaceRef,
} from '../trpc';
import { type HoldContext, type InverseWrite, MutationQueue, type StorageLike, type WriteRecord } from './queue';

function sessionStore(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Additional-information code of a write refused by a requirement rule. */
export const RULE_VIOLATION_CODE = 'PARTICLE_GATE_VIOLATION';

type HoldHandler = (write: WriteRecord, error: unknown, ctx: HoldContext) => void;
let holdHandler: HoldHandler | null = null;

/** The "Updates required" UI registers itself here; without it a held write just stays visible. */
export function setHoldHandler(handler: HoldHandler | null): void {
  holdHandler = handler;
}

function describe(write: WriteRecord): string {
  return write.kind.startsWith('values.') ? 'Failed to save your change' : 'Failed to save your changes';
}

export function createAppQueue(userId: string): MutationQueue {
  return new MutationQueue({
    storage: sessionStore(),
    storageKey: `ar:mutation-queue:${userId}`,
    isRetryable,
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    newId,
    // A requirement rule refused the write (422): keep it held and show "Updates required" (slice 6, J §7).
    shouldHold: (error) => errorEnvelopeOf(error).code === RULE_VIOLATION_CODE,
    onHold: (write, error, ctx) => holdHandler?.(write, error, ctx),
    onFailure: (write, error, ctx) => {
      toast.error({
        title: describe(write),
        description: errorEnvelopeOf(error).message,
        action: { label: 'Retry', onAction: () => ctx.retry() },
        durationMs: 8000,
      });
    },
  });
}

const queues = new Map<string, MutationQueue>();
/** Before sign-in nothing can be written: callers get an inert queue (no kinds, never started). */
const inert = new MutationQueue();
let activeUserId: string | null = null;

/** Creates (or reuses) the signed-in user's queue, restores its persisted writes and starts sending. */
export function activateAppQueue(userId: string): MutationQueue {
  let queue = queues.get(userId);
  if (!queue) {
    queue = createAppQueue(userId);
    registerRecordKinds(queue);
    queues.set(userId, queue);
  }
  activeUserId = userId;
  queue.start();
  return queue;
}

export function appQueue(): MutationQueue {
  return (activeUserId && queues.get(activeUserId)) || inert;
}

/** Sign-out: drop pending writes (the unload guard has already warned) and the persisted copy. */
export function resetAppQueues(): void {
  for (const q of queues.values()) {
    q.stop();
    q.clear();
  }
  queues.clear();
  activeUserId = null;
}

// ---- record / value kinds -------------------------------------------------------------------------------------

/** Inputs are persisted with the workspace they belong to (the queue outlives route changes and reloads). */
type Scoped<T> = T & { workspace: WorkspaceRef };
type ValuesResult = RouterOutputs['values']['put'];

export const VALUE_KINDS = { put: 'values.put', retire: 'values.retire', set: 'values.set' } as const;

/** Writes the canonical values into the cache and marks the key covered up to the response seq. */
function reconcileValues(
  workspace: WorkspaceRef,
  input: Pick<PutValueInput, 'entityDefinitionId' | 'attributeDefinitionId' | 'entityInstanceId'>,
  result: ValuesResult,
) {
  const key = keys.values(workspace.id, input.entityDefinitionId, input.attributeDefinitionId, input.entityInstanceId);
  queryClient.setQueryData(key, { values: result.values, accurateAt: result.accurateAt });
  markCovered(key, result.seq);
  noteAcceptAfter(workspace.id, result.seq);
}

export function registerRecordKinds(queue: MutationQueue): void {
  queue.register<Scoped<PutValueInput>, ValuesResult>(VALUE_KINDS.put, {
    run: ({ workspace, ...input }) => api.values.put.mutate(input, inWorkspace(workspace)),
    onSuccess: (result, write) => reconcileValues(write.input.workspace, write.input, result),
  });
  queue.register<Scoped<RetireValueInput>, ValuesResult>(VALUE_KINDS.retire, {
    run: ({ workspace, ...input }) => api.values.retire.mutate(input, inWorkspace(workspace)),
    onSuccess: (result, write) => reconcileValues(write.input.workspace, write.input, result),
  });
  queue.register<Scoped<SetValuesInput>, null>(VALUE_KINDS.set, { run: runSetValues });
}

// ---- values.set: the desired current set of one attribute (features/attributes useAttributeWrite) ---------------

/** One value of the desired set: client-minted id (new values) or the id of a current value (kept). */
export interface DesiredValue {
  id: string;
  /** Write form (only sent for values that are not current yet). */
  value: unknown;
  sortOrder: string | null;
}

/**
 * The desired current values of one attribute on one record. Coalescing keeps only the newest set (the queue's
 * newest-wins rule fits set semantics). At send time it is diffed against the cached server values into
 * `values.retire` / `values.put` / `values.reorder` calls (I6: retire + insert, client value ids, I3):
 * - values in `known` (ids the user could see when committing) but not desired are retired — values someone else
 *   added meanwhile are not in `known` and survive;
 * - desired ids that are not current are put (a single-value put replaces the current value server-side);
 * - kept values of a multi-value attribute whose rank changed are reordered.
 */
export interface SetValuesInput {
  entityDefinitionId: string;
  entityInstanceId: string;
  attributeDefinitionId: string;
  isMultiselect: boolean;
  desired: DesiredValue[];
  known: string[];
}

type ValueRow = ValuesResult['values'][number];

async function currentServerValues(workspace: WorkspaceRef, input: SetValuesInput): Promise<ValueRow[]> {
  const key = keys.values(workspace.id, input.entityDefinitionId, input.attributeDefinitionId, input.entityInstanceId);
  const cached = queryClient.getQueryData<{ values: ValueRow[] }>(key);
  if (cached) return cached.values;
  const { values } = await api.values.list.query(
    {
      entityDefinitionId: input.entityDefinitionId,
      attributeDefinitionId: input.attributeDefinitionId,
      entityInstanceIds: [input.entityInstanceId],
    },
    inWorkspace(workspace),
  );
  const entry = values[input.entityInstanceId];
  return entry?.state === 'complete' ? entry.value.values : [];
}

/** The calls that turn `current` into the desired set (pure; unit-tested). */
export function planSetValues(
  current: ReadonlyArray<{ id: string; sortOrder: string | null }>,
  input: Pick<SetValuesInput, 'isMultiselect' | 'desired' | 'known'>,
): Array<
  | { op: 'retire'; id: string }
  | { op: 'put'; id: string; value: unknown; sortOrder: string | null }
  | { op: 'reorder'; id: string; sortOrder: string }
> {
  const currentById = new Map(current.map((v) => [v.id, v]));
  const desiredIds = new Set(input.desired.map((d) => d.id));
  const ops: ReturnType<typeof planSetValues> = [];
  const replacing = !input.isMultiselect && input.desired.some((d) => !currentById.has(d.id));
  if (!replacing) {
    for (const id of input.known) if (currentById.has(id) && !desiredIds.has(id)) ops.push({ op: 'retire', id });
  }
  for (const d of input.desired) {
    const existing = currentById.get(d.id);
    if (!existing) {
      ops.push({ op: 'put', id: d.id, value: d.value, sortOrder: input.isMultiselect ? d.sortOrder : null });
      if (!input.isMultiselect) break; // one value
    } else if (input.isMultiselect && d.sortOrder && existing.sortOrder !== d.sortOrder) {
      ops.push({ op: 'reorder', id: d.id, sortOrder: d.sortOrder });
    }
  }
  return ops;
}

async function runSetValues({ workspace, ...input }: Scoped<SetValuesInput>): Promise<null> {
  const ref = {
    entityDefinitionId: input.entityDefinitionId,
    entityInstanceId: input.entityInstanceId,
    attributeDefinitionId: input.attributeDefinitionId,
  };
  const opts = inWorkspace(workspace);
  for (const op of planSetValues(await currentServerValues(workspace, input), input)) {
    // Each call answers with every current value; reconcile as we go so a later failure leaves the cache truthful.
    const result =
      op.op === 'retire'
        ? await api.values.retire.mutate({ ...ref, attributeValueId: op.id }, opts)
        : op.op === 'put'
          ? await api.values.put.mutate(
              {
                ...ref,
                attributeValueId: op.id,
                value: op.value,
                ...(op.sortOrder ? { sortOrder: op.sortOrder } : {}),
              },
              opts,
            )
          : await api.values.reorder.mutate({ ...ref, attributeValueId: op.id, sortOrder: op.sortOrder }, opts);
    reconcileValues(workspace, ref, result);
  }
  return null;
}

export interface ValueRef {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  entityInstanceId: string;
  attributeDefinitionId: string;
}

/**
 * Optimistically sets a single-value attribute (client-minted value id, I3/I6). `previous` is what the UI showed
 * before, captured for Undo. Returns the write id.
 */
export function putValue(queue: MutationQueue, ref: ValueRef, value: unknown, previous?: { value: unknown }): string {
  const input: Scoped<PutValueInput> = { ...ref, attributeValueId: newId(), value };
  const undo: InverseWrite<Scoped<PutValueInput>> | undefined = previous
    ? { input: { ...ref, attributeValueId: newId(), value: previous.value }, value: previous.value }
    : undefined;
  return queue.enqueue({
    kind: VALUE_KINDS.put,
    key: valueOverlayKey(ref.entityInstanceId, ref.attributeDefinitionId),
    input,
    value,
    undo,
  });
}
