// Deadline popover of the task dialogs: natural-language field
// "Next Tuesday..." (⏎ applies), a month calendar starting on the viewer's week start (today = dot, selected = blue),
// and presets Today · Tomorrow · Next week · No date.
import { addDays, addMonths, startOfWeek, type WeekDay } from '@agentic-crm/contracts';
import { Icon, IconButton, Kbd } from '@agentic-crm/ui';
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { Calendar } from './calendar';
import { type DraftDeadline, formatTime, presetDate } from './deadline';
import { parseNaturalDate } from './naturalDate';
import * as s from './tasks.css';

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function monthGrid(month: string, weekStart: WeekDay): (string | null)[] {
  const first = `${month.slice(0, 7)}-01`;
  const gridStart = startOfWeek(first, weekStart);
  const nextMonth = addMonths(first, 1);
  const cells: (string | null)[] = [];
  for (let d = gridStart; d < nextMonth || cells.length % 7 !== 0; d = addDays(d, 1)) {
    cells.push(d >= first && d < nextMonth ? d : null);
  }
  return cells;
}

export function DeadlinePicker({
  value,
  calendar,
  onChange,
}: {
  value: DraftDeadline | null;
  calendar: Calendar;
  onChange: (next: DraftDeadline | null) => void;
}) {
  const today = calendar.today();
  const [month, setMonth] = useState(() => (value?.date ?? today).slice(0, 7));
  const [text, setText] = useState('');
  const parsed = text.trim()
    ? parseNaturalDate(text, { today, weekStart: calendar.weekStart, numericOrder: calendar.numericOrder })
    : null;
  const monthLabel = new Intl.DateTimeFormat(calendar.locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
  const nextWeek = addDays(startOfWeek(today, calendar.weekStart), 7);
  const letters = Array.from({ length: 7 }, (_, i) => WEEKDAY_LETTERS[(calendar.weekStart + i) % 7]);
  const pick = (date: string) => onChange({ date, time: value?.date === date ? value.time : null });

  return (
    <div className={s.deadlinePanel} data-testid="deadline-picker">
      <div className={s.nlRow}>
        <div className={s.nlInput}>
          <input
            className={s.nlField}
            placeholder="Next Tuesday..."
            aria-label="Due date"
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && parsed) {
                e.preventDefault();
                onChange({ date: parsed.date, time: parsed.time });
              }
            }}
          />
          <Kbd keys={['enter']} size={20} />
        </div>
      </div>
      {text.trim() && (
        <div className={s.nlHint} data-testid="deadline-nl-hint">
          {parsed
            ? `${new Intl.DateTimeFormat(calendar.locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${parsed.date}T00:00:00Z`))}${parsed.time ? `, ${formatTime(parsed.time, calendar.locale)}` : ''}`
            : 'No date found'}
        </div>
      )}
      <div className={s.calendar}>
        <div className={s.calendarHead}>
          <IconButton
            icon="chevronLeft"
            aria-label="Previous month"
            size={20}
            onPress={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}
          />
          <IconButton
            icon="chevronRight"
            aria-label="Next month"
            size={20}
            onPress={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}
          />
          <span className={s.calendarMonth}>{monthLabel}</span>
          <span>{month.slice(0, 4)}</span>
        </div>
        <div className={s.weekdays} aria-hidden="true">
          {letters.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </div>
        <div className={s.days} role="grid" aria-label={`${monthLabel} ${month.slice(0, 4)}`}>
          {monthGrid(month, calendar.weekStart).map((date, i) =>
            date ? (
              <AriaButton
                key={date}
                className={s.day}
                aria-label={date}
                data-selected={value?.date === date || undefined}
                aria-pressed={value?.date === date}
                onPress={() => pick(date)}
              >
                {Number(date.slice(8, 10))}
                {date === today && <span className={s.todayDot} aria-hidden="true" />}
              </AriaButton>
            ) : (
              <span key={`x${i}`} className={s.day} data-outside="" />
            ),
          )}
        </div>
      </div>
      <div className={s.presets}>
        <AriaButton
          className={s.preset}
          onPress={() => onChange({ date: presetDate('today', today, nextWeek), time: null })}
        >
          <Icon icon="calendar" size={14} />
          Today
        </AriaButton>
        <AriaButton
          className={s.preset}
          onPress={() => onChange({ date: presetDate('tomorrow', today, nextWeek), time: null })}
        >
          <Icon icon="calendar" size={14} />
          Tomorrow
        </AriaButton>
        <AriaButton
          className={s.preset}
          onPress={() => onChange({ date: presetDate('next-week', today, nextWeek), time: null })}
        >
          <Icon icon="calendar" size={14} />
          Next week
        </AriaButton>
        <AriaButton className={s.preset} onPress={() => onChange(null)}>
          <Icon icon="calendar" size={14} />
          No date
        </AriaButton>
      </div>
    </div>
  );
}
