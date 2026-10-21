import type { TimelineEvent, TimelineItem } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_EVENT_TYPES,
  FILTER_CATEGORIES,
  groupByPeriod,
  isDefaultVisible,
  normaliseVisible,
  periodOf,
  previewEvents,
  renderableItems,
  requestCategories,
  toggleCategory,
} from './model';

const member = { type: 'workspace-member' as const, id: 'm1' };
const token = { type: 'api-token' as const, id: 't1' };

function event(id: string, occurredAt: string, extra: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id,
    category: 'updates',
    occurredAt,
    actor: member,
    isBackground: false,
    eventType: 'entity-instance-created',
    ...extra,
  } as TimelineEvent;
}
const single = (e: TimelineEvent): TimelineItem => ({ kind: 'single', event: e });

describe('visible event categories', () => {
  it('defaults to every category, keeps menu order and drops unknown ids', () => {
    expect(normaliseVisible(null)).toEqual(['calendar', 'tasks', 'notes', 'updates', 'lists']);
    expect(normaliseVisible(['lists', 'bogus', 'tasks'])).toEqual(['tasks', 'lists']);
    expect(normaliseVisible('tasks')).toHaveLength(5);
  });

  it('toggles categories and reports the non-default state (Filters accent dot)', () => {
    const all = normaliseVisible(null);
    expect(isDefaultVisible(all)).toBe(true);
    const fewer = toggleCategory(all, 'updates');
    expect(fewer).toEqual(['calendar', 'tasks', 'notes', 'lists']);
    expect(isDefaultVisible(fewer)).toBe(false);
    expect(toggleCategory(fewer, 'updates')).toEqual(all);
    expect(requestCategories([])).toEqual([]);
    expect(requestCategories(fewer)).not.toContain('updates');
  });

  it('maps the five menu categories to event types', () => {
    expect(FILTER_CATEGORIES.map((c) => c.label)).toEqual([
      'Calendar events',
      'Task events',
      'Note events',
      'Updates',
      'List events',
    ]);
    expect(CATEGORY_EVENT_TYPES.updates).toContain('attribute-values-updated');
    expect(CATEGORY_EVENT_TYPES.lists).toEqual(['list-entry-created', 'list-attribute-values-updated']);
  });
});

describe('rendered events', () => {
  it('drops comment / file / task-added events and unwraps groups left with one event', () => {
    const items: TimelineItem[] = [
      single(event('a', '2026-10-12T10:00:00Z')),
      single(event('c', '2026-10-12T09:00:00Z', { eventType: 'comment-added', category: 'comments' } as never)),
      {
        kind: 'group',
        groupType: 'automation',
        startedAt: '2026-10-12T07:00:00Z',
        endedAt: '2026-10-12T08:00:00Z',
        events: [
          event('g1', '2026-10-12T08:00:00Z', { actor: token, isBackground: true }),
          event('g2', '2026-10-12T07:00:00Z', { eventType: 'file-added', category: 'files' } as never),
        ],
      },
    ];
    const out = renderableItems(items);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ kind: 'single', event: expect.objectContaining({ id: 'g1' }) });
  });
});

describe('period headers', () => {
  // Tuesday 13 Oct 2026, weeks start on Monday.
  const now = new Date(2026, 9, 13, 12, 0, 0);
  it('this week, last week, months of this year, then years', () => {
    expect(periodOf(new Date(2026, 9, 12, 9).toISOString(), now, 1).label).toBe('This week');
    expect(periodOf(new Date(2026, 9, 11, 9).toISOString(), now, 1).label).toBe('Last week');
    expect(periodOf(new Date(2026, 9, 11, 9).toISOString(), now, 0).label).toBe('This week');
    expect(periodOf(new Date(2026, 8, 2).toISOString(), now, 1).label).toBe('September');
    expect(periodOf(new Date(2024, 3, 2).toISOString(), now, 1).label).toBe('2024');
  });

  it('groups consecutive items under one header', () => {
    const items = [
      single(event('a', new Date(2026, 9, 13, 9).toISOString())),
      single(event('b', new Date(2026, 9, 12, 9).toISOString())),
      single(event('c', new Date(2026, 8, 1).toISOString())),
    ];
    const groups = groupByPeriod(items, now, 1);
    expect(groups.map((g) => [g.period.label, g.items.length])).toEqual([
      ['This week', 2],
      ['September', 1],
    ]);
  });
});

describe('Overview activity preview', () => {
  it('prefers events by people, fills with automation events, keeps newest-first order', () => {
    const items = [
      single(event('bg1', '2026-10-12T10:00:00Z', { actor: token, isBackground: true })),
      single(event('p1', '2026-10-12T09:00:00Z')),
      single(event('bg2', '2026-10-12T08:00:00Z', { actor: token, isBackground: true })),
      single(event('p2', '2026-10-12T07:00:00Z')),
    ];
    expect(previewEvents(items, 3).map((e) => e.id)).toEqual(['bg1', 'p1', 'p2']);
    expect(previewEvents(items.slice(1, 2), 3).map((e) => e.id)).toEqual(['p1']);
    const people = [1, 2, 3, 4].map((i) => single(event(`p${i}`, `2026-10-0${i}T00:00:00Z`)));
    expect(previewEvents(people, 3)).toHaveLength(3);
  });
});
