// List visits for the sidebar "Most relevant" order (B sidebar.md §8): per list the last ≤ 10 visit times, kept in
// localStorage (`ar:list-visits`, Attio `agentic-crm:agentic-crm:list-visits`). Score = visit count × mean recency weight of the
// visits (< 4 h 100, < 1 d 80, < 3 d 60, < 1 w 40, < 30 d 20, < 90 d 10, else 0).
import { readJson, writeJson } from '../../lib/storage';

const KEY = 'list-visits';
const MAX_VISITS = 10;
/** Visits closer than this count once (re-renders, view switches). */
const DEDUPE_MS = 60_000;

type Visits = Record<string, number[]>;

const listeners = new Set<() => void>();

export function subscribeVisits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readVisits(): Visits {
  return readJson<Visits>(KEY, {});
}

export function recordListVisit(listId: string, now = Date.now()): void {
  const visits = readVisits();
  const times = visits[listId] ?? [];
  if (times.length > 0 && now - (times[times.length - 1] as number) < DEDUPE_MS) return;
  visits[listId] = [...times, now].slice(-MAX_VISITS);
  writeJson(KEY, visits);
  for (const l of listeners) l();
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function recencyWeight(ageMs: number): number {
  if (ageMs < 4 * HOUR) return 100;
  if (ageMs < DAY) return 80;
  if (ageMs < 3 * DAY) return 60;
  if (ageMs < 7 * DAY) return 40;
  if (ageMs < 30 * DAY) return 20;
  if (ageMs < 90 * DAY) return 10;
  return 0;
}

export function relevanceScore(times: readonly number[], now = Date.now()): number {
  if (times.length === 0) return 0;
  const mean = times.reduce((sum, t) => sum + recencyWeight(now - t), 0) / times.length;
  return times.length * mean;
}

/** Score lookup for `sortLists(lists, 'most-relevant', relevance)`. */
export function relevanceOf(visits: Visits, now = Date.now()): (listId: string) => number {
  return (listId) => relevanceScore(visits[listId] ?? [], now);
}
