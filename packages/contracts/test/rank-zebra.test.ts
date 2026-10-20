import { describe, expect, it } from 'vitest';
import { isValidRank, rankAfter, rankBefore, rankBetween, rankFromDecimal, rankSequence } from '../src/rank.ts';
import {
  isValidZebra,
  zebraClamp,
  zebraContains,
  zebraFromIndices,
  zebraSize,
  zebraToggle,
  zebraUnion,
} from '../src/zebra.ts';

describe('ranks (X-01)', () => {
  it('produces keys strictly between neighbours, in string order', () => {
    let keys = [rankAfter(null)];
    // Insert repeatedly at the front, the end and in the middle.
    for (let i = 0; i < 300; i++) {
      const pos = i % 3;
      if (pos === 0) keys = [rankBefore(keys[0] ?? null), ...keys];
      else if (pos === 1) keys = [...keys, rankAfter(keys.at(-1) ?? null)];
      else {
        const m = Math.floor(keys.length / 2);
        keys = [...keys.slice(0, m), rankBetween(keys[m - 1] ?? null, keys[m] ?? null), ...keys.slice(m)];
      }
    }
    expect(keys.every(isValidRank)).toBe(true);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('jitters without leaving the interval and rejects bad input', () => {
    for (let i = 0; i < 200; i++) {
      const k = rankBetween('a', 'b', { jitter: true });
      expect(k > 'a' && k < 'b').toBe(true);
      expect(isValidRank(k)).toBe(true);
    }
    expect(() => rankBetween('b', 'a')).toThrow();
    expect(() => rankBetween('a0', null)).toThrow();
    expect(rankSequence(5)).toEqual([...rankSequence(5)].sort());
    expect(rankFromDecimal('0.5')).toBe('i');
    expect(rankFromDecimal('0.25') < rankFromDecimal('0.5')).toBe(true);
  });
});

describe('zebra selections', () => {
  it('builds, toggles, unites and clamps interval edges', () => {
    const edges = zebraFromIndices([5, 1, 2, 3, 9]);
    expect(edges).toEqual([1, 4, 5, 6, 9, 10]);
    expect(zebraSize(edges)).toBe(5);
    expect(zebraContains(edges, 3)).toBe(true);
    expect(zebraContains(edges, 4)).toBe(false);
    expect(zebraToggle(edges, 2)).toEqual([1, 2, 3, 4, 5, 6, 9, 10]);
    expect(zebraToggle(edges, 4)).toEqual([1, 6, 9, 10]);
    expect(zebraUnion([0, 2], [1, 5, 7, 8])).toEqual([0, 5, 7, 8]);
    expect(zebraClamp([0, 1_000_000], 1205)).toEqual([0, 1205]);
    expect(isValidZebra([0, 3, 3, 5])).toBe(false);
    expect(isValidZebra([0, 3, 4, 5])).toBe(true);
  });
});
