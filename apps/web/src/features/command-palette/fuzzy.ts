// Client-side fuzzy matching for the palette's Jump To and quick-action sources (command-palette.md §3.1: Attio uses
// Fuse at threshold 0.4; we score exact > prefix > word prefix > substring > all words > ordered letters, and
// reject the rest).

/** Higher is better; null = no match. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - Math.min(t.length - q.length, 99);
  const wordStart = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(q)}`, 'u').exec(t);
  if (wordStart) return 800 - Math.min(wordStart.index, 99);
  const at = t.indexOf(q);
  if (at >= 0) return 700 - Math.min(at, 99);
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => t.includes(w))) return 600;
  // Ordered letters ("prjct" → "project"): only for longer queries, and the letters may not be spread too thin.
  if (q.length >= 3) {
    const span = subsequenceSpan(q.replace(/\s+/g, ''), t);
    if (span !== null && span <= q.replace(/\s+/g, '').length * 2) return 300 - Math.min(span, 99);
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Length of the shortest window of `text` that contains `query` as an ordered subsequence (null if none). */
function subsequenceSpan(query: string, text: string): number | null {
  let best: number | null = null;
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== query[0]) continue;
    let qi = 1;
    let end = start;
    for (let i = start + 1; i < text.length && qi < query.length; i++) {
      if (text[i] === query[qi]) {
        qi++;
        end = i;
      }
    }
    if (query.length === 1 || qi === query.length) {
      const span = end - start + 1;
      if (best === null || span < best) best = span;
    }
  }
  return best;
}

export interface Fuzzy<T> {
  item: T;
  score: number;
}

/** Items matching `query` (title first, then keywords at a discount), best first; ties keep the input order. */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => { title: string; keywords?: readonly string[] },
): Fuzzy<T>[] {
  const out: Fuzzy<T>[] = [];
  for (const item of items) {
    const { title, keywords = [] } = fields(item);
    let score = fuzzyScore(query, title);
    for (const keyword of keywords) {
      const s = fuzzyScore(query, keyword);
      if (s !== null && (score === null || s - 150 > score)) score = s - 150;
    }
    if (score !== null) out.push({ item, score });
  }
  // Array.prototype.sort is stable: equal scores keep their relative (source) order.
  return out.sort((a, b) => b.score - a.score);
}
