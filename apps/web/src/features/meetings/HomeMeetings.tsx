// The Meetings widget of Home (BACKLOG 7.04): header with the date button (date picker),
// previous / next day and "Meeting filters"; the viewer's meetings of the selected day (at most five visible, "{n} past
// events" / "{n} more events" collapse the rest); one meeting expanded at a time (today: the current or next one) with
// details, participants, linked records and "Open meeting". Data: `meetings.list({mine, from, to})`.

import { addDays, localDateOf } from '@agentic-crm/contracts';
import { Button, Checkbox, Icon, IconButton, Popover, Skeleton, Tooltip, toast } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { api, inWorkspace } from '../../data/trpc';
import { usePersistentState } from '../../lib/storage';
import { openAsk } from '../ask';
import { RecordChip } from '../attributes';
import { useMailboxes } from '../mailboxes/data';
import { openWindow } from '../overlays';
import { useWorkspace } from '../shell/workspaceContext';
import { useCalendar } from '../tasks';
import { DeadlinePicker } from '../tasks/DeadlinePicker';
import { type Meeting, useMeetingsList } from './data';
import * as s from './meetings.css';
import {
  applyMeetingFilters,
  currentOrNextIndex,
  DEFAULT_MEETING_FILTERS,
  dayBounds,
  homeDateLabel,
  isPast,
  type MeetingFilters,
  myStatus,
  normaliseFilters,
  rowTimeLabel,
  rsvpOf,
  windowMeetings,
} from './model';
import { ParticipantAvatar, useNow, useParticipantName } from './parts';

const FILTERS_KEY = 'home-meeting-filters';
const SHOWN_PARTICIPANTS = 5;

