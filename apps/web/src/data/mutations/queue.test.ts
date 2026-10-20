import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installUnloadGuard, MutationQueue, type StorageLike, type WriteRecord } from './queue';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flushes microtasks (pump scheduling, promise reactions). */
const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

class HttpLikeError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}
const retryable = (e: unknown) => e instanceof HttpLikeError && (e.status === 0 || e.status >= 500);

let ids = 0;
const newId = () => `w${++ids}`;

describe('MutationQueue overlay', () => {
  beforeEach(() => {
    ids = 0;
  });

  it('shows the optimistic value with per-key pending state until the server acks, then reconciles', async () => {
    const calls: Array<{ input: unknown; d: Deferred<string> }> = [];
    const reconciled: string[] = [];
    const queue = new MutationQueue({ newId });
    queue.register<{ v: string }, string>('values.put', {
      run: (input) => {
        const d = deferred<string>();
        calls.push({ input, d });
        return d.promise;
      },
      onSuccess: (result) => {
        // Reconciliation happens before the overlay entry disappears.
        expect(queue.get('value:r1:a1')).toBeDefined();
        reconciled.push(result);
      },
    });
    queue.start();

    queue.enqueue({ kind: 'values.put', key: 'value:r1:a1', input: { v: 'Acme' }, value: 'Acme' });
    expect(queue.get('value:r1:a1')).toMatchObject({ value: 'Acme', status: 'queued', count: 1 });
    expect(queue.get('value:r1:a2')).toBeUndefined();
    await tick();
    expect(queue.get('value:r1:a1')?.status).toBe('inflight');
    expect(calls).toHaveLength(1);

    calls[0]?.d.resolve('server:Acme');
    await tick();
    expect(reconciled).toEqual(['server:Acme']);
    expect(queue.get('value:r1:a1')).toBeUndefined();
    expect(queue.hasPending()).toBe(false);
  });

  it('coalesces writes per key: one in flight, the parked one takes the newest input', async () => {
    const sent: unknown[] = [];
    const pending: Deferred<string>[] = [];
    const queue = new MutationQueue({ newId });
    queue.register<{ v: string }, string>('values.put', {
      run: (input) => {
        sent.push(input);
        const d = deferred<string>();
        pending.push(d);
        return d.promise;
      },
    });
    queue.start();

    queue.enqueue({ kind: 'values.put', key: 'k', input: { v: 'a' }, value: 'a' });
    await tick(); // 'a' in flight
    const idB = queue.enqueue({ kind: 'values.put', key: 'k', input: { v: 'ab' }, value: 'ab' });
    const idC = queue.enqueue({ kind: 'values.put', key: 'k', input: { v: 'abc' }, value: 'abc' });
    expect(idC).toBe(idB); // coalesced into the parked write
    expect(queue.get('k')).toMatchObject({ value: 'abc', count: 2, status: 'inflight' });
    expect(sent).toEqual([{ v: 'a' }]);

    pending[0]?.resolve('ok');
    await tick();
    expect(sent).toEqual([{ v: 'a' }, { v: 'abc' }]);
    pending[1]?.resolve('ok');
    await tick();
    expect(queue.get('k')).toBeUndefined();
  });

  it('runs different keys concurrently', async () => {
    const sent: string[] = [];
    const queue = new MutationQueue({ newId });
    queue.register<string, void>('values.put', {
      run: (input) => {
        sent.push(input);
        return new Promise(() => {});
      },
    });
    queue.start();
    queue.enqueue({ kind: 'values.put', key: 'a', input: 'A', value: 1 });
    queue.enqueue({ kind: 'values.put', key: 'b', input: 'B', value: 2 });
    await tick();
    expect(sent.sort()).toEqual(['A', 'B']);
  });

  it('rolls back on a final failure and offers Retry with the same write', async () => {
    const failures: Array<{ write: WriteRecord; retry: () => string }> = [];
    let fail = true;
    const sent: unknown[] = [];
    const queue = new MutationQueue({
      newId,
      isRetryable: retryable,
      onFailure: (write, _error, ctx) => failures.push({ write, retry: ctx.retry }),
    });
    queue.register<{ v: string }, string>('values.put', {
      run: async (input) => {
        sent.push(input);
        if (fail) throw new HttpLikeError(400);
        return 'ok';
      },
    });
    queue.start();

    queue.enqueue({ kind: 'values.put', key: 'k', input: { v: 'bad' }, value: 'bad' });
    expect(queue.get('k')?.value).toBe('bad');
    await tick();
    expect(queue.get('k')).toBeUndefined(); // rolled back to the server value
    expect(failures).toHaveLength(1);
    expect(failures[0]?.write.input).toEqual({ v: 'bad' });

    fail = false;
    failures[0]?.retry();
    expect(queue.get('k')?.value).toBe('bad');
    await tick();
    expect(sent).toEqual([{ v: 'bad' }, { v: 'bad' }]);
    expect(queue.get('k')).toBeUndefined();
  });

  describe('retries', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries retryable errors with backoff, keeping the optimistic value', async () => {
      let attempts = 0;
      const onFailure = vi.fn();
      const queue = new MutationQueue({ newId, isRetryable: retryable, retryDelaysMs: [100, 200], onFailure });
      queue.register<string, string>('values.put', {
        run: async () => {
          attempts += 1;
          if (attempts < 3) throw new HttpLikeError(503);
          return 'ok';
        },
      });
      queue.start();
      queue.enqueue({ kind: 'values.put', key: 'k', input: 'x', value: 'x' });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
      expect(queue.get('k')).toMatchObject({ value: 'x', status: 'retrying' });
      await vi.advanceTimersByTimeAsync(100);
      expect(attempts).toBe(2);
      await vi.advanceTimersByTimeAsync(200);
      expect(attempts).toBe(3);
      expect(queue.get('k')).toBeUndefined();
      expect(onFailure).not.toHaveBeenCalled();
    });

    it('gives up after maxAttempts and rolls back', async () => {
      const onFailure = vi.fn();
      const queue = new MutationQueue({
        newId,
        isRetryable: retryable,
        retryDelaysMs: [10],
        maxAttempts: 2,
        onFailure,
      });
      queue.register<string, string>('values.put', {
        run: async () => {
          throw new HttpLikeError(500);
        },
      });
      queue.start();
      queue.enqueue({ kind: 'values.put', key: 'k', input: 'x', value: 'x' });
      await vi.advanceTimersByTimeAsync(50);
      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(queue.get('k')).toBeUndefined();
    });

    it('waits while offline and resumes on the online event', async () => {
      let online = false;
      const sent: string[] = [];
      const queue = new MutationQueue({ newId, isOnline: () => online });
      queue.register<string, string>('values.put', {
        run: async (input) => {
          sent.push(input);
          return 'ok';
        },
      });
      const target = new EventTarget();
      vi.stubGlobal('addEventListener', target.addEventListener.bind(target));
      vi.stubGlobal('removeEventListener', target.removeEventListener.bind(target));
      queue.start();
      queue.enqueue({ kind: 'values.put', key: 'k', input: 'x', value: 'x' });
      await vi.advanceTimersByTimeAsync(10);
      expect(sent).toEqual([]);
      expect(queue.get('k')?.status).toBe('queued');
      online = true;
      target.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
      expect(sent).toEqual(['x']);
      vi.unstubAllGlobals();
    });
  });

  it('undo drops a parked write, and enqueues the inverse of an acked one', async () => {
    const sent: string[] = [];
    const queue = new MutationQueue({ newId });
    queue.register<string, string>('values.put', {
      run: async (input) => {
        sent.push(input);
        return 'ok';
      },
    });
    // Not started yet: the write stays parked.
    const parked = queue.enqueue({ kind: 'values.put', key: 'k', input: 'new', value: 'new' });
    expect(queue.undo(parked)).toBe(true);
    expect(queue.get('k')).toBeUndefined();

    queue.start();
    const id = queue.enqueue({
      kind: 'values.put',
      key: 'k',
      input: 'v2',
      value: 'v2',
      undo: { input: 'v1', value: 'v1' },
    });
    await tick();
    expect(sent).toEqual(['v2']);
    expect(queue.undo(id)).toBe(true);
    expect(queue.get('k')?.value).toBe('v1');
    await tick();
    expect(sent).toEqual(['v2', 'v1']);
    expect(queue.undo('unknown')).toBe(false);
  });

  it('persists pending writes and restores them (as queued) after a reload', async () => {
    const storage = new MemoryStorage();
    const first = new MutationQueue({ newId, storage, storageKey: 'q' });
    first.register<string, string>('values.put', { run: () => new Promise(() => {}) });
    first.start();
    first.enqueue({ kind: 'values.put', key: 'k', input: 'x', value: 'x' });
    await tick();
    expect(first.get('k')?.status).toBe('inflight');
    expect(JSON.parse(storage.getItem('q') ?? '[]')).toHaveLength(1);

    // "Reload": a new queue over the same storage shows the write before any kind is registered.
    const sent: string[] = [];
    const second = new MutationQueue({ newId, storage, storageKey: 'q' });
    expect(second.get('k')).toMatchObject({ value: 'x', status: 'queued' });
    second.register<string, string>('values.put', {
      run: async (input) => {
        sent.push(input);
        return 'ok';
      },
    });
    second.start();
    await tick();
    expect(sent).toEqual(['x']);
    expect(second.get('k')).toBeUndefined();
    expect(storage.getItem('q')).toBeNull();
  });

  it('notifies key subscribers only for their key and keeps entry identity stable', async () => {
    const queue = new MutationQueue({ newId });
    const a = vi.fn();
    const b = vi.fn();
    queue.subscribeKey('a', a);
    queue.subscribeKey('b', b);
    queue.enqueue({ kind: 'values.put', key: 'a', input: 1, value: 1 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    const entry = queue.get('a');
    queue.enqueue({ kind: 'values.put', key: 'b', input: 2, value: 2 });
    expect(queue.get('a')).toBe(entry);
  });

  it('clear() drops everything (sign-out)', () => {
    const storage = new MemoryStorage();
    const queue = new MutationQueue({ newId, storage, storageKey: 'q' });
    queue.enqueue({ kind: 'values.put', key: 'a', input: 1, value: 1 });
    queue.clear();
    expect(queue.hasPending()).toBe(false);
    expect(storage.getItem('q')).toBeNull();
  });
});

