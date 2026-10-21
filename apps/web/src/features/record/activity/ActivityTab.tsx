// Activity tab (BACKLOG 3.04): header with Filters ("Visible events", persisted per object, accent dot
// when not default) and "Add meeting"; "Upcoming" (soonest first, 2 shown, "Show more upcoming events" pages by 3);
// past events newest first under period headers on a thread line; runs of automation events collapse into
// "{n} automation events"; the next page loads when the end of the feed scrolls into view.
import type { TimelineEvent, TimelineItem } from '@agentic-crm/contracts';
import { Button, Icon, Popover, Spinner, Switch } from '@agentic-crm/ui';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { usePersistentState } from '../../../lib/storage';
import { formatRelativeTime } from '../../attributes/format/formatValue';
import { NewMeetingDialog } from '../adapters';
import { useRecordPage } from '../context';
import { usePastTimeline, useUpcomingTimeline, useWeekStart } from '../data';
import * as r from '../record.css';
import * as s from './activity.css';
import {
  ActorAvatar,
  displayEvent,
  EventCard,
  EventSentence,
  type Hydrated,
  type SentenceContext,
  useEventHydration,
} from './events';
import {
  activityFiltersKey,
  FILTER_CATEGORIES,
  groupByPeriod,
  isDefaultVisible,
  itemKey,
  normaliseVisible,
  renderableItems,
  requestCategories,
  toggleCategory,
  type VisibleCategory,
} from './model';

export function useVisibleEvents(entityDefinitionId: string) {
  const [stored, setStored] = usePersistentState<unknown>(activityFiltersKey(entityDefinitionId), null);
  const visible = useMemo(() => normaliseVisible(stored), [stored]);
  return [visible, (next: VisibleCategory[]) => setStored(next)] as const;
}

export function ActivityTab() {
  const { object, recordRef } = useRecordPage();
  const [visible, setVisible] = useVisibleEvents(object.id);
  const [addingMeeting, setAddingMeeting] = useState(false);
  return (
    <div data-testid="activity-tab">
      <div className={r.tabHeader}>
        <h2 className={r.tabTitle}>Activity</h2>
        <div className={r.tabHeaderActions}>
          <FiltersMenu visible={visible} onChange={setVisible} />
          <span className={s.headerDivider} />
          <Button
            variant="secondary"
            size={28}
            icon="add"
            onPress={() => setAddingMeeting(true)}
            data-testid="add-meeting"
          >
            Add meeting
          </Button>
        </div>
      </div>
      {addingMeeting && <NewMeetingDialog record={recordRef} onClose={() => setAddingMeeting(false)} />}
      {visible.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyTitle}>No event categories selected</div>
          <div className={s.emptyText}>Enable categories in Filters to see activity</div>
        </div>
      ) : (
        <Feed visible={visible} />
      )}
    </div>
  );
}

function FiltersMenu({
  visible,
  onChange,
}: {
  visible: VisibleCategory[];
  onChange: (next: VisibleCategory[]) => void;
}) {
  return (
    <Popover
      aria-label="Visible events"
      placement="bottom end"
      width={240}
      padding={0}
      trigger={
        <Button variant="secondary" size={28} icon="filter" className={s.filtersButton}>
          Filters
          {!isDefaultVisible(visible) && <span className={s.filtersDot} data-testid="filters-dot" />}
        </Button>
      }
    >
      <div className={s.filtersPanel}>
        <div className={s.filtersHeading}>Visible events</div>
        {FILTER_CATEGORIES.map((c) => (
          <Switch
            key={c.id}
            isSelected={visible.includes(c.id)}
            onChange={() => onChange(toggleCategory(visible, c.id))}
            className={s.filterItem}
            aria-label={c.label}
          >
            <Icon icon={c.icon} size={16} />
            <span className={s.filterLabel}>{c.label}</span>
          </Switch>
        ))}
      </div>
    </Popover>
  );
}

