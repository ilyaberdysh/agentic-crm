// Pure logic of the dashboards index (BACKLOG 9.01): title search, creation-date sort,
// date-bucket groups in the viewer's zone and week start (the shared B.24 buckets, as the notes index), the favourites
// strip, the report chips of a row and the tint of a dashboard's tile.
import { type CreatedBucket, createdBucketOf, createdBucketRanges, type WeekDay } from '@agentic-crm/contracts';

export type SortDirection = 'asc' | 'desc';
export type GroupBy = 'created' | 'none';

/** Per-member view settings of the index (sort direction, grouping, "Show favorites"). */
export interface IndexViewSettings {
  direction: SortDirection;
  groupBy: GroupBy;
  showFavorites: boolean;
}

export const DEFAULT_VIEW_SETTINGS: IndexViewSettings = { direction: 'desc', groupBy: 'created', showFavorites: true };

/** Labels of the creation-date buckets (the same words as the notes index, B.24; evidence "Created today 1"). */
export const BUCKET_LABEL: Record<CreatedBucket, string> = {
  today: 'Created today',
  'this-week': 'Created this week',
  'last-week': 'Created last week',
  'earlier-this-month': 'Created earlier this month',
  'last-month': 'Created last month',
  'earlier-this-year': 'Created earlier this year',
  'last-year': 'Created last year',
  older: 'Created over a year ago',
};

interface Dated {
  id: string;
  createdAt: string;
}

/** Title contains the search text (case-insensitive), as the server's `query` does. */
export function filterByTitle<T extends { title: string }>(list: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? list.filter((d) => d.title.toLowerCase().includes(q)) : [...list];
}

/** Creation date, newest first for `desc` (ties by id so the order is stable across refetches). */
export function sortByCreation<T extends Dated>(list: readonly T[], direction: SortDirection): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const t = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (t !== 0) return sign * t;
    return a.id < b.id ? -sign : a.id > b.id ? sign : 0;
  });
}

export interface Group<T> {
  key: CreatedBucket | 'all';
  label: string;
  items: T[];
}

export interface CalendarLike {
  timeZone: string;
  weekStart: WeekDay;
}

/**
 * Rows in date-bucket groups (newest bucket first for descending sorts, oldest first for ascending), empty buckets
 * left out; `none` is one group "All dashboards". Items keep their order inside a group.
 */
export function groupDashboards<T extends Dated>(
  sorted: readonly T[],
  groupBy: GroupBy,
  calendar: CalendarLike,
  direction: SortDirection,
  now: number = Date.now(),
): Group<T>[] {
  if (groupBy === 'none') return sorted.length ? [{ key: 'all', label: 'All dashboards', items: [...sorted] }] : [];
  const ranges = createdBucketRanges(now, calendar.timeZone, calendar.weekStart);
  const buckets = new Map<CreatedBucket, T[]>();
  for (const d of sorted) {
    const key = createdBucketOf(d.createdAt, ranges);
    const list = buckets.get(key);
    if (list) list.push(d);
    else buckets.set(key, [d]);
  }
  const order = ranges.map((r) => r.key);
  if (direction === 'asc') order.reverse();
  return order.flatMap((key) => {
    const items = buckets.get(key);
    return items ? [{ key, label: BUCKET_LABEL[key], items }] : [];
  });
}

/**
 * The favourites strip: dashboards the member starred. `ranks` (target id to rank in the member's favourites: the
 * sidebar's order, optimistic like the stars) decides membership and order once the favourites are loaded; without it
 * the rows' own `favoriteId` decides and list order is kept.
 */
export function favouritesOf<T extends { id: string; favoriteId: string | null }>(
  list: readonly T[],
  ranks?: ReadonlyMap<string, string>,
): T[] {
  if (!ranks) return list.filter((d) => d.favoriteId !== null);
  return list
    .filter((d) => ranks.has(d.id))
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const ra = ranks.get(a.d.id) as string;
      const rb = ranks.get(b.d.id) as string;
      if (ra !== rb) return ra < rb ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.d);
}

/** The first `max` reports as chips and how many are left for a "+N" chip. */
export function splitChips<T>(reports: readonly T[], max: number): { shown: T[]; rest: number } {
  return { shown: reports.slice(0, max), rest: Math.max(0, reports.length - max) };
}

/** Favourite card thumbnails: up to three reports and the "+N" count of the others. */
export function thumbnails<T>(reports: readonly T[], reportCount: number): { shown: T[]; more: number } {
  const shown = reports.slice(0, 3);
  return { shown, more: Math.max(0, Math.max(reportCount, reports.length) - shown.length) };
}

export const TILE_TINTS = ['red', 'orange', 'pink', 'lavender', 'purple', 'blue', 'cyan', 'green', 'amber'] as const;
export type TileTint = (typeof TILE_TINTS)[number];

/** A stable tint per dashboard id (the tiles of the index vary: red and orange in the evidence). */
export function tintOf(id: string): TileTint {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TILE_TINTS[h % TILE_TINTS.length] as TileTint;
}

/** Screen-reader and chip title of a report: its title, or "Untitled Report" when empty. */
export const reportTitle = (title: string): string => title.trim() || 'Untitled Report';
export const dashboardTitle = (title: string): string => title.trim() || 'Untitled Dashboard';
