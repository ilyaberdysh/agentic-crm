// The inbox (BACKLOG 5.05; notifications.md §1–3): the sidebar Inbox button with its realtime unread badge and the
// popover it opens — legacy frame (heading, "Notifications (n)" / "Requests (n)" tabs, bell empty state) with the v2
// rows. Opening a row marks it read and goes to its target; "Mark all as read" in the header; row options: mark as
// read / unread, archive. 25 rows per page, more on scroll.
import type { Actor, NotificationGroup } from '@agentic-crm/contracts';
import {
  Avatar,
  Badge,
  Button,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Spinner,
  Tooltip,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useMembers } from '../attributes/data/queries';
import { actorName } from '../notes/actors';
import { openNote, openTask } from '../overlays/store';
import { EmptyArt } from '../shell/EmptyArt';
import { useWorkspace } from '../shell/workspaceContext';
import { actorsEyebrow, badgeIconOf, shortAgo, snippetOf, targetOf, titleParts } from './copy';
import {
  badgeLabel,
  type InboxTab,
  useArchive,
  useInboxList,
  useMarkAllRead,
  useMarkRead,
  useMarkUnread,
  useUnreadCount,
} from './data';
import * as s from './inbox.css';

// ---- sidebar button -------------------------------------------------------------------------------------------------------

export function InboxButton() {
  const count = useUnreadCount().data?.count ?? 0;
  const [open, setOpen] = useState(false);
  return (
    <span className={s.buttonWrap}>
      <Popover
        isOpen={open}
        onOpenChange={setOpen}
        aria-label="Notifications"
        placement="right top"
        offset={16}
        crossOffset={-6}
        padding={0}
        trigger={
          <IconButton
            icon="inbox"
            variant="ghost"
            size={28}
            aria-label={count > 0 ? `Inbox, ${count} unread` : 'Inbox'}
            tooltip={count > 0 ? `${count} ${count === 1 ? 'notification' : 'notifications'}` : 'Inbox'}
            isActive={open}
            data-testid="inbox-button"
          />
        }
      >
        {({ close }) => <InboxPanel close={close} />}
      </Popover>
      {count > 0 && (
        <span className={s.badge} data-testid="inbox-badge" aria-hidden="true">
          <Badge variant="primary" size={16}>
            {badgeLabel(count)}
          </Badge>
        </span>
      )}
    </span>
  );
}

// ---- panel ------------------------------------------------------------------------------------------------------------------