function Feed({ visible }: { visible: VisibleCategory[] }) {
  const { recordRef, object, attributes } = useRecordPage();
  const weekStart = useWeekStart();
  const filters = useMemo(() => requestCategories(visible), [visible]);
  const past = usePastTimeline(recordRef, { filters });
  const upcoming = useUpcomingTimeline(recordRef, { filters });
  const [upcomingShown, setUpcomingShown] = useState(2);

  const pastItems = useMemo(() => renderableItems((past.data?.pages ?? []).flatMap((p) => p.events)), [past.data]);
  const upcomingItems = useMemo(
    () => renderableItems((upcoming.data?.pages ?? []).flatMap((p) => p.events)),
    [upcoming.data],
  );
  const shownUpcoming = upcomingItems.slice(0, upcomingShown);
  const allEvents = useMemo(
    () =>
      [...shownUpcoming, ...pastItems].flatMap((i): TimelineEvent[] => (i.kind === 'single' ? [i.event] : i.events)),
    [shownUpcoming, pastItems],
  );
  const hydrated = useEventHydration(recordRef, allEvents);
  const groups = useMemo(() => groupByPeriod(pastItems, new Date(), weekStart), [pastItems, weekStart]);
  const ctx: SentenceContext = { object, attributes };

  // Infinite scroll: the next page loads when the end of the feed becomes visible.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !past.hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !past.isFetchingNextPage) void past.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [past.hasNextPage, past.isFetchingNextPage, past.fetchNextPage]);

  if (past.isError) {
    return (
      <div className={s.empty}>
        <div className={s.emptyTitle}>Activity could not be loaded</div>
        <div className={s.emptyText}>An error occurred while we were trying to load the activity feed</div>
      </div>
    );
  }
  if (past.isPending) {
    return (
      <div className={s.loadingRow}>
        <Spinner size={16} />
      </div>
    );
  }
  const canShowMoreUpcoming = upcomingItems.length > upcomingShown || upcoming.hasNextPage;
  return (
    <div className={s.feed} data-testid="activity-feed">
      {shownUpcoming.length > 0 && (
        <div className={s.group} data-upcoming="">
          <h3 className={s.upcomingTitle}>Upcoming</h3>
          {shownUpcoming.map((item, i) => (
            <FeedItem
              key={itemKey(item)}
              item={item}
              ctx={ctx}
              hydrated={hydrated}
              last={i === shownUpcoming.length - 1}
              upcoming
            />
          ))}
          {canShowMoreUpcoming && (
            <button
              type="button"
              className={s.showMore}
              onClick={() => {
                setUpcomingShown((n) => n + 3);
                if (upcomingItems.length <= upcomingShown + 3 && upcoming.hasNextPage) void upcoming.fetchNextPage();
              }}
            >
              Show more upcoming events
            </button>
          )}
        </div>
      )}
      {groups.length === 0 && shownUpcoming.length === 0 && (
        <div className={s.empty}>
          <div className={s.emptyTitle}>No activity yet</div>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.period.key} className={s.group} data-testid="activity-period">
          <h3 className={s.sectionTitle}>{g.period.label}</h3>
          {g.items.map((item, i) => (
            <FeedItem key={itemKey(item)} item={item} ctx={ctx} hydrated={hydrated} last={i === g.items.length - 1} />
          ))}
        </div>
      ))}
      <div ref={sentinel} />
      {past.isFetchingNextPage && (
        <div className={s.loadingRow}>
          <Spinner size={16} />
        </div>
      )}
    </div>
  );
}

function FeedItem({
  item,
  ctx,
  hydrated,
  last,
  upcoming,
}: {
  item: TimelineItem;
  ctx: SentenceContext;
  hydrated: Hydrated;
  last: boolean;
  upcoming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (item.kind === 'single') {
    return <EventRow event={item.event} ctx={ctx} hydrated={hydrated} last={last} upcoming={upcoming} />;
  }
  return (
    <>
      <button
        type="button"
        className={s.groupToggle}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="automation-group"
      >
        <Icon icon="chevronDown" size={16} className={s.groupChevron} data-open={open || undefined} />
        {item.events.length} automation events
      </button>
      {open &&
        item.events.map((event, i) => (
          <Fragment key={event.id}>
            <EventRow
              event={event}
              ctx={ctx}
              hydrated={hydrated}
              last={last && i === item.events.length - 1}
              upcoming={upcoming}
            />
          </Fragment>
        ))}
    </>
  );
}

function EventRow({
  event,
  ctx,
  hydrated,
  last,
  upcoming,
}: {
  event: TimelineEvent;
  ctx: SentenceContext;
  hydrated: Hydrated;
  last: boolean;
  upcoming?: boolean;
}) {
  const shown = displayEvent(event, hydrated);
  return (
    <div
      className={s.row}
      data-last={last || undefined}
      data-upcoming={upcoming || undefined}
      data-testid="activity-event"
      data-event-type={event.eventType}
    >
      <div className={s.gutter}>
        <ActorAvatar actor={shown.actor} />
      </div>
      <div className={s.main}>
        <div className={s.line}>
          <span className={s.sentence}>
            <EventSentence event={shown} ctx={ctx} />
          </span>
          <span className={s.time} title={new Date(event.occurredAt).toLocaleString()}>
            {formatRelativeTime(event.occurredAt)}
          </span>
        </div>
        <EventCard event={event} hydrated={hydrated} />
      </div>
    </div>
  );
}
