import { Icon, Tooltip } from '@agentic-crm/ui';
import { Button as AriaButton } from 'react-aria-components';
import * as s from './access.css';

/** "Read only" in a page header: the member may look at the records but not change them. */
export function ReadOnlyBadge({ what }: { what: string }) {
  return (
    <Tooltip content={`You can view ${what} but not change them`}>
      <AriaButton
        className={s.readOnly}
        data-testid="read-only-badge"
        aria-label={`Read only: you can view ${what} but not change them`}
      >
        <Icon icon="lock" size={12} />
        Read only
      </AriaButton>
    </Tooltip>
  );
}
