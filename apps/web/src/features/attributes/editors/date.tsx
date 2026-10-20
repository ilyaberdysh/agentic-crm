// Date and timestamp pickers: month calendar with
// ‹ › month navigation and an editable year, week start from the user's settings, today in accent with a dot,
// quick actions "Today", "Tomorrow", "Next week", "No date"; the timestamp picker adds date and time fields.
import { cx } from '@agentic-crm/ui';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { MONTH_NAMES, todayIso, zonedParts } from '../format/formatValue';
import { getFormatSettings, useFormatSettings } from '../format/locale';
import type { CommitVia, EditorProps } from '../types';
import { parseDateText, parseTimeText, zonedToInstant } from '../values/parse';
import { currentValues, read } from '../values/shapes';
import * as s from './editors.css';
import { EditorPopover } from './shell';

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export interface CalendarProps {
  value: string | null;
  onPick: (iso: string) => void;
  /** Initial focus on the grid (keyboard navigation). */
  autoFocus?: boolean;
  onKeyCommit?: (via: CommitVia) => void;
}

/** Seven-column calendar grid with six rows of 32 px days, spaced 2 px apart. */
export function Calendar({ value, onPick, autoFocus }: CalendarProps) {
  const settings = useFormatSettings();
  const today = todayIso(new Date(), settings);
  const start = value ?? today;
  const [view, setView] = useState(() => ({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) }));
  const [focused, setFocused] = useState<string>(start);
  // The focused-day ring shows only while navigating with the keyboard (the references show none on open).
  const [keyboard, setKeyboard] = useState(false);
  const [yearText, setYearText] = useState(String(view.year));
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => setYearText(String(view.year)), [view.year]);
  useEffect(() => {
    if (autoFocus) gridRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const weekStart = settings.weekStartsOn;
  const cells = useMemo(() => {
    const firstWeekday = new Date(`${isoOf(view.year, view.month, 1)}T00:00:00Z`).getUTCDay();
    const lead = (firstWeekday - weekStart + 7) % 7;
    const first = addDays(isoOf(view.year, view.month, 1), -lead);
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [view, weekStart]);

  const move = (iso: string) => {
    setFocused(iso);
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7));
    if (y !== view.year || m !== view.month) setView({ year: y, month: m });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    setKeyboard(true);
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      move(addDays(focused, step[e.key] as number));
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const next = addMonths(Number(focused.slice(0, 4)), Number(focused.slice(5, 7)), e.key === 'PageUp' ? -1 : 1);
      move(isoOf(next.year, next.month, Math.min(Number(focused.slice(8, 10)), 28)));
    } else if (e.key === 'Enter' || e.key === ' ') {
      onPick(focused);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const commitYear = () => {
    const y = Number(yearText);
    if (Number.isInteger(y) && y >= 1000 && y <= 9999) setView((v) => ({ ...v, year: y }));
    else setYearText(String(view.year));
  };

  const weekdays = Array.from({ length: 7 }, (_, i) => WEEKDAY_LETTERS[(weekStart + i) % 7] as string);
  return (
    <div className={s.calendar}>
      <div className={s.calHeader}>
        <button
          type="button"
          className={s.calNav}
          aria-label="Previous month"
          onClick={() => setView((v) => addMonths(v.year, v.month, -1))}
        >
          <Chevron dir="left" />
        </button>
        <button
          type="button"
          className={s.calNav}
          aria-label="Next month"
          onClick={() => setView((v) => addMonths(v.year, v.month, 1))}
        >
          <Chevron dir="right" />
        </button>
        <span className={s.calMonth} aria-live="polite">
          {MONTH_NAMES[view.month - 1]}
        </span>
        <input
          className={s.calYear}
          value={yearText}
          inputMode="numeric"
          maxLength={4}
          aria-label="Year"
          onChange={(e) => setYearText(e.target.value.replace(/\D/g, ''))}
          onBlur={commitYear}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              commitYear();
            }
          }}
        />
      </div>
      <div
        ref={gridRef}
        className={s.calGrid}
        role="grid"
        aria-label={`${MONTH_NAMES[view.month - 1]} ${view.year}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {weekdays.map((w, i) => (
          <div key={`w${i}`} className={s.calWeekday} role="columnheader">
            {w}
          </div>
        ))}
        {cells.map((iso) => {
          const outside = Number(iso.slice(5, 7)) !== view.month;
          return (
            <button
              key={iso}
              type="button"
              tabIndex={-1}
              role="gridcell"
              aria-selected={iso === value}
              aria-label={iso}
              data-date={iso}
              className={cx(
                s.calDay,
                iso === today && s.calDayToday,
                iso === value && s.calDaySelected,
                keyboard && iso === focused && iso !== value && s.calDayFocused,
                outside && s.calDayOutside,
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(iso)}
            >
              {Number(iso.slice(8, 10))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M7.5 2.5 4 6l3.5 3.5' : 'M4.5 2.5 8 6 4.5 9.5'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Small calendar glyphs for the quick actions (drawn for this project). */
function CalendarGlyph({ mark }: { mark: 'dot' | 'arrow' | 'arrows' | 'none' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.25" width="9" height="8.25" rx="2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M1.5 4.75h9M4 1.25v2M8 1.25v2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      {mark === 'dot' && <circle cx="6" cy="7.5" r="1.1" fill="currentColor" />}
      {mark === 'arrow' && (
        <path
          d="M4.5 7.5h3m-1.2-1.2L7.5 7.5 6.3 8.7"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {mark === 'arrows' && (
        <path
          d="M3.75 7.5h4.5M7 6.25 8.25 7.5 7 8.75M5 6.25 3.75 7.5 5 8.75"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {mark === 'none' && (
        <path d="M4.75 6.5 7.25 9M7.25 6.5 4.75 9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      )}
    </svg>
  );
}

function QuickActions({ onPick }: { onPick: (action: 'today' | 'tomorrow' | 'next-week' | 'none') => void }) {
  const items: Array<[label: string, action: 'today' | 'tomorrow' | 'next-week' | 'none', glyph: ReactNode]> = [
    ['Today', 'today', <CalendarGlyph key="g" mark="dot" />],
    ['Tomorrow', 'tomorrow', <CalendarGlyph key="g" mark="arrow" />],
    ['Next week', 'next-week', <CalendarGlyph key="g" mark="arrows" />],
    ['No date', 'none', <CalendarGlyph key="g" mark="none" />],
  ];
  return (
    <div className={s.quickActions}>
      {items.map(([label, action, glyph]) => (
        <button
          key={action}
          type="button"
          className={s.quickAction}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(action)}
        >
          {glyph}
          {label}
        </button>
      ))}
    </div>
  );
}

// ---- date ------------------------------------------------------------------------------------------------------------

export function DateEditor({ values, onCommit, onCancel, anchor, density = 'cell', attribute }: EditorProps) {
  const current = currentValues(values)[0];
  const value = current ? read.date(current.value) : null;
  const done = useRef(false);
  const commit = (iso: string | null, via: CommitVia) => {
    if (done.current) return;
    done.current = true;
    onCommit(iso ? [{ value: iso }] : [], { via });
  };
  const cancel = (via: CommitVia) => {
    if (done.current) return;
    done.current = true;
    onCancel({ via });
  };
  const today = todayIso(new Date(), getFormatSettings());
  return (
    <EditorPopover
      anchor={anchor}
      density={density}
      label={attribute.title}
      onDismiss={() => cancel('blur')}
      onEscape={() => cancel('escape')}
    >
      <Calendar value={value} onPick={(iso) => commit(iso, 'pick')} autoFocus />
      <div className={s.calendarFooter}>
        <QuickActions
          onPick={(a) =>
            commit(a === 'none' ? null : a === 'today' ? today : addDays(today, a === 'tomorrow' ? 1 : 7), 'pick')
          }
        />
      </div>
    </EditorPopover>
  );
}

// ---- timestamp ---------------------------------------------------------------------------------------------------

/** "mm/dd/yyyy" and "h:mm AM" of an instant in the user's zone. */
function timestampFields(iso: string | null, timeZone: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return { date: '', time: '' };
  const p = zonedParts(new Date(ms), timeZone);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return {
    date: `${pad(p.month)}/${pad(p.day)}/${p.year}`,
    time: `${h12}:${pad(p.minute)} ${p.hour < 12 ? 'AM' : 'PM'}`,
  };
}

export function TimestampEditor({ values, onCommit, onCancel, anchor, density = 'cell', attribute }: EditorProps) {
  const settings = getFormatSettings();
  const current = currentValues(values)[0];
  const value = current ? read.timestamp(current.value) : null;
  const initial = timestampFields(value, settings.timeZone);
  const [dateText, setDateText] = useState(initial.date);
  const [timeText, setTimeText] = useState(initial.time);
  const [invalid, setInvalid] = useState<'date' | 'time' | null>(null);
  const done = useRef(false);
  const today = todayIso(new Date(), settings);
  const selectedDate = value ? todayIso(new Date(Date.parse(value)), settings) : null;

  const minutesOf = (): number | null => {
    if (timeText.trim()) return parseTimeText(timeText);
    if (value) {
      const p = zonedParts(new Date(Date.parse(value)), settings.timeZone);
      return p.hour * 60 + p.minute;
    }
    return 12 * 60;
  };

  const commitAt = (isoDate: string | null, via: CommitVia) => {
    if (done.current) return;
    if (!isoDate) {
      done.current = true;
      onCommit([], { via });
      return;
    }
    const minutes = minutesOf();
    if (minutes === null) {
      setInvalid('time');
      return;
    }
    done.current = true;
    onCommit([{ value: zonedToInstant(isoDate, minutes, settings.timeZone) }], { via });
  };

  const commitFields = (via: CommitVia) => {
    if (!dateText.trim() && !timeText.trim()) return commitAt(null, via);
    const date = parseDateText(dateText, today);
    if (!date) {
      setInvalid('date');
      return;
    }
    commitAt(date, via);
  };

  const fieldKeys = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      commitFields('enter');
    }
  };

  const dirty = dateText !== initial.date || timeText !== initial.time;
  return (
    <EditorPopover
      anchor={anchor}
      density={density}
      label={attribute.title}
      onDismiss={() => {
        if (dirty) commitFields('blur');
        if (!done.current) {
          done.current = true;
          onCancel({ via: 'blur' });
        }
      }}
      onEscape={() => {
        if (done.current) return;
        done.current = true;
        onCancel({ via: 'escape' });
      }}
    >
      <Calendar value={selectedDate} onPick={(iso) => commitAt(iso, 'pick')} autoFocus />
      <div className={s.calendarFooter}>
        <div className={s.timeInputs}>
          <input
            className={s.timeInput}
            style={{ width: 136 }}
            placeholder="mm / dd / yyyy"
            aria-label="Date"
            value={dateText}
            data-invalid={invalid === 'date' || undefined}
            onChange={(e) => {
              setDateText(e.target.value);
              setInvalid(null);
            }}
            onKeyDown={fieldKeys}
          />
          <input
            className={s.timeInput}
            style={{ width: 106 }}
            placeholder="— : —  AM"
            aria-label="Time"
            value={timeText}
            data-invalid={invalid === 'time' || undefined}
            onChange={(e) => {
              setTimeText(e.target.value);
              setInvalid(null);
            }}
            onKeyDown={fieldKeys}
          />
        </div>
        <QuickActions
          onPick={(a) => {
            if (a === 'none') return commitAt(null, 'pick');
            if (a === 'today') {
              if (done.current) return;
              done.current = true;
              onCommit([{ value: new Date().toISOString() }], { via: 'pick' });
              return;
            }
            commitAt(addDays(today, a === 'tomorrow' ? 1 : 7), 'pick');
          }}
        />
      </div>
    </EditorPopover>
  );
}
