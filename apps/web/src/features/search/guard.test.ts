import { describe, expect, it } from 'vitest';
import { nextRequestSeq, SearchGuard } from './guard';

describe('search stale-response guard', () => {
  it('numbers requests monotonically', () => {
    const a = nextRequestSeq();
    const b = nextRequestSeq();
    expect(b).toBe(a + 1);
  });

  it('drops a response older than the newest applied one', () => {
    const guard = new SearchGuard();
    const [s1, s2, s3] = [nextRequestSeq(), nextRequestSeq(), nextRequestSeq()];
    // The answers arrive out of order: 1, 3, then the slow 2.
    expect(guard.accept(s1)).toBe(true);
    expect(guard.accept(s3)).toBe(true);
    expect(guard.accept(s2)).toBe(false);
    expect(guard.appliedSeq).toBe(s3);
  });

  it('accepts a repeated sequence number (the same response applied twice)', () => {
    const guard = new SearchGuard();
    const s = nextRequestSeq();
    expect(guard.accept(s)).toBe(true);
    expect(guard.accept(s)).toBe(true);
  });
});
