// Call cards: the card of a record's Calls tab and of the favourites strip (I calls) and the meeting card of
// the Activity feed.
import { Icon } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import type { KeyboardEvent, MouseEvent } from 'react';
import { useWorkspace } from '../shell/workspaceContext';
import { useCalendar } from '../tasks/calendar';
import { CallMenu, callPath } from './actions';
import * as s from './cards.css';
import type { CallListItem } from './data';
import { formatActivityDate, formatCallDuration, formatCardDate, summaryLine } from './model';
import { ParticipantStack } from './parts';

/** Opens the call page for a click or Enter on a card (not on its own buttons). */
function useOpenCall(call: Pick<CallListItem, 'id' | 'meetingId'>) {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const open = () => void navigate({ href: callPath(workspace.slug, call.meetingId, call.id) });
  return {
    onClick: (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, a, [role="menuitem"], [role="dialog"]')) return;
      open();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.target === e.currentTarget) open();
    },
  };
}

export function CallCard({ call, variant = 'record' }: { call: CallListItem; variant?: 'record' | 'favorite' }) {
  const { timeZone } = useCalendar();
  const handlers = useOpenCall(call);
  const line = summaryLine(call);
  return (
    <div
      className={`${s.card} ${variant === 'favorite' ? s.cardFavorite : ''}`}
      role="link"
      tabIndex={0}
      data-testid="call-card"
      data-call-id={call.id}
      data-variant={variant}
      {...handlers}
    >
      <div className={s.cardTop}>
        <span className={s.tile} aria-hidden="true">
          <Icon icon="meeting" size={16} />
        </span>
        <span className={s.title} data-testid="call-card-title">
          {call.title ?? 'Private call'}
        </span>
        <CallMenu call={call} size={20} className={s.menu} />
      </div>
      <p
        className={`${s.summary} ${variant === 'favorite' ? s.summaryCompact : ''} ${line.state === 'pending' ? s.summaryPending : ''}`}
        data-testid="call-card-summary"
      >
        {line.text}
      </p>
      {variant === 'record' && (
        <span className={s.dateChip} data-testid="call-card-date">
          <Icon icon="calendar" size={12} />
          {formatCardDate(call, timeZone)}
        </span>
      )}
      <div className={s.footer}>
        <ParticipantStack participants={call.participants} />
        <span className={s.duration}>
          <Icon icon="clock" size={12} />
          {formatCallDuration(call.durationSeconds)}
        </span>
      </div>
    </div>
  );
}

/** The meeting card of the Activity feed for a meeting that has a call: camera tile with a recording dot, concise summary. */
export function ActivityCallCard({ call }: { call: CallListItem }) {
  const { timeZone } = useCalendar();
  const handlers = useOpenCall(call);
  const line = summaryLine(call);
  return (
    <div
      className={s.activityCard}
      role="link"
      tabIndex={0}
      data-testid="event-call-card"
      data-call-id={call.id}
      {...handlers}
    >
      <div className={s.activityHead}>
        <span className={s.activityTile} aria-hidden="true">
          <Icon icon="meeting" size={16} />
          <span className={s.activityBadge} />
        </span>
        <div className={s.activityTexts}>
          <span className={s.activityTitle} data-testid="event-call-title">
            {call.title ?? 'Private call'}
          </span>
          <span className={s.activityMeta}>
            <span data-testid="event-call-time">{formatActivityDate(call, timeZone)}</span>
            <span>·</span>
            <span>{formatCallDuration(call.durationSeconds)}</span>
          </span>
        </div>
        <ParticipantStack participants={call.participants} size={16} />
      </div>
      <p className={s.activitySummary} data-testid="event-call-summary">
        {line.text}
      </p>
    </div>
  );
}
