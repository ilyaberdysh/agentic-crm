// Record Emails tab (BACKLOG 7.03; F README §2.2): header "Emails" + Filters + Manage access, thread rows (86 px) that
// open the email modal, loading skeletons, empty and error states, infinite scroll by the server's cursor. What a row
// shows follows the viewer's access: full → everything, subject-line → subject and participants only, metadata-only →
// "Private subject line".
import type { RecordRefInput } from '@agentic-crm/contracts';
import { Avatar, Button, Icon, Popover, Skeleton, Spinner, Switch, toast } from '@agentic-crm/ui';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useMembers } from '../attributes';
import { memberName } from '../attributes/format/formatValue';
import { openWindow } from '../overlays';
import { AccessPanel } from './AccessPanel';
import { type ThreadFilters, type ThreadSummary, useRecordThreads } from './data';
import * as s from './emails.css';
import {
  formatMessageTimestamp,
  formatThreadDate,
  participantName,
  participantsSummary,
  senderOf,
  threadDisplay,
  viaLabel,
} from './model';
import { useTimeZone } from './time';

export interface RecordEmailsTabProps {
  recordRef: RecordRefInput;
  title: string;
  /** The tab has sources in the page layout (Attio: "-" and no Overview section without them). */
  hasSources: boolean;
  /** "Person email access" / "Company email access". */
  accessTitle: string;
  /** The empty state's illustration (the record page's tab empty states share one). */
  illustration?: ReactNode;
}

