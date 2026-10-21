// Batching loader (D-03; Batches point reads: entity instances 50 ms / ≤1000 ids per workspace + definition,
// attribute values 50 ms / ≤1337 per workspace + definition + attribute — internal-api-shapes).
// Point reads issued within the window are grouped by `groupOf(key)`, de-duplicated by `idOf(key)` and fetched with
// one `fetchBatch` call per group; each caller gets its own entry. Query functions call `load` so many cells
// asking for different records within one frame cost one request.

export interface BatchLoaderOptions<K, V> {
  /** Collect window in ms (the collection window is 50; we default to 25, clamped to 20–50). */
  windowMs?: number;
  /** Flush a group early once it holds this many distinct ids. */
  maxBatchSize?: number;
  /** Requests in different groups never share a batch (e.g. `${workspaceId}:${definitionId}`). */
  groupOf?: (key: K) => string;
  /** Identity for de-duplication within a batch. */
  idOf?: (key: K) => string;
  /** Fetches one batch; returns a value or an Error per requested id (missing ids reject with NotFoundError). */
  fetchBatch: (keys: K[]) => Promise<Map<string, V | Error>>;
}

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`Not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

interface Waiter<V> {
  resolve: (value: V) => void;
  reject: (error: unknown) => void;
}

interface PendingGroup<K, V> {
  keys: Map<string, K>;
  waiters: Map<string, Waiter<V>[]>;
  timer: ReturnType<typeof setTimeout> | null;
}

export class BatchLoader<K, V> {
  private readonly windowMs: number;
  private readonly maxBatchSize: number;
  private readonly groupOf: (key: K) => string;
  private readonly idOf: (key: K) => string;
  private readonly groups = new Map<string, PendingGroup<K, V>>();

  constructor(private readonly options: BatchLoaderOptions<K, V>) {
    this.windowMs = Math.min(50, Math.max(20, options.windowMs ?? 25));
    this.maxBatchSize = Math.max(1, options.maxBatchSize ?? 1000);
    this.groupOf = options.groupOf ?? (() => '');
    this.idOf = options.idOf ?? ((key) => String(key));
  }

  load(key: K): Promise<V> {
    const groupKey = this.groupOf(key);
    let group = this.groups.get(groupKey);
    if (!group) {
      group = { keys: new Map(), waiters: new Map(), timer: null };
      this.groups.set(groupKey, group);
    }
    const id = this.idOf(key);
    const pending = group;
    const promise = new Promise<V>((resolve, reject) => {
      const list = pending.waiters.get(id);
      if (list) list.push({ resolve, reject });
      else pending.waiters.set(id, [{ resolve, reject }]);
    });
    group.keys.set(id, key);
    if (group.keys.size >= this.maxBatchSize) this.flush(groupKey);
    else if (!group.timer) group.timer = setTimeout(() => this.flush(groupKey), this.windowMs);
    return promise;
  }

  loadMany(keys: K[]): Promise<V[]> {
    return Promise.all(keys.map((k) => this.load(k)));
  }

  /** Sends whatever is collected for a group now. */
  flush(groupKey: string): void {
    const group = this.groups.get(groupKey);
    if (!group) return;
    this.groups.delete(groupKey);
    if (group.timer) clearTimeout(group.timer);
    const ids = [...group.keys.keys()];
    const batchKeys = ids.map((id) => group.keys.get(id) as K);
    let request: Promise<Map<string, V | Error>>;
    try {
      request = this.options.fetchBatch(batchKeys);
    } catch (err) {
      request = Promise.reject(err);
    }
    request.then(
      (results) => {
        for (const id of ids) {
          const result = results.get(id);
          const waiters = group.waiters.get(id) ?? [];
          for (const w of waiters) {
            if (result === undefined) w.reject(new NotFoundError(id));
            else if (result instanceof Error) w.reject(result);
            else w.resolve(result);
          }
        }
      },
      (error) => {
        for (const waiters of group.waiters.values()) for (const w of waiters) w.reject(error);
      },
    );
  }

  /** Number of groups waiting for their window (for tests and diagnostics). */
  get pendingGroups(): number {
    return this.groups.size;
  }
}
