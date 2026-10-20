import { describe, expect, it } from 'vitest';
import {
  BUCKET_LABEL,
  favouritesOf,
  filterByTitle,
  groupDashboards,
  sortByCreation,
  splitChips,
  thumbnails,
  tintOf,
} from './model';

// "Now" is Fri 9 Oct 2026, 12:00 in Moscow (UTC+3); weeks start on Sunday (en-US) unless a test says otherwise.
const NOW = Date.parse('2026-10-09T09:00:00Z');
const MOSCOW = { timeZone: 'Europe/Moscow', weekStart: 0 as const };

const d = (id: string, title: string, createdAt: string, favoriteId: string | null = null) => ({
  id,
  title,
  createdAt,
  favoriteId,
});

const rows = [
  d('a', 'Companies by Country', '2026-10-08T10:00:00Z'), // yesterday
  d('b', '[seed] Reports QA', '2026-10-08T21:30:00Z', 'fav-b'), // 00:30 today in Moscow
  d('c', '[seed] Temp delete test', '2026-10-09T08:00:00Z'), // today
  d('d', 'Pipeline overview', '2026-09-20T10:00:00Z'), // last month
  d('e', 'Old board', '2025-03-01T10:00:00Z'), // last year
  d('f', 'Ancient', '2023-01-01T10:00:00Z'), // over a year ago
];

describe('filterByTitle', () => {
  it('matches a case-insensitive title substring and trims the query', () => {
    expect(filterByTitle(rows, '  REPORTS ').map((r) => r.id)).toEqual(['b']);
    expect(filterByTitle(rows, 'o').length).toBeGreaterThan(1);
  });
  it('keeps everything for an empty query and returns a copy', () => {
    const all = filterByTitle(rows, '');
    expect(all).toHaveLength(rows.length);
    expect(all).not.toBe(rows);
  });
  it('finds nothing for an unknown text', () => {
    expect(filterByTitle(rows, 'zzz')).toEqual([]);
  });
});

describe('sortByCreation', () => {
  it('sorts newest first for desc and oldest first for asc', () => {
    expect(sortByCreation(rows, 'desc').map((r) => r.id)).toEqual(['c', 'b', 'a', 'd', 'e', 'f']);
    expect(sortByCreation(rows, 'asc').map((r) => r.id)).toEqual(['f', 'e', 'd', 'a', 'b', 'c']);
  });
  it('breaks ties by id, mirrored for the other direction', () => {
    const tie = [d('x', 'X', '2026-01-01T00:00:00Z'), d('y', 'Y', '2026-01-01T00:00:00Z')];
    expect(sortByCreation(tie, 'asc').map((r) => r.id)).toEqual(['x', 'y']);
    expect(sortByCreation(tie, 'desc').map((r) => r.id)).toEqual(['y', 'x']);
  });
  it('does not mutate its input', () => {
    const copy = [...rows];
    sortByCreation(rows, 'asc');
    expect(rows).toEqual(copy);
  });
});

