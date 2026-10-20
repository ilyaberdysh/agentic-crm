import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchLoader, NotFoundError } from './batchLoader';

interface Key {
  def: string;
  id: string;
}

describe('BatchLoader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function loader(windowMs = 25, maxBatchSize = 1000) {
    const batches: string[][] = [];
    const l = new BatchLoader<Key, string>({
      windowMs,
      maxBatchSize,
      groupOf: (k) => k.def,
      idOf: (k) => k.id,
      fetchBatch: async (keys) => {
        batches.push(keys.map((k) => `${k.def}/${k.id}`));
        return new Map(keys.filter((k) => k.id !== 'missing').map((k) => [k.id, `value:${k.id}`]));
      },
    });
    return { l, batches };
  }

  it('collects point reads in one window into one request per group, de-duplicated', async () => {
    const { l, batches } = loader();
    const a = l.load({ def: 'companies', id: 'a' });
    const b = l.load({ def: 'companies', id: 'b' });
    const a2 = l.load({ def: 'companies', id: 'a' });
    const p = l.load({ def: 'people', id: 'p' });
    expect(batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(25);
    expect(await Promise.all([a, b, a2, p])).toEqual(['value:a', 'value:b', 'value:a', 'value:p']);
    expect(batches).toEqual([['companies/a', 'companies/b'], ['people/p']]);
  });

  it('clamps the window to 20–50 ms', async () => {
    const { l, batches } = loader(500);
    void l.load({ def: 'd', id: '1' });
    await vi.advanceTimersByTimeAsync(49);
    expect(batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(batches).toHaveLength(1);
  });

  it('flushes early at maxBatchSize', async () => {
    const { l, batches } = loader(25, 2);
    void l.load({ def: 'd', id: '1' });
    void l.load({ def: 'd', id: '2' });
    expect(batches).toHaveLength(1);
    void l.load({ def: 'd', id: '3' });
    await vi.advanceTimersByTimeAsync(25);
    expect(batches).toEqual([['d/1', 'd/2'], ['d/3']]);
  });

  it('rejects missing ids with NotFoundError and batch failures for every caller', async () => {
    const { l } = loader();
    const missing = l.load({ def: 'd', id: 'missing' });
    const expectation = expect(missing).rejects.toBeInstanceOf(NotFoundError);
    await vi.advanceTimersByTimeAsync(25);
    await expectation;

    const failing = new BatchLoader<string, string>({
      fetchBatch: async () => {
        throw new Error('boom');
      },
    });
    const x = failing.load('x');
    const y = failing.load('y');
    const both = Promise.allSettled([x, y]);
    await vi.advanceTimersByTimeAsync(25);
    expect((await both).map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });
});
