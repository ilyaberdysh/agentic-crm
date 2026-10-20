// "Share" of an object or list page (B.12; J permissions §4: "the same controls are available from the Share popover"):
// the Permissions tab in a popover. Members who may not manage grants see the rows without controls.
import { Button, Popover } from '@agentic-crm/ui';
import { PermissionsTab } from '../settings/permissions/PermissionsTab';
import * as s from './access.css';

export function SharePopover({ kind, resourceId }: { kind: 'object' | 'list'; resourceId: string }) {
  return (
    <Popover
      aria-label="Share"
      placement="bottom end"
      width={560}
      padding={0}
      trigger={
        <Button variant="ghost" size={28}>
          Share
        </Button>
      }
    >
      <div className={s.sharePanel} data-testid="share-popover">
        <PermissionsTab kind={kind} resourceId={resourceId} />
      </div>
    </Popover>
  );
}