export function HomeMeetings() {
  const { workspace } = useWorkspace();
  const calendar = useCalendar();
  const now = useNow();
  const today = calendar.today();
  const [date, setDate] = useState<string | null>(null);
  const day = date ?? today;
  const [stored, setStored] = usePersistentState<unknown>(FILTERS_KEY, DEFAULT_MEETING_FILTERS);
  const filters = useMemo(() => normaliseFilters(stored), [stored]);
  const bounds = useMemo(() => dayBounds(day, calendar.timeZone), [day, calendar.timeZone]);
  const query = useMeetingsList({ mine: true, from: bounds.from, to: bounds.to, sort: 'start_asc' });
  const mailboxes = useMailboxes();
  const [manual, setManual] = useState<Record<string, string | null>>({});
  const [showAllPast, setShowAllPast] = useState(false);
  const [showAllLater, setShowAllLater] = useState(false);
  const [looking, setLooking] = useState(false);

  const all = query.data?.meetings ?? [];
  const list = useMemo(
    () => applyMeetingFilters(all, filters, workspace.membership.id),
    [all, filters, workspace.membership.id],
  );
  const anchor = day === today ? currentOrNextIndex(list, now) : null;
  const expandedId = day in manual ? manual[day] : day === today && anchor !== null ? (list[anchor]?.id ?? null) : null;
  const windowed = windowMeetings(list, anchor);
  const shown = [...(showAllPast ? windowed.earlier : []), ...windowed.shown, ...(showAllLater ? windowed.later : [])];
  const filtersOn = !(filters.allDay && filters.withoutConferencing && filters.declined);
  const noCalendar = mailboxes.isSuccess && mailboxes.data.length === 0;

  const nextDayWithMeetings = async () => {
    setLooking(true);
    try {
      const from = dayBounds(addDays(day, 1), calendar.timeZone).from;
      const to = dayBounds(addDays(day, 7), calendar.timeZone).to;
      const out = await api.meetings.list.query(
        { mine: true, from, to, sort: 'start_asc', limit: 50 },
        inWorkspace({ id: workspace.id, slug: workspace.slug }),
      );
      const first = applyMeetingFilters(out.meetings, filters, workspace.membership.id)[0];
      if (!first) {
        toast({ title: 'No meetings in the next 7 days' });
        return;
      }
      const startDay =
        first.isAllDay && first.start.date ? first.start.date : localDateOf(first.start.at, calendar.timeZone);
      setDate(startDay);
    } finally {
      setLooking(false);
    }
  };

  return (
    <section className={s.homeBlock} aria-label="Meetings" data-testid="home-meetings">
      <div className={s.homeHeader}>
        <h2 className={s.homeTitle}>Meetings</h2>
        <Popover
          aria-label="Pick a date"
          placement="bottom end"
          padding={0}
          trigger={
            <AriaButton className={s.homeDate} data-testid="home-meetings-date">
              {homeDateLabel(day, today)}
            </AriaButton>
          }
        >
          {({ close }) => (
            <DeadlinePicker
              value={{ date: day, time: null }}
              calendar={calendar}
              onChange={(d) => {
                setDate(d?.date ?? today);
                close();
              }}
            />
          )}
        </Popover>
        <IconButton
          icon="chevronLeft"
          variant="ghost"
          size={20}
          aria-label="Previous day"
          tooltip="Previous day"
          onPress={() => setDate(addDays(day, -1))}
        />
        <IconButton
          icon="chevronRight"
          variant="ghost"
          size={20}
          aria-label="Next day"
          tooltip="Next day"
          onPress={() => setDate(addDays(day, 1))}
        />
        <Popover
          aria-label="Meeting filters"
          placement="bottom end"
          padding={0}
          trigger={
            <IconButton
              icon="moreVertical"
              variant="ghost"
              size={20}
              aria-label="Meeting filters"
              tooltip="Meeting filters"
              data-testid="home-meetings-filters"
              isActive={filtersOn}
            />
          }
        >
          <FilterMenu filters={filters} onChange={(next) => setStored(next)} />
        </Popover>
      </div>

      {query.isPending ? (
        <div className={s.homeRows} data-testid="home-meetings-loading">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={s.homeSkeleton}>
              <Skeleton shape="circle" width={10} height={10} />
              <Skeleton width={180} height={10} />
            </div>
          ))}
        </div>
      ) : query.isError ? (
        <div className={s.homeError}>Failed to load meetings</div>
      ) : list.length === 0 ? (
        <Empty
          filtered={all.length > 0}
          noCalendar={noCalendar && all.length === 0}
          looking={looking}
          onNext={() => void nextDayWithMeetings()}
          onClear={() => setStored(DEFAULT_MEETING_FILTERS)}
        />
      ) : (
        <div className={s.homeRows} data-testid="home-meetings-list">
          {windowed.earlier.length > 0 && !showAllPast && (
            <button type="button" className={s.homeMore} onClick={() => setShowAllPast(true)}>
              <Icon icon="history" size={16} />
              {windowed.earlier.length} past events
            </button>
          )}
          {shown.map((m) => (
            <MeetingItem
              key={m.id}
              meeting={m}
              now={now}
              expanded={expandedId === m.id}
              onToggle={() => setManual((cur) => ({ ...cur, [day]: expandedId === m.id ? null : m.id }))}
            />
          ))}
          {windowed.later.length > 0 && !showAllLater && (
            <button type="button" className={s.homeMore} onClick={() => setShowAllLater(true)}>
              <Icon icon="more" size={16} />
              {windowed.later.length} more events
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Empty({
  filtered,
  noCalendar,
  looking,
  onNext,
  onClear,
}: {
  filtered: boolean;
  noCalendar: boolean;
  looking: boolean;
  onNext: () => void;
  onClear: () => void;
}) {
  const navigate = useNavigate();
  const { href } = useWorkspace();
  if (filtered) {
    return (
      <div className={s.homeEmpty} data-testid="home-meetings-empty">
        <div className={s.homeEmptyTitle}>No matching meetings</div>
        <div className={s.homeEmptyText}>Clear filters or pick a different date</div>
        <Button variant="secondary" size={28} onPress={onClear}>
          Clear filters
        </Button>
      </div>
    );
  }
  if (noCalendar) {
    return (
      <div className={s.homeEmpty} data-testid="home-meetings-connect">
        <div className={s.homeEmptyTitle}>Turn meetings into opportunities</div>
        <div className={s.homeEmptyText}>Sync your calendar to get instant meeting context</div>
        <Button
          variant="secondary"
          size={28}
          icon="calendarAdd"
          onPress={() => void navigate({ href: href('settings/email-and-calendar-accounts') })}
        >
          Sync your calendar
        </Button>
      </div>
    );
  }
  return (
    <div className={s.homeEmpty} data-testid="home-meetings-empty">
      <div className={s.homeEmptyTitle}>No meetings</div>
      <div className={s.homeEmptyText}>Pick a different date to plan ahead or review past meetings</div>
      <Button variant="secondary" size={28} isPending={looking} onPress={onNext}>
        Next day with meetings
      </Button>
    </div>
  );
}

function FilterMenu({ filters, onChange }: { filters: MeetingFilters; onChange: (next: MeetingFilters) => void }) {
  const row = (key: keyof MeetingFilters, label: string, icon: 'calendarDays' | 'meeting' | 'error') => (
    <div className={s.filterItem}>
      <Checkbox isSelected={filters[key]} onChange={(on) => onChange({ ...filters, [key]: on })}>
        <Icon icon={icon} size={16} />
        {label}
      </Checkbox>
    </div>
  );
  return (
    <div className={s.filterMenu} data-testid="home-meetings-filter-menu">
      <div className={s.filterLabel}>Show</div>
      {row('allDay', 'All-day events', 'calendarDays')}
      {row('withoutConferencing', 'Events without conferencing', 'meeting')}
      {row('declined', 'Declined events', 'error')}
    </div>
  );
}

/** Plain text of an HTML or text description (one line in the card). */
function plain(text: string | null): string {
  return (text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function MeetingItem({
  meeting,
  now,
  expanded,
  onToggle,
}: {
  meeting: Meeting;
  now: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { workspace } = useWorkspace();
  const { timeZone } = useCalendar();
  const ended = isPast(meeting, now);
  const status = myStatus(meeting, workspace.membership.id);
  const tone = status ? rsvpOf(status, ended).tone : undefined;
  const title = meeting.title === null ? 'Private meeting' : meeting.title || 'Untitled meeting';
  const open = () => openWindow('meeting', meeting.id, {});
  const row = (
    <button
      type="button"
      className={s.homeRow}
      data-testid="home-meeting"
      data-meeting-id={meeting.id}
      data-ended={(!expanded && ended) || undefined}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className={s.homeStatus} data-tone={tone} aria-hidden="true" />
      <span className={s.homeRowTitle} data-title="">
        {title}
      </span>
      <span className={s.homeRowTime}>{rowTimeLabel(meeting, timeZone)}</span>
    </button>
  );
  if (!expanded) return row;
  return (
    <div className={s.homeCard} data-testid="home-meeting-card" data-meeting-id={meeting.id}>
      <div className={s.homeCardHead}>
        <button
          type="button"
          className={s.homeRow}
          style={{ flex: 1, padding: 0, height: 40 }}
          onClick={onToggle}
          aria-expanded
        >
          <span className={s.homeStatus} data-tone={tone} aria-hidden="true" />
          <span className={s.homeRowTitle}>{title}</span>
          <span className={s.homeRowTime}>{rowTimeLabel(meeting, timeZone)}</span>
        </button>
        <Tooltip content="Open meeting">
          <IconButton
            icon="expand"
            variant="ghost"
            size={20}
            aria-label="Open meeting"
            onPress={open}
            data-testid="home-meeting-open"
          />
        </Tooltip>
      </div>
      <ExpandedBody meeting={meeting} ended={ended} />
      <div className={s.homeCardFoot}>
        <Button
          variant="secondary"
          size={28}
          icon="askAi"
          onPress={() => openAsk({ context: { meeting: { meetingId: meeting.id } } })}
        >
          Ask AI
        </Button>
        {meeting.conferenceUrl && !ended && (
          <Button
            variant="primary"
            size={28}
            icon="meeting"
            onPress={() => window.open(meeting.conferenceUrl as string, '_blank', 'noopener,noreferrer')}
          >
            Join meeting
          </Button>
        )}
      </div>
    </div>
  );
}

function ExpandedBody({ meeting, ended }: { meeting: Meeting; ended: boolean }) {
  const nameOf = useParticipantName();
  const [all, setAll] = useState(false);
  const description = plain(meeting.description);
  const sorted = [...meeting.participants].sort((a, b) => Number(b.isOrganizer) - Number(a.isOrganizer));
  const shown = all ? sorted : sorted.slice(0, SHOWN_PARTICIPANTS);
  return (
    <div className={s.homeCardBody}>
      {(description || meeting.conferenceUrl) && (
        <div>
          <div className={s.homeCardLabel}>Details</div>
          {description && <div className={s.homeCardText}>{description}</div>}
          {meeting.conferenceUrl && (
            <a className={s.link} href={meeting.conferenceUrl} target="_blank" rel="noreferrer">
              {meeting.conferenceUrl}
            </a>
          )}
        </div>
      )}
      <div>
        <div className={s.homeCardLabel}>
          Participants <span className={s.sectionCount}>{meeting.participants.length}</span>
        </div>
        {shown.map((p) => (
          <div key={p.id} className={s.person} style={{ minHeight: 32 }}>
            <ParticipantAvatar name={nameOf(p)} memberId={p.memberId} seed={p.emailAddress} />
            <span className={s.personName}>{nameOf(p)}</span>
            {p.isOrganizer && <span className={s.hostTag}>Host</span>}
            {p.emailAddress && p.emailAddress !== nameOf(p) && <span className={s.email}>{p.emailAddress}</span>}
            <span className={s.personRight}>
              <span
                className={s.homeStatus}
                data-tone={rsvpOf(p.status, ended).tone}
                title={rsvpOf(p.status, ended).label}
              />
            </span>
          </div>
        ))}
        {meeting.participants.length > SHOWN_PARTICIPANTS && (
          <button type="button" className={s.showAll} onClick={() => setAll((v) => !v)}>
            {all ? 'Show less' : 'Show all'}
          </button>
        )}
      </div>
      {meeting.linkedRecords.length > 0 && (
        <div>
          <div className={s.homeCardLabel}>
            Linked records <span className={s.sectionCount}>{meeting.linkedRecords.length}</span>
          </div>
          <div className={s.linked}>
            {meeting.linkedRecords.map((r) => (
              <RecordChip
                key={r.entityInstanceId}
                entityDefinitionId={r.entityDefinitionId}
                entityInstanceId={r.entityInstanceId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