function InboxPanel({ close }: { close: () => void }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const counts = useUnreadCount().data;
  const [tab, setTab] = useState<InboxTab>('notifications');
  const list = useInboxList(tab);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const markUnread = useMarkUnread();
  const archive = useArchive();
  const sentinel = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const unread = counts?.count ?? 0;
  const requests = counts?.actionNeeded ?? 0;

  // Infinite scroll: the sentinel under the last row loads the next page (25 per page).
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, groups.length]);

  // A row that goes away (archived) takes the focus with it: keep it inside the inbox so Esc still closes it.
  const rowCount = groups.length;
  useEffect(() => {
    if (document.activeElement === document.body || !document.activeElement) panel.current?.focus();
  }, [rowCount]);

  const open = (group: NotificationGroup) => {
    if (!group.isRead) markRead.mutate([group.id]);
    const target = targetOf(group);
    close();
    if (!target) return;
    switch (target.kind) {
      case 'comment':
        void navigate({ href: href(`comment/${target.commentId}`) });
        break;
      case 'note':
        openNote(target.noteId);
        break;
      case 'task':
        openTask(target.taskId);
        break;
      case 'list':
        void navigate({ href: href(`collection/${target.listId}`) });
        break;
      case 'workflow-run':
        void navigate({
          href: href(`automations/workflows/${target.workflowId}/runs/${target.versionId}/${target.runId}`),
        });
        break;
    }
  };

  return (
    <div className={s.popover} data-testid="inbox" ref={panel} tabIndex={-1}>
      <div className={s.head}>
        <h2 className={s.title}>Notifications</h2>
        <Tooltip content="Mark all as read" placement="bottom">
          <IconButton
            icon="check"
            variant="ghost"
            size={28}
            aria-label="Mark all as read"
            isDisabled={unread === 0 || markAll.isPending}
            onPress={() => markAll.mutate()}
          />
        </Tooltip>
      </div>
      <div className={`${s.tabs} ${groups.length > 0 ? s.tabsRule : ''}`} role="tablist" aria-label="Inbox tabs">
        <button
          type="button"
          role="tab"
          className={s.tab}
          aria-selected={tab === 'notifications'}
          onClick={() => setTab('notifications')}
        >
          Notifications ({unread})
        </button>
        <button
          type="button"
          role="tab"
          className={s.tab}
          aria-selected={tab === 'requests'}
          onClick={() => setTab('requests')}
        >
          Requests ({requests})
        </button>
      </div>
      <div className={s.scroll} role="tabpanel" data-testid="inbox-list">
        {list.isPending && (
          <div className={s.spinnerBox}>
            <Spinner size={20} />
          </div>
        )}
        {list.isError && (
          <div className={s.error}>Something went wrong loading your notifications. Refresh the page to try again.</div>
        )}
        {!list.isPending && !list.isError && groups.length === 0 && (
          <div className={s.empty} data-testid="inbox-empty">
            <EmptyArt icon="notifications" glyph={0.84} stroke={0.6} />
            <div className={s.emptyTitle}>{tab === 'requests' ? 'No requests' : 'No notifications'}</div>
            <div className={s.emptyBody}>
              {tab === 'requests'
                ? 'Requests from other users will be displayed here.'
                : 'Notifications such as mentions and important updates will be displayed here.'}
            </div>
            <Button
              variant="secondary"
              size={28}
              className={s.emptyAction}
              onPress={() => {
                close();
                void navigate({ href: href('settings/notifications') });
              }}
            >
              Settings
            </Button>
          </div>
        )}
        {groups.map((group) => (
          <InboxRow
            key={group.id}
            group={group}
            onOpen={() => open(group)}
            onToggleRead={() => (group.isRead ? markUnread.mutate([group.id]) : markRead.mutate([group.id]))}
            onArchive={() => archive.mutate([group.id])}
          />
        ))}
        {hasNextPage && <div ref={sentinel} className={s.sentinel} />}
        {isFetchingNextPage && (
          <div className={s.spinnerBox} style={{ height: 48 }}>
            <Spinner size={16} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---- row --------------------------------------------------------------------------------------------------------------------

function ActorAvatar({ actor, size }: { actor: Actor; size: 24 | 32 }) {
  const members = useMembers();
  const name = actorName(actor, members);
  if (actor.type === 'workspace-member') {
    return <Avatar name={name} seed={actor.id ?? name} kind="member" size={size} />;
  }
  return <Avatar name={name} seed={name} kind="object" size={size} />;
}

function InboxRow({
  group,
  onOpen,
  onToggleRead,
  onArchive,
}: {
  group: NotificationGroup;
  onOpen: () => void;
  onToggleRead: () => void;
  onArchive: () => void;
}) {
  const members = useMembers();
  const [menuOpen, setMenuOpen] = useState(false);
  const names = group.actors.map((a) => actorName(a, members));
  const eyebrow = actorsEyebrow(names, Math.max(group.actorCount, group.actors.length));
  const snippet = snippetOf(group);
  const unread = !group.isRead;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      className={s.row}
      data-testid="inbox-row"
      data-group-id={group.id}
      data-unread={unread || undefined}
      data-type={group.type}
      data-menu-open={menuOpen || undefined}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      {unread && <span className={s.unreadDot} data-testid="inbox-unread-dot" />}
      <div className={s.avatarSlot}>
        {group.actors.length > 1 ? (
          <div className={s.avatarPair}>
            <span className={s.avatarBack}>
              <ActorAvatar actor={group.actors[1] as Actor} size={24} />
            </span>
            <span className={s.avatarFront}>
              <ActorAvatar actor={group.actors[0] as Actor} size={24} />
            </span>
          </div>
        ) : group.actors[0] ? (
          <ActorAvatar actor={group.actors[0]} size={32} />
        ) : (
          <Avatar name="?" kind="object" size={32} />
        )}
        <span className={s.eventBadge}>
          <Icon icon={badgeIconOf(group.type)} size={12} />
        </span>
      </div>
      <div className={s.textCol}>
        <div className={s.eyebrowRow}>
          <span className={s.eyebrow} data-testid="inbox-eyebrow">
            {eyebrow}
          </span>
          <span className={s.timeSlot}>
            <span className={s.time} title={new Date(group.latestAt).toLocaleString()}>
              {shortAgo(group.latestAt)}
            </span>
          </span>
          <span className={s.actionsSlot} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <MenuTrigger onOpenChange={setMenuOpen}>
              <IconButton
                icon="moreVertical"
                variant="ghost"
                size={20}
                aria-label="Notification options"
                data-testid="inbox-row-options"
              />
              <Menu
                aria-label="Notification options"
                placement="bottom end"
                width={180}
                onAction={(key) => {
                  if (key === 'toggle-read') onToggleRead();
                  if (key === 'archive') onArchive();
                }}
              >
                <MenuItem id="toggle-read" icon={group.isRead ? 'show' : 'check'}>
                  {group.isRead ? 'Mark as unread' : 'Mark as read'}
                </MenuItem>
                <MenuItem id="archive" icon="delete">
                  Archive notification
                </MenuItem>
              </Menu>
            </MenuTrigger>
          </span>
        </div>
        <div className={s.rowTitle} data-unread={unread || undefined} data-testid="inbox-title">
          {titleParts(group).map((part) =>
            part.strong ? (
              <span key={part.text} className={s.rowTitleStrong}>
                {part.text}
              </span>
            ) : (
              part.text
            ),
          )}
        </div>
        {snippet && (
          <div className={s.snippet} data-muted={snippet.muted || undefined}>
            {snippet.text}
          </div>
        )}
      </div>
    </div>
  );
}
