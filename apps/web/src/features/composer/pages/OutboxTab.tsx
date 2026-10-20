// The Outbox tab (F composer §5): scheduled and erroring emails plus failures of the last three months, oldest delivery
// first — a list (subject, body preview, "Mass send" / "Single send", delivery time or a red "Failed" badge) and a
// preview pane (From / To / Cc / Bcc, subject, body, failure reason) with ⋮ → Cancel email, and "Cancel all emails".
import { AlertDialog, Button, Icon, IconButton, Menu, MenuItem, MenuTrigger, Skeleton, toast } from '@agentic-crm/ui';
import { useEffect, useMemo, useState } from 'react';
import { formatRelativeTime } from '../../attributes/format/formatValue';
import * as n from '../../notes/notesPage.css';
import { type OutboxItem, useCancelOutbox, useOutbox } from '../data';
import * as s from './pages.css';
import { EmptyTab, Toolbar } from './parts';

export const isCancellable = (item: Pick<OutboxItem, 'deliveryState'>): boolean =>
  item.deliveryState === 'scheduled' || item.deliveryState === 'error';

/** Oldest scheduled delivery first (failures sort by when they were due). */
export function sortOutbox(items: readonly OutboxItem[]): OutboxItem[] {
  return [...items].sort((a, b) => Date.parse(a.deliveryScheduledAt) - Date.parse(b.deliveryScheduledAt));
}

/** "now" when due, else the time of day (today) or the date. */
export function deliveryLabel(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (at.getTime() <= now.getTime()) return 'now';
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay
    ? at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const names = (list: readonly { emailAddress: string; name: string | null }[]) =>
  list.map((r) => (r.name ? `${r.name} <${r.emailAddress}>` : r.emailAddress)).join(', ');

function ItemRow({ item, selected, onSelect }: { item: OutboxItem; selected: boolean; onSelect: () => void }) {
  const failed = item.deliveryState === 'failed';
  return (
    <button
      type="button"
      className={s.outboxItem}
      data-selected={selected || undefined}
      data-testid="outbox-item"
      data-item-id={item.id}
      data-state={item.deliveryState}
      onClick={onSelect}
    >
      <span className={s.itemLine}>
        <span className={s.itemSubject}>{item.subject || 'No subject'}</span>
        {failed ? (
          <>
            <span className={s.failedBadge}>Failed</span>
            <span className={s.outboxStatus}>{formatRelativeTime(item.deliveryScheduledAt)}</span>
          </>
        ) : (
          <span className={s.timeChip} data-testid="outbox-time">
            <Icon icon="clock" size={12} />
            {deliveryLabel(item.deliveryScheduledAt)}
          </span>
        )}
      </span>
      <span className={s.itemPreview}>{item.bodyText}</span>
      <span className={s.itemSource}>
        <Icon icon="send" size={12} />
        {item.source === 'mass-send' ? 'Mass send' : 'Single send'}
      </span>
    </button>
  );
}

function Preview({ item, onCancel }: { item: OutboxItem; onCancel: () => void }) {
  return (
    <div className={s.preview} data-testid="outbox-preview" data-item-id={item.id}>
      <div className={s.previewBar}>
        <span className={s.previewTitle}>{item.subject || 'No subject'}</span>
        {isCancellable(item) && (
          <MenuTrigger>
            <IconButton icon="moreVertical" aria-label="Email options" size={28} />
            <Menu aria-label="Email options" placement="bottom end" width={200} onAction={onCancel}>
              <MenuItem id="cancel" icon="close" variant="danger" data-testid="cancel-email">
                Cancel email
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </div>
      {item.failureReason && (
        <div className={s.failureBanner} role="alert" data-testid="outbox-failure">
          <Icon icon="warning" size={16} />
          {item.failureReason}
        </div>
      )}
      <div className={s.previewFields}>
        <div className={s.previewField}>
          <span className={s.previewLabel}>From</span>
          <span className={s.previewValue}>{item.from}</span>
        </div>
        <div className={s.previewField}>
          <span className={s.previewLabel}>To</span>
          <span className={s.previewValue}>{names(item.to)}</span>
        </div>
        {item.cc.length > 0 && (
          <div className={s.previewField}>
            <span className={s.previewLabel}>Cc</span>
            <span className={s.previewValue}>{names(item.cc)}</span>
          </div>
        )}
        {item.bcc.length > 0 && (
          <div className={s.previewField}>
            <span className={s.previewLabel}>Bcc</span>
            <span className={s.previewValue}>{names(item.bcc)}</span>
          </div>
        )}
      </div>
      <div className={s.previewBody}>{item.bodyText}</div>
    </div>
  );
}

export function OutboxTab() {
  const outbox = useOutbox();
  const cancel = useCancelOutbox();
  const items = useMemo(() => sortOutbox(outbox.data ?? []), [outbox.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'one' | 'all' | null>(null);
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const cancellable = items.filter(isCancellable);
  useEffect(() => {
    if (selectedId && !items.some((i) => i.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  const run = (input: { ids: string[] } | { all: true }, done: string, failed: string) =>
    cancel.mutate(input, { onSuccess: () => toast({ title: done }), onError: () => toast.error({ title: failed }) });

  if (outbox.isPending) {
    return (
      <div style={{ padding: 16 }}>
        <Skeleton width="40%" height={12} />
      </div>
    );
  }
  if (outbox.isError) {
    return (
      <div className={n.state} data-testid="index-state">
        <span className={n.stateError}>
          Something went wrong trying to load the outbox. Refresh the page to try again.
        </span>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyTab
        icon="upload"
        title="Email outbox"
        text="Emails scheduled to be sent will appear here"
        learn="Email outbox"
      />
    );
  }
  return (
    <>
      {cancellable.length > 0 && (
        <Toolbar>
          <Button variant="secondary" size={28} icon="close" onPress={() => setConfirm('all')} data-testid="cancel-all">
            Cancel all emails
          </Button>
        </Toolbar>
      )}
      <div className={s.outbox}>
        <div className={s.outboxList} data-testid="outbox-list">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              selected={item.id === selected?.id}
              onSelect={() => setSelectedId(item.id)}
            />
          ))}
        </div>
        {selected && <Preview item={selected} onCancel={() => setConfirm('one')} />}
      </div>
      <AlertDialog
        isOpen={confirm === 'one'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Are you sure you want to cancel this email?"
        description="The email will be removed from your outbox and won’t be sent."
        cancelLabel="Go back"
        confirmLabel="Cancel email"
        onConfirm={() => {
          setConfirm(null);
          if (selected) run({ ids: [selected.id] }, 'Email canceled', 'Failed to cancel email');
        }}
      />
      <AlertDialog
        isOpen={confirm === 'all'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Are you sure you want to cancel these emails?"
        description="All emails will be removed from your outbox and won’t be sent."
        cancelLabel="Go back"
        confirmLabel={`Cancel emails (${cancellable.length})`}
        onConfirm={() => {
          setConfirm(null);
          run({ all: true }, 'All emails canceled', 'Failed to cancel emails');
        }}
      />
    </>
  );
}
