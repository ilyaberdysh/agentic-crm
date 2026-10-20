// React bindings for the optimistic overlay (useSyncExternalStore).
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { installUnloadGuard, type MutationQueue, type OverlayEntry } from './queue';

/** The overlay entry of one key (re-renders only when that key changes). */
export function useOverlayEntry(queue: MutationQueue, key: string | null): OverlayEntry | undefined {
  const subscribe = useCallback(
    (listener: () => void) => (key ? queue.subscribeKey(key, listener) : () => {}),
    [queue, key],
  );
  const get = useCallback(() => (key ? queue.get(key) : undefined), [queue, key]);
  return useSyncExternalStore(subscribe, get, get);
}

export interface OptimisticValue<T> {
  value: T;
  /** A write for this key is queued, in flight or retrying (per-attribute pending indicator). */
  isPending: boolean;
  /** 'retrying' after a retryable failure (offline, 5xx). */
  status: OverlayEntry['status'] | 'idle';
}

/** Server value overlaid with the newest pending write of `key`. */
export function useOptimisticValue<T>(queue: MutationQueue, key: string | null, serverValue: T): OptimisticValue<T> {
  const entry = useOverlayEntry(queue, key);
  return entry
    ? { value: entry.value as T, isPending: entry.status !== 'held', status: entry.status }
    : { value: serverValue, isPending: false, status: 'idle' };
}

/** Number of writes not yet acknowledged (all keys). */
export function usePendingWriteCount(queue: MutationQueue): number {
  return useSyncExternalStore(
    queue.subscribe,
    () => queue.pendingCount(),
    () => 0,
  );
}

/** Warns before unload while writes are pending. */
export function useUnloadGuard(queue: MutationQueue): void {
  useEffect(() => installUnloadGuard(queue), [queue]);
}
