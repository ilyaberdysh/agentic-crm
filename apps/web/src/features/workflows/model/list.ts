// Workflows index model (README §2.1, internal-api §2): date buckets (the default grouping "Last published": Today …
// Older and "Unpublished"), the other groupings (Creation date, Status, Creator, None), sorts with empty values last,
// the status label, filter by creator and title search. Pure; `now` and the time zone are injectable for tests.
import type { Workflow } from '../types';

export type SortField = 'created-at' | 'last-published' | 'runs' | 'name' | 'last-failed-run';
export type GroupField = 'created-at' | 'status' | 'last-published' | 'creator' | 'none';

export interface ListSettings {
  sort: SortField;
  direction: 'asc' | 'desc';
  group: GroupField;
  showFavorites: boolean;
  showArchived: boolean;
  createdBy: string[];
}

export const DEFAULT_LIST_SETTINGS: ListSettings = {
  sort: 'last-published',
  direction: 'desc',
  group: 'last-published',
  showFavorites: true,
  showArchived: false,
  createdBy: [],
};

export const SORT_LABELS: Record<SortField, string> = {
  'created-at': 'Creation date',
  'last-published': 'Last published',
  runs: 'Number of runs',
  name: 'Name',
  'last-failed-run': 'Last failed run',
};

export const GROUP_LABELS: Record<GroupField, string> = {
  'created-at': 'Creation date',
  status: 'Status',
  'last-published': 'Last published',
  creator: 'Creator',
  none: 'None',
};

export type DisplayStatus = 'live' | 'paused' | 'draft' | 'archived';

export function displayStatus(w: Pick<Workflow, 'status' | 'isArchived'>): DisplayStatus {
  if (w.isArchived) return 'archived';
  return w.status;
}

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  live: 'Live',
  paused: 'Paused',
  draft: 'Draft',
  archived: 'Archived',
};

/** The "Last published" value only reflects an active version (README §4.1): paused workflows show none. */
export function publishedAt(w: Pick<Workflow, 'status' | 'lastPublishedAt' | 'isArchived'>): string | null {
  return w.status === 'live' && !w.isArchived ? w.lastPublishedAt : null;
}

export type DateBucket =
  | 'today'
  | 'yesterday'
  | 'last-7-days'
  | 'this-month'
  | 'this-year'
  | 'last-year'
  | 'older'
  | 'never';

export const DATE_BUCKET_ORDER: DateBucket[] = [
  'today',
  'yesterday',
  'last-7-days',
  'this-month',
  'this-year',
  'last-year',
  'older',
  'never',
];

export function dateBucketLabel(bucket: DateBucket, field: 'created-at' | 'last-published'): string {
  switch (bucket) {
    case 'today':
      return 'Today';
    case 'yesterday':
      return 'Yesterday';
    case 'last-7-days':
      return 'Previous 7 days';
    case 'this-month':
      return 'Earlier this month';
    case 'this-year':
      return 'Earlier this year';
    case 'last-year':
      return 'Last year';
    case 'older':
      return 'Older';
    case 'never':
      return field === 'last-published' ? 'Unpublished' : 'No date';
  }
}

function dayParts(iso: string | number, timeZone?: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

const dayNumber = (p: { y: number; m: number; d: number }) => Date.UTC(p.y, p.m - 1, p.d) / 86_400_000;

export function dateBucket(iso: string | null, now: number = Date.now(), timeZone?: string): DateBucket {
  if (!iso) return 'never';
  const day = dayParts(iso, timeZone);
  const today = dayParts(now, timeZone);
  const diff = dayNumber(today) - dayNumber(day);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff <= 7) return 'last-7-days';
  if (day.y === today.y && day.m === today.m) return 'this-month';
  if (day.y === today.y) return 'this-year';
  if (day.y === today.y - 1) return 'last-year';
  return 'older';
}

export interface WorkflowGroup {
  key: string;
  label: string;
  workflows: Workflow[];
}

const cmp = (a: string | number | null, b: string | number | null, direction: 'asc' | 'desc') => {
  // Empty values last in both directions.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const r = a < b ? -1 : a > b ? 1 : 0;
  return direction === 'asc' ? r : -r;
};

export function sortWorkflows(list: readonly Workflow[], sort: SortField, direction: 'asc' | 'desc'): Workflow[] {
  const key = (w: Workflow): string | number | null => {
    switch (sort) {
      case 'created-at':
        return w.createdAt;
      case 'last-published':
        return publishedAt(w);
      case 'runs':
        return w.runCount;
      case 'name':
        return w.displayTitle.toLocaleLowerCase();
      case 'last-failed-run':
        return w.lastRunFailedAt;
    }
  };
  return [...list].sort((a, b) => cmp(key(a), key(b), direction) || cmp(a.createdAt, b.createdAt, 'desc'));
}

export function filterWorkflows(
  list: readonly Workflow[],
  settings: Pick<ListSettings, 'showArchived' | 'createdBy'>,
  query: string,
): Workflow[] {
  const q = query.trim().toLocaleLowerCase();
  return list.filter((w) => {
    if (!settings.showArchived && w.isArchived) return false;
    if (settings.createdBy.length > 0 && !(w.createdBy.id && settings.createdBy.includes(w.createdBy.id))) return false;
    return !q || w.displayTitle.toLocaleLowerCase().includes(q);
  });
}

const STATUS_ORDER: DisplayStatus[] = ['live', 'paused', 'draft', 'archived'];

export function groupWorkflows(
  sorted: readonly Workflow[],
  group: GroupField,
  options: { now?: number; timeZone?: string; creatorName?: (w: Workflow) => string } = {},
): WorkflowGroup[] {
  if (group === 'none') return [{ key: 'all', label: 'All', workflows: [...sorted] }];
  const buckets = new Map<string, { label: string; order: number; workflows: Workflow[] }>();
  const add = (key: string, label: string, order: number, w: Workflow) => {
    const b = buckets.get(key) ?? { label, order, workflows: [] };
    b.workflows.push(w);
    buckets.set(key, b);
  };
  for (const w of sorted) {
    if (group === 'status') {
      const s = displayStatus(w);
      add(s, STATUS_LABELS[s], STATUS_ORDER.indexOf(s), w);
    } else if (group === 'creator') {
      const name = options.creatorName?.(w) ?? 'Unknown';
      add(`creator:${w.createdBy.id ?? name}`, name, 0, w);
    } else {
      const iso = group === 'created-at' ? w.createdAt : publishedAt(w);
      const bucket = dateBucket(iso, options.now, options.timeZone);
      add(bucket, dateBucketLabel(bucket, group), DATE_BUCKET_ORDER.indexOf(bucket), w);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[1].order - b[1].order || a[1].label.localeCompare(b[1].label))
    .map(([key, b]) => ({ key, label: b.label, workflows: b.workflows }));
}
