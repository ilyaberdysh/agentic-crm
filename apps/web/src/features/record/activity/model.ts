// Activity timeline logic (BACKLOG 3.04; D README §3.8, CROSS-DOMAIN B.24, B.26): the "Visible events" filter
// categories and their persistence, which server events are rendered, period headers ("This week", …) and the
// Overview preview (3 events, people before automations).
import type { EventCategory, TimelineEvent, TimelineItem } from '@agentic-crm/contracts';

/** Filter menu categories in menu order (D §3.8; "Logged activity" is flag-gated in Attio and not built). */
export const FILTER_CATEGORIES = [
  { id: 'calendar', label: 'Calendar events', icon: 'attrDate' },
  { id: 'tasks', label: 'Task events', icon: 'tasks' },
  { id: 'notes', label: 'Note events', icon: 'noteTab' },
  { id: 'updates', label: 'Updates', icon: 'overview' },
  { id: 'lists', label: 'List events', icon: 'listAdd' },
] as const;

export type VisibleCategory = (typeof FILTER_CATEGORIES)[number]['id'];

const ALL: VisibleCategory[] = FILTER_CATEGORIES.map((c) => c.id);

/** Event types behind each category (the table in D §3.8, Attio's `event_type` values). */
export const CATEGORY_EVENT_TYPES: Record<VisibleCategory | 'activity', readonly string[]> = {
  calendar: ['meeting'],
  tasks: ['task-upcoming', 'task-overdue', 'task-completed'],
  notes: ['note-added', 'note-mention-added'],
  activity: ['activity'],
  updates: ['attribute-values-updated', 'entity-instance-created', 'merged', 'first-contact'],
  lists: ['list-entry-created', 'list-attribute-values-updated'],
};

/** Per object, per browser (Attio: `activity-timeline-visible-events:<entityDefinitionId>`). */
export const activityFiltersKey = (entityDefinitionId: string) =>
  `activity-timeline-visible-events:${entityDefinitionId}`;

/** A persisted selection, or every category when missing / malformed. Keeps menu order, drops unknown ids. */
export function normaliseVisible(raw: unknown): VisibleCategory[] {
  if (!Array.isArray(raw)) return [...ALL];
  const set = new Set(raw.filter((v): v is string => typeof v === 'string'));
  return ALL.filter((c) => set.has(c));
}

/** The Filters button shows its accent dot when the selection differs from the default (all on). */
export function isDefaultVisible(visible: readonly VisibleCategory[]): boolean {
  return ALL.every((c) => visible.includes(c));
}

export function toggleCategory(visible: readonly VisibleCategory[], id: VisibleCategory): VisibleCategory[] {
  const set = new Set(visible);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return ALL.filter((c) => set.has(c));
}

/** The server filter for a selection (comments and files exist on the server but are never rendered). */
export function requestCategories(visible: readonly VisibleCategory[]): EventCategory[] {
  return ALL.filter((c) => visible.includes(c));
}

/** Returned by the API but not rendered by Attio's feed (D §3.8). */
const HIDDEN_EVENT_TYPES = new Set<TimelineEvent['eventType']>(['comment-added', 'file-added', 'task-added']);

export function isRenderable(event: TimelineEvent): boolean {
  return !HIDDEN_EVENT_TYPES.has(event.eventType);
}

/** Drops events the feed does not draw; an automation group left with one event becomes a plain row. */
export function renderableItems(items: readonly TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const item of items) {
    if (item.kind === 'single') {
      if (isRenderable(item.event)) out.push(item);
      continue;
    }
    const events = item.events.filter(isRenderable);
    if (events.length === 0) continue;
    if (events.length === 1) out.push({ kind: 'single', event: events[0] as TimelineEvent });
    else out.push({ ...item, events });
  }
  return out;
}

export const itemTime = (item: TimelineItem): string => (item.kind === 'single' ? item.event.occurredAt : item.endedAt);
export const itemKey = (item: TimelineItem): string =>
  item.kind === 'single' ? item.event.id : `group:${item.events[0]?.id ?? item.startedAt}`;

// ---- periods ----------------------------------------------------------------------------------------------------

export interface Period {
  key: string;
  label: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function startOfLocalWeek(now: Date, weekStartDay: number): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const back = (d.getDay() - weekStartDay + 7) % 7;
  d.setDate(d.getDate() - back);
  return d;
}

/**
 * Period header of a past event in local time (B.24): "This week", "Last week", then the month name within the
 * current year, then the year for older events.
 */
export function periodOf(iso: string, now: Date, weekStartDay: number): Period {
  const t = new Date(iso);
  const thisWeek = startOfLocalWeek(now, weekStartDay);
  if (t >= thisWeek) return { key: 'this-week', label: 'This week' };
  const lastWeek = new Date(thisWeek);
  lastWeek.setDate(lastWeek.getDate() - 7);
  if (t >= lastWeek) return { key: 'last-week', label: 'Last week' };
  if (t.getFullYear() === now.getFullYear()) {
    return { key: `month-${t.getMonth()}`, label: MONTHS[t.getMonth()] as string };
  }
  return { key: `year-${t.getFullYear()}`, label: String(t.getFullYear()) };
}

export interface PeriodGroup {
  period: Period;
  items: TimelineItem[];
}

/** Consecutive items under their period header (the feed is newest first, so periods come out in order). */
export function groupByPeriod(items: readonly TimelineItem[], now: Date, weekStartDay: number): PeriodGroup[] {
  const out: PeriodGroup[] = [];
  for (const item of items) {
    const period = periodOf(itemTime(item), now, weekStartDay);
    const last = out[out.length - 1];
    if (last && last.period.key === period.key) last.items.push(item);
    else out.push({ period, items: [item] });
  }
  return out;
}

/**
 * Overview "Activity" card: the newest `n` events, preferring events by people and filling with background
 * (automation) events only when fewer than `n` exist; shown newest first.
 */
export function previewEvents(items: readonly TimelineItem[], n = 3): TimelineEvent[] {
  const events = renderableItems(items).flatMap((i) => (i.kind === 'single' ? [i.event] : i.events));
  const foreground = events.filter((e) => !e.isBackground).slice(0, n);
  if (foreground.length >= n) return foreground;
  const fill = events.filter((e) => e.isBackground).slice(0, n - foreground.length);
  const chosen = new Set([...foreground, ...fill].map((e) => e.id));
  return events.filter((e) => chosen.has(e.id));
}
