// One row of the Calls table (I calls §2.4): call icon + title + duration · linked records · participants · date, with the
// favourite star and the ⋮ "Call recording menu" on hover. 52 px high; the whole row links to the call.
import { Icon, Popover } from '@agentic-crm/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import type { MouseEvent } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { RecordChip } from '../attributes';
import { formatRelativeTime, formatTimestampAbsolute } from '../attributes/format/formatValue';
import { useWorkspace } from '../shell/workspaceContext';
import { CallFavoriteStar, CallMenu, callPath } from './actions';
import type { CallListItem } from './data';
import * as s from './list.css';
import { formatCallDuration, recordsOfCall } from './model';
import { CallIcon, ParticipantStack } from './parts';

export function CallsTableHead() {
  const col = (icon: 'record' | 'people' | 'calendar' | null, label: string) => (
    <div className={s.headCell} role="columnheader">
      {icon && <Icon icon={icon} size={14} className={s.headIcon} />}
      {label}
    </div>
  );
  return (
    <div className={`${s.tableRow} ${s.tableHead}`} role="row">
      {col(null, 'Call recording')}
      {col('record', 'Record')}
      {col('people', 'Participant')}
      {col('calendar', 'Date')}
      <div className={s.headCell} role="columnheader" aria-hidden="true" />
    </div>
  );
}

function RecordsCell({ call }: { call: CallListItem }) {
  const records = recordsOfCall(call, 'companies');
  const [first, ...rest] = records;
  if (!first) return null;
  return (
    <div className={s.recordChips} data-testid="call-row-records">
      <RecordChip entityDefinitionId={first.entityDefinitionId} entityInstanceId={first.entityInstanceId} />
      {rest.length > 0 && (
        <Popover
          aria-label="Records"
          placement="bottom start"
          trigger={
            <AriaButton
              className={s.moreChip}
              aria-label={`${rest.length} more records`}
              onClick={(e) => e.preventDefault()}
            >
              +{rest.length}
            </AriaButton>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8 }}>
            {rest.map((r) => (
              <RecordChip
                key={r.entityInstanceId}
                entityDefinitionId={r.entityDefinitionId}
                entityInstanceId={r.entityInstanceId}
              />
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

export function CallRow({ call, isFavorite }: { call: CallListItem; isFavorite: boolean }) {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const to = callPath(workspace.slug, call.meetingId, call.id);
  // The row is a click target; the title is a real link (new tab, copy address) and the buttons keep their own clicks.
  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button, [role="menuitem"], [role="dialog"]')) return;
    if (e.metaKey || e.ctrlKey) window.open(to, '_blank', 'noopener');
    else void navigate({ href: to });
  };
  return (
    <div
      className={`${s.tableRow} ${s.dataRow}`}
      role="row"
      data-testid="call-row"
      data-call-id={call.id}
      onClick={open}
    >
      <div className={`${s.cell} ${s.callCell}`} role="cell">
        <CallIcon id={call.id} size={24} />
        <Link to={to} search={{}} className={s.rowLink} data-testid="call-row-link" data-call-link="">
          <span className={s.rowTitle} data-testid="call-row-title">
            {call.title ?? 'Private call'}
          </span>
        </Link>
        <span className={s.rowDuration}>{formatCallDuration(call.durationSeconds)}</span>
      </div>
      <div className={s.cell} role="cell">
        <RecordsCell call={call} />
      </div>
      <div className={s.cell} role="cell">
        <ParticipantStack participants={call.participants} />
      </div>
      <div className={s.cell} role="cell">
        <span className={s.rowDate} title={formatTimestampAbsolute(call.startAt)} data-testid="call-row-date">
          {formatRelativeTime(call.startAt)}
        </span>
      </div>
      <div className={s.cell} role="cell" style={{ justifyContent: 'flex-end', padding: '0 12px 0 0', gap: 2 }}>
        <span className={isFavorite ? undefined : s.rowHoverOnly}>
          <CallFavoriteStar recordingId={call.id} size={20} />
        </span>
        <CallMenu call={call} size={20} className={s.rowHoverOnly} />
      </div>
    </div>
  );
}
