// "↻ New data" is shown on a cell header when
// a `report-stale` message made its dataset stale; the tooltip says when the data was last refreshed; clicking
// refetches with `acceptAfter`.
import { Icon, Tooltip } from '@agentic-crm/ui';
import { Button as AriaButton } from 'react-aria-components';
import * as s from './reports.css';

/** "2:40 PM" in the viewer's zone. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}

export function NewDataPill({
  accurateAt,
  refreshing,
  onRefresh,
}: {
  accurateAt: string | undefined;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <Tooltip
      content={accurateAt ? `Data last refreshed at ${formatTime(accurateAt)}` : 'Refresh data'}
      placement="bottom"
    >
      <AriaButton
        className={s.newDataPill}
        aria-label="Refresh data"
        data-testid="new-data-pill"
        isDisabled={refreshing}
        onPress={onRefresh}
      >
        <Icon icon="refresh" size={12} className={refreshing ? s.spinning : undefined} />
        New data
      </AriaButton>
    </Tooltip>
  );
}