export function RecordEmailsTab({ recordRef, title, hasSources, accessTitle, illustration }: RecordEmailsTabProps) {
  const [filters, setFilters] = useState<ThreadFilters>({});
  const threads = useRecordThreads(recordRef, filters);
  const rows = useMemo(() => (threads.data?.pages ?? []).flatMap((p) => p.threads), [threads.data]);
  const filtered = filters.hasAttachments === true;

  // Infinite scroll: the next page loads when the end of the list becomes visible.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = threads;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className={s.tab} data-testid="emails-tab">
      <div className={s.header}>
        <h2 className={s.title}>{title}</h2>
        <div className={s.headerActions}>
          <FiltersPopover filters={filters} onChange={setFilters} />
          <Popover
            aria-label={accessTitle}
            placement="bottom end"
            padding={0}
            trigger={
              <Button variant="secondary" size={28} icon="lock" data-testid="emails-manage-access">
                Manage access
              </Button>
            }
          >
            <AccessPanel title={accessTitle} resource={{ type: 'record', record: recordRef }} />
          </Popover>
        </div>
      </div>
      {threads.isPending ? (
        <div className={s.rows} data-testid="emails-loading">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : threads.isError ? (
        <div className={s.empty} data-testid="emails-error">
          <Icon icon="warning" size={24} />
          <div className={s.emptyTitle} style={{ marginTop: 12 }}>
            Emails could not be loaded
          </div>
          <div className={s.emptyText}>An error occurred while we were trying to load the emails of this record.</div>
          <Button variant="secondary" size={28} style={{ marginTop: 16 }} onPress={() => void threads.refetch()}>
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className={s.empty} data-testid="emails-empty">
          {illustration}
          <div className={s.emptyTitle}>{filtered ? 'No matching emails' : 'No emails'}</div>
          <div className={s.emptyText}>
            {filtered
              ? 'No emails of this record match the filters.'
              : !hasSources
                ? 'Add sources to this tab in the page layout to show emails.'
                : "This record doesn't have any emails, or you don't have access to them."}
          </div>
        </div>
      ) : (
        <div className={s.rows} role="list" aria-label="Email threads">
          {rows.map((t) => (
            <ThreadRow key={t.threadId} thread={t} />
          ))}
          <div ref={sentinel} />
          {isFetchingNextPage && (
            <div className={s.loadingRow}>
              <Spinner size={16} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className={s.skeletonRow}>
      <Skeleton shape="circle" width={32} height={32} />
      <div className={s.skeletonBody}>
        <Skeleton width={220} height={12} />
        <Skeleton width={140} height={10} />
        <Skeleton width={320} height={10} />
      </div>
    </div>
  );
}

function FiltersPopover({ filters, onChange }: { filters: ThreadFilters; onChange: (next: ThreadFilters) => void }) {
  const active = filters.hasAttachments === true;
  return (
    <Popover
      aria-label="Filter by"
      placement="bottom end"
      padding={0}
      trigger={
        <Button variant="secondary" size={28} icon="filter" className={s.filtersButton} data-testid="emails-filters">
          Filters
          {active && <span className={s.filtersDot} data-testid="emails-filters-dot" />}
        </Button>
      }
    >
      <div className={s.filterPanel} data-testid="emails-filter-panel">
        <div className={s.filterHead}>
          Filter by
          <Button variant="ghost" size={20} isDisabled={!active} onPress={() => onChange({})}>
            Reset filters
          </Button>
        </div>
        <div className={s.filterItem}>
          <Switch
            isSelected={filters.hasAttachments === true}
            onChange={(on) => onChange({ ...filters, hasAttachments: on ? true : undefined })}
            aria-label="Has attachments"
          >
            Has attachments
          </Switch>
        </div>
      </div>
    </Popover>
  );
}

function ThreadRow({ thread }: { thread: ThreadSummary }) {
  const members = useMembers();
  const timeZone = useTimeZone();
  const display = threadDisplay(thread);
  const sender = senderOf(thread.participants);
  const summary = participantsSummary(thread.participants);
  const owners = thread.viaMemberIds.map((id) => memberName(members.find((m) => m.id === id)) || 'a teammate');
  const via = viaLabel(thread.mailboxCount, owners);
  const open = () => openWindow('email', thread.displayMessageId, {});
  return (
    <div
      role="link"
      tabIndex={0}
      className={s.row}
      data-testid="email-thread-row"
      data-thread-id={thread.threadId}
      data-message-id={thread.displayMessageId}
      data-access={thread.access}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className={s.avatarCol}>
        <Avatar
          name={sender ? participantName(sender) : '?'}
          kind={sender?.memberId ? 'member' : 'person'}
          size={32}
          seed={sender?.emailAddress}
        />
      </div>
      <div className={s.body}>
        <div className={s.line}>
          <span
            className={s.subject}
            data-private={display.isPrivateSubject || undefined}
            data-testid="email-row-subject"
          >
            {display.subject}
          </span>
          <span className={s.meta}>
            {via && (
              <span className={s.via} data-testid="email-row-via">
                <Icon icon="emails" size={12} />
                {via}
              </span>
            )}
            <span title={formatMessageTimestamp(thread.lastMessageAt, timeZone)} data-testid="email-row-date">
              {formatThreadDate(thread.lastMessageAt, Date.now(), timeZone)}
            </span>
          </span>
        </div>
        <div className={s.participants} data-testid="email-row-participants">
          <span className={s.participantNames}>{summary.names.join(', ')}</span>
          {summary.extra > 0 && <span className={s.more}>+{summary.extra}</span>}
        </div>
        <div className={s.snippet}>
          {display.isRestricted ? (
            <RestrictedHint thread={thread} />
          ) : (
            <>
              {display.snippet && (
                <span className={s.snippetText} data-testid="email-row-snippet">
                  {display.snippet}
                </span>
              )}
              {thread.hasAttachments && <Icon icon="attach" size={14} className={s.attach} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Request access from {member}" on a row whose content the viewer cannot read (D §2.9). */
function RestrictedHint({ thread }: { thread: ThreadSummary }) {
  const members = useMembers();
  const owner = thread.viaMemberIds.length === 1 ? members.find((m) => m.id === thread.viaMemberIds[0]) : undefined;
  return (
    <button
      type="button"
      className={s.requestChip}
      data-testid="email-row-request-access"
      onClick={(e) => {
        e.stopPropagation();
        toast({ title: 'Access requests arrive in a later slice' });
      }}
    >
      <Icon icon="lock" size={12} />
      {owner ? `Request access from ${memberName(owner)}` : 'Request access'}
    </button>
  );
}
