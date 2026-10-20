// Optimistic mutation overlay + queue (D-03, BACKLOG 1.07; CROSS-DOMAIN B.2; internal-api-shapes §2).
//
// Writes are applied to an *overlay* that sits on top of the server cache: the UI reads `get(key)` first and falls
// back to cached server data. The overlay is an external store (subscribe/getSnapshot) consumed through
// useSyncExternalStore. Per key (the coalescing unit, e.g. record × attribute):
//   - at most one write is in flight; a newer write waits behind it;
//   - writes that have not been sent are *coalesced*: the newest input replaces the parked one (Attio's
//     combineParkedWrites), keeping the oldest undo so Undo restores the value from before the burst;
//   - ack → the kind's `onSuccess` reconciles the server copy into the cache, *then* the overlay entry is dropped
//     (no flicker back to the stale value);
//   - retryable failure (network, 408/429/5xx) → backoff retry, paused while offline;
//   - final failure → rollback (the entry is dropped; the UI shows the server value or the next write) and
//     `onFailure` (the app shows a toast with Retry);
//   - a failure the app marks as *holdable* (`shouldHold`, slice 6: a requirement rule refused the write, 422
//     PARTICLE_GATE_VIOLATION) keeps the write in the queue as `held`: it stays visible in the overlay but is not sent
//     again until the user retries it (`release`), replaces it by editing the same key, or `discard`s it.
// Pending writes are persisted (sessionStorage by default: per tab, survives reloads) and resumed after boot; the
// unload guard warns while anything is pending. Undo handles exist for every write that carries an inverse, even
// where the UI shows no Undo (CROSS-DOMAIN B.15).

export type WriteStatus = 'queued' | 'inflight' | 'retrying' | 'held';

export interface InverseWrite<I = unknown> {
  input: I;
  value: unknown;
}

export interface WriteRecord<I = unknown> {
  id: string;
  kind: string;
  key: string;
  input: I;
  /** What the UI shows while the write is pending. */
  value: unknown;
  /** The write that undoes this one (captured at enqueue time from the value it replaced). */
  undo?: InverseWrite<I>;
  status: WriteStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  /** Last error message while retrying. */
  error?: string;
}

export interface MutationKind<I = unknown, R = unknown> {
  run: (input: I, write: WriteRecord<I>) => Promise<R>;
  /** Write the server's copy into the cache before the overlay entry is dropped. */
  onSuccess?: (result: R, write: WriteRecord<I>) => void | Promise<void>;
}

export interface OverlayEntry {
  value: unknown;
  status: WriteStatus;
  writeId: string;
  /** Writes pending for this key (in flight + parked). */
  count: number;
}

export interface EnqueueOptions<I = unknown> {
  kind: string;
  key: string;
  input: I;
  value: unknown;
  undo?: InverseWrite<I>;
  /** Explicit id (e.g. to correlate with a client-minted entity id). */
  id?: string;
}

export interface FailureContext {
  /** Re-enqueue the failed write unchanged. */
  retry: () => string;
}