describe('groupDashboards', () => {
  it('groups by creation bucket in the viewer zone, newest bucket first, with the notes labels', () => {
    const groups = groupDashboards(sortByCreation(rows, 'desc'), 'created', MOSCOW, 'desc', NOW);
    expect(groups.map((g) => [g.key, g.label, g.items.map((r) => r.id)])).toEqual([
      ['today', 'Created today', ['c', 'b']], // b: 00:30 Moscow time on Oct 9
      ['this-week', 'Created this week', ['a']],
      ['last-month', 'Created last month', ['d']],
      ['last-year', 'Created last year', ['e']],
      ['older', 'Created over a year ago', ['f']],
    ]);
  });
  it('uses the zone, not UTC, for the day boundary', () => {
    const edge = [d('z', 'Z', '2026-10-08T21:30:00Z')]; // Oct 8 in UTC, Oct 9 in Moscow
    expect(groupDashboards(edge, 'created', MOSCOW, 'desc', NOW)[0]?.key).toBe('today');
    expect(groupDashboards(edge, 'created', { timeZone: 'UTC', weekStart: 0 }, 'desc', NOW)[0]?.key).toBe('this-week');
  });
  it('lists the oldest bucket first for ascending sorts', () => {
    const groups = groupDashboards(sortByCreation(rows, 'asc'), 'created', MOSCOW, 'asc', NOW);
    expect(groups.map((g) => g.key)).toEqual(['older', 'last-year', 'last-month', 'this-week', 'today']);
    expect(groups.at(-1)?.items.map((r) => r.id)).toEqual(['b', 'c']);
  });
  it('honours the week start', () => {
    // Wed 7 Oct 2026 10:00 UTC: this week with Monday starts (since Mon 5 Oct), last week with Thursday starts.
    const mid = [d('m', 'Mid', '2026-10-07T10:00:00Z')];
    expect(groupDashboards(mid, 'created', { timeZone: 'UTC', weekStart: 1 }, 'desc', NOW)[0]?.key).toBe('this-week');
    expect(groupDashboards(mid, 'created', { timeZone: 'UTC', weekStart: 5 }, 'desc', NOW)[0]?.key).toBe('last-week');
  });
  it('is one group "All dashboards" without grouping, and nothing for an empty list', () => {
    const none = groupDashboards(rows, 'none', MOSCOW, 'desc', NOW);
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ key: 'all', label: 'All dashboards' });
    expect(none[0]?.items).toHaveLength(rows.length);
    expect(groupDashboards([], 'none', MOSCOW, 'desc', NOW)).toEqual([]);
    expect(groupDashboards([], 'created', MOSCOW, 'desc', NOW)).toEqual([]);
  });
  it('labels every bucket', () => {
    expect(Object.values(BUCKET_LABEL).every((l) => l.startsWith('Created '))).toBe(true);
  });
});

describe('favouritesOf', () => {
  const list = [
    d('1', 'One', '2026-01-01T00:00:00Z', 'f1'),
    d('2', 'Two', '2026-01-02T00:00:00Z'),
    d('3', 'Three', '2026-01-03T00:00:00Z', 'f3'),
    d('4', 'Four', '2026-01-04T00:00:00Z', 'f4'),
  ];
  it('keeps starred dashboards in list order without ranks', () => {
    expect(favouritesOf(list).map((r) => r.id)).toEqual(['1', '3', '4']);
  });
  it('follows the sidebar order when ranks are known', () => {
    const ranks = new Map([
      ['1', 'c'],
      ['3', 'a'],
      ['4', 'b'],
    ]);
    expect(favouritesOf(list, ranks).map((r) => r.id)).toEqual(['3', '4', '1']);
  });
  it('lets the loaded favourites decide over the rows own favoriteId (optimistic stars)', () => {
    expect(favouritesOf(list, new Map([['2', 'a']])).map((r) => r.id)).toEqual(['2']);
    expect(favouritesOf(list, new Map()).map((r) => r.id)).toEqual([]);
  });
  it('is empty when nothing is starred', () => {
    expect(favouritesOf([d('x', 'X', '2026-01-01T00:00:00Z')])).toEqual([]);
  });
});

describe('chips and thumbnails', () => {
  it('splits report chips into shown and rest', () => {
    expect(splitChips([1, 2, 3, 4], 3)).toEqual({ shown: [1, 2, 3], rest: 1 });
    expect(splitChips([1, 2], 3)).toEqual({ shown: [1, 2], rest: 0 });
    expect(splitChips([], 3)).toEqual({ shown: [], rest: 0 });
  });
  it('shows three thumbnails and "+N" for the others (6 reports: +3)', () => {
    expect(thumbnails([1, 2, 3, 4, 5, 6], 6)).toEqual({ shown: [1, 2, 3], more: 3 });
    expect(thumbnails([1, 2], 2)).toEqual({ shown: [1, 2], more: 0 });
    expect(thumbnails([], 0)).toEqual({ shown: [], more: 0 });
  });
});

describe('tintOf', () => {
  it('is stable per id and always one of the tints', () => {
    expect(tintOf('abc')).toBe(tintOf('abc'));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => tintOf(`dashboard-${i}`)));
    expect(seen.size).toBeGreaterThan(4);
  });
});
