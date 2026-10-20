import { describe, expect, it } from 'vitest';
import { greetingText, homeDueLabel, partOfDayIn } from './model';

describe('home greeting', () => {
  it('switches at 12:00 and 18:00 local time', () => {
    expect(partOfDayIn(Date.parse('2026-10-14T08:59:00Z'), 'Europe/Moscow')).toBe('morning'); // 11:59
    expect(partOfDayIn(Date.parse('2026-10-14T09:00:00Z'), 'Europe/Moscow')).toBe('afternoon'); // 12:00
    expect(partOfDayIn(Date.parse('2026-10-14T14:59:00Z'), 'Europe/Moscow')).toBe('afternoon'); // 17:59
    expect(partOfDayIn(Date.parse('2026-10-14T15:00:00Z'), 'Europe/Moscow')).toBe('evening'); // 18:00
    expect(partOfDayIn(Date.parse('2026-10-14T15:00:00Z'), 'America/New_York')).toBe('morning'); // 11:00
  });

  it('greets by first name', () => {
    expect(greetingText('afternoon', 'Ada')).toBe('Good afternoon, Ada.');
    expect(greetingText('morning', '')).toBe('Good morning.');
  });
});

describe('task due labels', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  it('words the offset in the viewer zone with its tone', () => {
    expect(homeDueLabel('2026-10-13T12:00:00Z', now, 'UTC')).toEqual({ text: 'Yesterday', tone: 'overdue' });
    expect(homeDueLabel('2026-10-14T20:00:00Z', now, 'UTC')).toEqual({ text: 'Today', tone: 'today' });
    expect(homeDueLabel('2026-10-15T12:00:00Z', now, 'UTC')).toEqual({ text: 'Tomorrow', tone: 'later' });
    expect(homeDueLabel('2026-10-19T12:00:00Z', now, 'UTC')).toEqual({ text: 'In 5 days', tone: 'later' });
    expect(homeDueLabel(null, now, 'UTC')).toBeNull();
  });

  it('a deadline just after midnight in the viewer zone is tomorrow there', () => {
    // 21:30Z on the 14th is 00:30 on the 15th in Moscow.
    expect(homeDueLabel('2026-10-14T21:30:00Z', now, 'Europe/Moscow')).toEqual({ text: 'Tomorrow', tone: 'later' });
  });
});