describe('MutationQueue held writes (requirement rules, slice 6)', () => {
  class RuleError extends Error {
    readonly code = 'PARTICLE_GATE_VIOLATION';
  }
  const holdable = (e: unknown) => e instanceof RuleError;

  beforeEach(() => {
    ids = 0;
  });

  it('keeps a refused write held: its value stays visible, nothing is resent, onFailure is not called', async () => {
    const run = vi.fn(async () => {
      throw new RuleError('Updates required');
    });
    const held: Array<{ write: WriteRecord; error: unknown }> = [];
    const failures: unknown[] = [];
    const queue = new MutationQueue({
      newId,
      shouldHold: holdable,
      onHold: (write, error) => held.push({ write, error }),
      onFailure: (_w, e) => failures.push(e),
    });
    queue.register('values.put', { run });
    queue.start();
    queue.enqueue({ kind: 'values.put', key: 'k', input: 5, value: 5 });
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(held).toHaveLength(1);
    expect(failures).toHaveLength(0);
    expect(queue.get('k')).toMatchObject({ value: 5, status: 'held' });
    expect(queue.hasPending()).toBe(true);
    // Held writes are not sent again on their own.
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('release() sends the held write once more; discard() drops it', async () => {
    let fail = true;
    const run = vi.fn(async () => {
      if (fail) throw new RuleError('Updates required');
      return 'ok';
    });
    let ctx: { retry(): void; discard(): void } | null = null;
    const queue = new MutationQueue({
      newId,
      shouldHold: holdable,
      onHold: (_w, _e, c) => {
        ctx = c;
      },
    });
    queue.register('values.put', { run });
    queue.start();
    queue.enqueue({ kind: 'values.put', key: 'k', input: 5, value: 5 });
    await tick();
    expect(queue.get('k')?.status).toBe('held');
    fail = false;
    (ctx as unknown as { retry(): void }).retry();
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
    expect(queue.get('k')).toBeUndefined();

    fail = true;
    queue.enqueue({ kind: 'values.put', key: 'k2', input: 6, value: 6 });
    await tick();
    expect(queue.get('k2')?.status).toBe('held');
    (ctx as unknown as { discard(): void }).discard();
    expect(queue.get('k2')).toBeUndefined();
    expect(queue.hasPending()).toBe(false);
  });

  it('a newer edit of the same key replaces the held write and is sent', async () => {
    const run = vi.fn(async (input: number) => {
      if (input < 10) throw new RuleError('Updates required');
      return input;
    });
    const queue = new MutationQueue({ newId, shouldHold: holdable });
    queue.register<number, number>('values.put', { run });
    queue.start();
    queue.enqueue({ kind: 'values.put', key: 'k', input: 5, value: 5 });
    await tick();
    expect(queue.get('k')?.status).toBe('held');
    queue.enqueue({ kind: 'values.put', key: 'k', input: 30, value: 30 });
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
    expect(queue.get('k')).toBeUndefined();
  });

  it('other errors still roll back with onFailure', async () => {
    const failures: unknown[] = [];
    const queue = new MutationQueue({
      newId,
      shouldHold: holdable,
      onFailure: (_w, e) => failures.push(e),
    });
    queue.register('values.put', {
      run: async () => {
        throw new HttpLikeError(403);
      },
    });
    queue.start();
    queue.enqueue({ kind: 'values.put', key: 'k', input: 1, value: 1 });
    await tick();
    expect(failures).toHaveLength(1);
    expect(queue.get('k')).toBeUndefined();
  });
});

describe('installUnloadGuard', () => {
  it('blocks unload only while writes are pending', () => {
    const target = new EventTarget();
    let pending = false;
    const remove = installUnloadGuard({ hasPending: () => pending }, target as unknown as Window);
    const fire = () => {
      const event = new Event('beforeunload', { cancelable: true }) as Event & { returnValue?: unknown };
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(fire()).toBe(false);
    pending = true;
    expect(fire()).toBe(true);
    remove();
    expect(fire()).toBe(false);
  });
});