export interface HoldContext {
  /** Send the held write again. */
  retry: () => void;
  /** Drop the held write (the UI falls back to the server value). */
  discard: () => void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MutationQueueOptions {
  storage?: StorageLike | null;
  storageKey?: string;
  /** Delays between attempts of a retryable write; the last one repeats. */
  retryDelaysMs?: readonly number[];
  /** Attempts before a retryable error becomes final. */
  maxAttempts?: number;
  isRetryable?: (error: unknown) => boolean;
  isOnline?: () => boolean;
  onFailure?: (write: WriteRecord, error: unknown, ctx: FailureContext) => void;
  /** Failures to keep as `held` instead of rolling back (a final, non-retryable error that needs the user). */
  shouldHold?: (error: unknown) => boolean;
  /** A write was held (see `shouldHold`). */
  onHold?: (write: WriteRecord, error: unknown, ctx: HoldContext) => void;
  onSuccess?: (write: WriteRecord, result: unknown) => void;
  newId?: () => string;
  now?: () => number;
  /** Acked writes kept for undo. */
  historySize?: number;
}

type Listener = () => void;

const DEFAULT_RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

let fallbackCounter = 0;
const defaultId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `w-${Date.now().toString(36)}-${(fallbackCounter++).toString(36)}`;

export class MutationQueue {
  private readonly kinds = new Map<string, MutationKind<any, any>>();
  /** Per key, oldest first: [in-flight or next] + at most one parked write. */
  private readonly writes = new Map<string, WriteRecord[]>();
  private readonly history: WriteRecord[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<Listener>();
  private readonly keyListeners = new Map<string, Set<Listener>>();
  private entries = new Map<string, OverlayEntry>();
  private version = 0;
  private started = false;
  private pumpScheduled = false;
  private readonly onlineListener = () => this.pump();

  constructor(private readonly options: MutationQueueOptions = {}) {
    this.restore();
  }

  // ---- registration and lifecycle ------------------------------------------------------------------------------

  register<I, R>(kind: string, definition: MutationKind<I, R>): () => void {
    this.kinds.set(kind, definition as MutationKind<any, any>);
    if (this.started) this.schedulePump();
    return () => {
      if (this.kinds.get(kind) === definition) this.kinds.delete(kind);
    };
  }

  /** Starts sending (call once kinds are registered — restored writes wait until then). */
  start(): void {
    if (this.started) return;
    this.started = true;
    (globalThis as { addEventListener?: (t: string, f: () => void) => void }).addEventListener?.(
      'online',
      this.onlineListener,
    );
    this.schedulePump();
  }

  stop(): void {
    this.started = false;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    (globalThis as { removeEventListener?: (t: string, f: () => void) => void }).removeEventListener?.(
      'online',
      this.onlineListener,
    );
  }

  /** Drops everything (sign-out) including the persisted copy. */
  clear(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.writes.clear();
    this.history.length = 0;
    this.changed(null);
  }

  // ---- reading (external store) --------------------------------------------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Subscribes to one key only (cells subscribe to their own record × attribute). */
  subscribeKey(key: string, listener: Listener): () => void {
    let set = this.keyListeners.get(key);
    if (!set) {
      set = new Set();
      this.keyListeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.keyListeners.delete(key);
    };
  }

  getVersion = (): number => this.version;

  /** The overlay entry of a key (stable reference until the key changes), or undefined. */
  get(key: string): OverlayEntry | undefined {
    return this.entries.get(key);
  }

  pendingCount(): number {
    let n = 0;
    for (const list of this.writes.values()) n += list.length;
    return n;
  }

  hasPending(): boolean {
    return this.writes.size > 0;
  }

  /** Snapshot of pending writes (diagnostics, tests). */
  pending(): WriteRecord[] {
    return [...this.writes.values()].flat().map((w) => ({ ...w }));
  }

  // ---- writing --------------------------------------------------------------------------------------------------

  enqueue<I>(options: EnqueueOptions<I>): string {
    const now = this.now();
    const list = this.writes.get(options.key) ?? [];
    const last = list[list.length - 1];
    if (last && last.status !== 'inflight' && last.kind === options.kind) {
      // Coalesce into the parked write: newest input wins, oldest undo is kept.
      last.input = options.input;
      last.value = options.value;
      last.updatedAt = now;
      last.attempts = 0;
      last.error = undefined;
      if (last.status === 'retrying' || last.status === 'held') {
        this.clearTimer(last.id);
        last.status = 'queued';
      }
      this.changed(options.key);
      this.schedulePump();
      return last.id;
    }
    const write: WriteRecord<I> = {
      id: options.id ?? (this.options.newId ?? defaultId)(),
      kind: options.kind,
      key: options.key,
      input: options.input,
      value: options.value,
      // Behind an in-flight write the caller captures the undo from the overlay value, i.e. the in-flight one.
      undo: options.undo,
      status: 'queued',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    list.push(write as WriteRecord);
    this.writes.set(options.key, list);
    this.changed(options.key);
    this.schedulePump();
    return write.id;
  }

  /**
   * Undoes a write: a parked write is simply dropped (rollback); a sent or acked write gets its inverse enqueued.
   * Returns false when there is nothing to undo.
   */
  undo(writeId: string): boolean {
    for (const [key, list] of this.writes) {
      const index = list.findIndex((w) => w.id === writeId);
      if (index === -1) continue;
      // Only the newest intent for a key can be undone; an older one is superseded by what is parked behind it.
      if (index !== list.length - 1) return false;
      const write = list[index] as WriteRecord;
      if (write.status !== 'inflight') {
        this.clearTimer(write.id);
        list.splice(index, 1);
        if (list.length === 0) this.writes.delete(key);
        this.changed(key);
        return true;
      }
      if (!write.undo) return false;
      this.enqueue({ kind: write.kind, key: write.key, input: write.undo.input, value: write.undo.value });
      return true;
    }
    const done = this.history.find((w) => w.id === writeId);
    // A newer write for the key supersedes the acked one.
    if (!done?.undo || this.writes.has(done.key)) return false;
    this.enqueue({ kind: done.kind, key: done.key, input: done.undo.input, value: done.undo.value });
    return true;
  }

  /** Sends a held write again (nothing happens for other writes). */
  release(writeId: string): boolean {
    for (const list of this.writes.values()) {
      const write = list.find((w) => w.id === writeId);
      if (!write) continue;
      if (write.status !== 'held') return false;
      write.status = 'queued';
      write.attempts = 0;
      write.error = undefined;
      this.changed(write.key);
      this.schedulePump();
      return true;
    }
    return false;
  }

  /** Drops a held write (rollback to the server value). Returns false when there is no such write. */
  discard(writeId: string): boolean {
    for (const list of this.writes.values()) {
      const write = list.find((w) => w.id === writeId);
      if (!write) continue;
      this.remove(write);
      this.schedulePump();
      return true;
    }
    return false;
  }

  // ---- processing -----------------------------------------------------------------------------------------------

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (!this.started) return;
    if (this.options.isOnline && !this.options.isOnline()) return;
    for (const list of this.writes.values()) {
      const head = list[0];
      if (head && head.status === 'queued' && this.kinds.has(head.kind)) this.send(head);
    }
  }

  private send(write: WriteRecord): void {
    const kind = this.kinds.get(write.kind);
    if (!kind) return;
    write.status = 'inflight';
    write.attempts += 1;
    this.changed(write.key);
    // Snapshot of what is being sent: a newer enqueue cannot touch an in-flight record (it parks behind it).
    const sent = { ...write };
    let promise: Promise<unknown>;
    try {
      promise = Promise.resolve(kind.run(write.input, sent));
    } catch (err) {
      promise = Promise.reject(err);
    }
    promise.then(
      async (result) => {
        try {
          await kind.onSuccess?.(result, sent);
        } catch {
          // reconciliation is best-effort; the realtime invalidation refetches anyway
        }
        this.remove(write);
        if (write.undo) {
          this.history.push({ ...sent, status: 'queued' });
          const max = this.options.historySize ?? 50;
          if (this.history.length > max) this.history.splice(0, this.history.length - max);
        }
        this.options.onSuccess?.(sent, result);
        this.schedulePump();
      },
      (error) => this.failed(write, error),
    );
  }

  private failed(write: WriteRecord, error: unknown): void {
    if (!this.isTracked(write)) return; // cleared meanwhile (sign-out)
    const retryable = this.options.isRetryable?.(error) ?? false;
    const maxAttempts = this.options.maxAttempts ?? 6;
    if (retryable && write.attempts < maxAttempts) {
      write.status = 'retrying';
      write.error = error instanceof Error ? error.message : String(error);
      const delays = this.options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
      const delay = delays[Math.min(write.attempts - 1, delays.length - 1)] ?? 30_000;
      this.timers.set(
        write.id,
        setTimeout(() => {
          this.timers.delete(write.id);
          if (!this.isTracked(write) || write.status !== 'retrying') return;
          write.status = 'queued';
          this.changed(write.key);
          this.pump();
        }, delay),
      );
      this.changed(write.key);
      return;
    }
    if (!retryable && this.options.shouldHold?.(error)) {
      write.status = 'held';
      write.error = error instanceof Error ? error.message : String(error);
      this.changed(write.key);
      this.options.onHold?.({ ...write }, error, {
        retry: () => this.release(write.id),
        discard: () => this.discard(write.id),
      });
      return;
    }
    // Final: roll back and let the app offer Retry.
    const failed = { ...write };
    this.remove(write);
    this.options.onFailure?.(failed, error, {
      retry: () =>
        this.enqueue({
          kind: failed.kind,
          key: failed.key,
          input: failed.input,
          value: failed.value,
          undo: failed.undo,
        }),
    });
    this.schedulePump();
  }

  private isTracked(write: WriteRecord): boolean {
    return this.writes.get(write.key)?.includes(write) ?? false;
  }

  private remove(write: WriteRecord): void {
    const list = this.writes.get(write.key);
    if (!list) return;
    const index = list.indexOf(write);
    if (index === -1) return;
    list.splice(index, 1);
    if (list.length === 0) this.writes.delete(write.key);
    this.clearTimer(write.id);
    this.changed(write.key);
  }

  private clearTimer(id: string): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  // ---- change notification and persistence -------------------------------------------------------------------

  private changed(key: string | null): void {
    const next = new Map(this.entries);
    const keysToUpdate = key === null ? new Set([...this.entries.keys(), ...this.writes.keys()]) : new Set([key]);
    for (const k of keysToUpdate) {
      const list = this.writes.get(k);
      const newest = list?.[list.length - 1];
      if (!list || !newest) {
        next.delete(k);
        continue;
      }
      const prev = this.entries.get(k);
      const status = list[0]?.status ?? newest.status;
      if (
        prev &&
        prev.writeId === newest.id &&
        Object.is(prev.value, newest.value) &&
        prev.status === status &&
        prev.count === list.length
      ) {
        continue;
      }
      next.set(k, { value: newest.value, status, writeId: newest.id, count: list.length });
    }
    this.entries = next;
    this.version += 1;
    this.persist();
    for (const l of this.listeners) l();
    if (key === null) for (const set of this.keyListeners.values()) for (const l of set) l();
    else for (const l of this.keyListeners.get(key) ?? []) l();
  }

  private persist(): void {
    const { storage, storageKey } = this.options;
    if (!storage || !storageKey) return;
    try {
      const all = [...this.writes.values()].flat();
      if (all.length === 0) storage.removeItem(storageKey);
      else storage.setItem(storageKey, JSON.stringify(all));
    } catch {
      // storage full / unavailable: writes still run, only reload-survival is lost
    }
  }

  private restore(): void {
    const { storage, storageKey } = this.options;
    if (!storage || !storageKey) return;
    let raw: string | null = null;
    try {
      raw = storage.getItem(storageKey);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const records = JSON.parse(raw) as WriteRecord[];
      for (const r of records) {
        if (!r || typeof r.key !== 'string' || typeof r.kind !== 'string' || typeof r.id !== 'string') continue;
        // An in-flight write may or may not have reached the server: resend (creates and value PUTs are
        // idempotent by client id, I3).
        const write: WriteRecord = { ...r, status: 'queued', attempts: 0 };
        const list = this.writes.get(write.key) ?? [];
        list.push(write);
        this.writes.set(write.key, list);
      }
      this.changed(null);
    } catch {
      storage.removeItem(storageKey);
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}

/** Installs the "unsaved work" guard while the queue has pending writes (internal-api-shapes §2 loss prevention). */
export function installUnloadGuard(
  queue: Pick<MutationQueue, 'hasPending'>,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!queue.hasPending()) return;
    event.preventDefault();
    // Legacy browsers show a generic message; the text itself is not displayed by modern ones.
    event.returnValue = 'Your changes have not been saved yet.';
  };
  target.addEventListener('beforeunload', onBeforeUnload);
  return () => target.removeEventListener('beforeunload', onBeforeUnload);
}
