// Ordering ranks (decision X-01, CROSS-DOMAIN B.4): one rank type for every ordered resource — objects, attributes,
// options, stages, views, columns, sorts, multiselect values, later lists, favourites and blocks.
// A rank is a base-36 fraction "0.<digits>" written as its digits over [0-9a-z]; it never ends in '0', so there is
// always room before and after it. Ranks compare with plain string comparison (COLLATE "C" in Postgres), so a
// drag-and-drop writes only the moved item's rank. Used by the client and the server alike.

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const RANK_RE = /^[0-9a-z]*[1-9a-z]$/;

export function isValidRank(rank: string): boolean {
  return RANK_RE.test(rank);
}

function digitAt(s: string, i: number): number {
  const ch = s[i];
  return ch === undefined ? 0 : DIGITS.indexOf(ch);
}

/** Midpoint of the fractions 0.a and 0.b (b === null stands for 1). Requires a < b. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = digitAt(a, 0);
  const db = b === null ? BASE : digitAt(b, 0);
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)] as string;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return (DIGITS[da] as string) + midpoint(a.slice(1), null);
}

function randomSuffix(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const min = i === length - 1 ? 1 : 0; // never end in '0'
    out += DIGITS[min + Math.floor(Math.random() * (BASE - min))];
  }
  return out;
}

export interface RankOptions {
  /** Append 4 random digits (as Attio does) so concurrent inserts at the same position do not collide. */
  jitter?: boolean;
}

/** A rank strictly between `before` and `after` (null = open end). */
export function rankBetween(before: string | null, after: string | null, options: RankOptions = {}): string {
  if (before !== null && !isValidRank(before)) throw new Error(`Invalid rank "${before}"`);
  if (after !== null && !isValidRank(after)) throw new Error(`Invalid rank "${after}"`);
  if (before !== null && after !== null && before >= after) {
    throw new Error(`Rank "${before}" must sort before "${after}"`);
  }
  const mid = midpoint(before ?? '', after);
  if (!options.jitter) return mid;
  const jittered = mid + randomSuffix(4);
  return after === null || jittered < after ? jittered : mid;
}

export const rankAfter = (rank: string | null, options?: RankOptions) => rankBetween(rank, null, options);
export const rankBefore = (rank: string | null, options?: RankOptions) => rankBetween(null, rank, options);

/** `count` ascending ranks between `before` and `after`, as short as possible (balanced bisection). */
export function rankSequence(count: number, before: string | null = null, after: string | null = null): string[] {
  if (count <= 0) return [];
  const mid = rankBetween(before, after);
  const leftCount = Math.floor((count - 1) / 2);
  return [...rankSequence(leftCount, before, mid), mid, ...rankSequence(count - 1 - leftCount, mid, after)];
}

/**
 * Converts a decimal rank ("0.8471…", used by Attio for collections) into a base-36 rank with the same order,
 * for imports. Precision: 10 base-36 digits.
 */
export function rankFromDecimal(decimal: string): string {
  let frac = Number(decimal);
  if (!Number.isFinite(frac) || frac <= 0 || frac >= 1) throw new Error(`Decimal rank out of range: ${decimal}`);
  let out = '';
  for (let i = 0; i < 10 && frac > 0; i++) {
    frac *= BASE;
    const d = Math.floor(frac);
    out += DIGITS[d];
    frac -= d;
  }
  out = out.replace(/0+$/, '');
  return out === '' ? '1' : out;
}
