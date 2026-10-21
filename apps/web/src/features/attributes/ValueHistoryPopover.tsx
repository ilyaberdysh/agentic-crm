// "View edit history": a 320 px
// popover beside the cell, "Edit history", a newest-first timeline of "{actor} · 9 Oct 2026 5:06 PM" / "Updated:
// {value}"; hovering an entry shows "Resulting value" in a side card.
import type { Actor } from '@agentic-crm/contracts';
import { cx, PopoverPanel } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { type RefObject, useMemo, useState } from 'react';
import { Dialog } from 'react-aria-components';
import { api, inWorkspace, type WorkspaceRef } from '../../data/trpc';
import { useAttributeEnv } from './data/env';
import { cacheLookup, useMembers } from './data/queries';
import * as d from './dialogs.css';
import { EditorPopover } from './editors/shell';
import { formatHistoryTimestamp, formatValue } from './format/formatValue';
import { buildHistory, type HistoryEvent } from './history';
import { getAttributeUi } from './registry';
import type { AttributeDefinition, AttributeValue, Member, RecordRef, ValueField } from './types';
import { ActorChip, MemberChip } from './ui/primitives';

export interface ValueHistoryPopoverProps {
  recordRef: RecordRef;
  attribute: AttributeDefinition;
  /** The cell / field the popover sits beside. */
  anchor: HTMLElement | null;
  onClose: () => void;
  field?: ValueField;
}

export const historyQuery = (recordRef: RecordRef & { workspace: WorkspaceRef }, attributeId: string) => ({
  queryKey: [
    ...['ws', recordRef.workspace.id, 'attribute-value-list', recordRef.entityDefinitionId, attributeId],
    recordRef.entityInstanceId,
    'history',
  ],
  queryFn: () =>
    api.records.history.query(
      {
        entityDefinitionId: recordRef.entityDefinitionId,
        entityInstanceId: recordRef.entityInstanceId,
        attributeDefinitionId: attributeId,
        limit: 50,
      },
      inWorkspace(recordRef.workspace),
    ),
});

function ActorLine({ actor, members }: { actor: Actor | null; members: Member[] }) {
  if (actor?.type === 'workspace-member')
    return <MemberChip member={members.find((m) => m.id === actor.id)} className={d.historyActor} />;
  return <ActorChip type={actor?.type ?? 'system'} className={d.historyActor} />;
}

const LABEL: Record<HistoryEvent['kind'], string> = {
  updated: 'Updated:',
  added: 'Added:',
  removed: 'Removed:',
  cleared: 'Cleared',
};

export function ValueHistoryPopover({ recordRef, attribute, anchor, onClose, field }: ValueHistoryPopoverProps) {
  const env = useAttributeEnv();
  const ref = { ...recordRef, workspace: recordRef.workspace ?? env.workspace };
  const q = useQuery({ ...historyQuery(ref, attribute.id), staleTime: 0 });
  const members = useMembers();
  const events = useMemo(
    () => buildHistory(attribute, (q.data?.values ?? []) as AttributeValue[]),
    [attribute, q.data],
  );
  return (
    <EditorPopover
      anchor={anchor}
      width={320}
      label="Edit history"
      placement="right"
      onDismiss={onClose}
      onEscape={onClose}
    >
      <HistoryContent attribute={attribute} events={events} members={members} isLoading={q.isPending} field={field} />
    </EditorPopover>
  );
}

/** The popover body (also rendered by the dev gallery with fixture rows). */
export function HistoryContent({
  attribute,
  events,
  members,
  isLoading,
  field,
}: {
  attribute: AttributeDefinition;
  events: HistoryEvent[];
  members: Member[];
  isLoading?: boolean;
  field?: ValueField;
}) {
  const [hover, setHover] = useState<{ key: string; el: HTMLElement } | null>(null);
  const lookup = cacheLookup(attribute.workspaceId);
  // History rows carry their retirement time; format them as the values they were.
  const asCurrent = (values: AttributeValue[]) => values.map((v) => ({ ...v, activeUntil: null }));
  const text = (values: AttributeValue[]) => formatValue(attribute, asCurrent(values), { lookup, field }) || '—';
  const hovered = hover ? events.find((e) => e.key === hover.key) : undefined;
  const ui = getAttributeUi(attribute.type);
  return (
    <div className={d.history}>
      <div className={d.historyTitle}>Edit history</div>
      {isLoading ? (
        <div className={d.historyEmpty}>Loading…</div>
      ) : events.length === 0 ? (
        <div className={d.historyEmpty}>No changes yet</div>
      ) : (
        <div className={d.historyList} role="list">
          {events.map((e, i) => (
            <div
              key={e.key}
              role="listitem"
              className={d.historyEntry}
              data-active={hover?.key === e.key || undefined}
              onPointerEnter={(ev) => setHover({ key: e.key, el: ev.currentTarget })}
              onPointerLeave={() => setHover((h) => (h?.key === e.key ? null : h))}
            >
              <span className={cx(d.historyDot, e.isLatest && d.historyDotCurrent)} aria-hidden="true" />
              {i < events.length - 1 && <span className={d.historyLine} aria-hidden="true" />}
              <span className={d.historyMeta}>
                <ActorLine actor={e.actor} members={members} />
                <span className={d.historyTime}>· {formatHistoryTimestamp(e.at)}</span>
              </span>
              <span className={d.historyValue}>
                <span className={d.historyLabel}>{LABEL[e.kind]}</span>
                {e.value ? ` ${text([{ ...e.value, activeUntil: null }])}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      {hovered && hover && (
        <PopoverPanel
          triggerRef={{ current: hover.el } as RefObject<Element>}
          isOpen
          isNonModal
          placement="right top"
          offset={17}
          crossOffset={3}
          width={239}
          padding={0}
        >
          <Dialog aria-label="Resulting value" style={{ outline: 'none' }}>
            <div className={d.resulting}>
              <span className={d.resultingLabel}>Resulting value</span>
              {hovered.resulting.length > 0 && attribute.type !== 'text' ? (
                <ui.View attribute={attribute} values={asCurrent(hovered.resulting)} density="chip" field={field} />
              ) : (
                <span className={d.resultingValue}>{text(hovered.resulting)}</span>
              )}
            </div>
          </Dialog>
        </PopoverPanel>
      )}
    </div>
  );
}
