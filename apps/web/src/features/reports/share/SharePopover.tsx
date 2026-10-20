// Dashboard Share popover: the header's
// "Share" button (a text button: the avatar in front of it in the capture is the viewer's presence avatar, which the
// dashboard header draws) opens a 420 px popover below it: "Workspace access" with its level, the
// add row ("Search..." + level + Add), "Teams" and "Individual members" with a level dropdown each, and "Learn more
// about permissions". A level change is saved at once (permissions.put), there is no Save button. Members without
// Full access see it read-only. The pieces (PermissionLevelSelect, GrantRow, the grants hooks) are exported from
//./index for Settings → Dashboards → Permissions.
import { Avatar, Button, Icon, Popover, Skeleton } from '@agentic-crm/ui';
import { useState } from 'react';
import { brand } from '../../../lib/brand';
import { useWorkspace } from '../../shell/workspaceContext';
import { useWs } from '../data';
import { setGrantLevel, useGrants } from './data';
import { GrantRow } from './GrantRow';
import { splitGrants } from './grants';
import { PermissionLevelSelect } from './PermissionLevelSelect';
import * as s from './share.css';
import { TargetSearch } from './TargetSearch';

export interface SharePopoverProps {
  dashboardId: string;
  /** The viewer may change grants (Full access on the dashboard, or an admin). */
  canManage: boolean;
}

export function SharePopover({ dashboardId, canManage }: SharePopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      placement="bottom end"
      offset={6}
      width={420}
      aria-label="Share dashboard"
      trigger={
        <Button variant="ghost" size={28} isActive={open} className={s.trigger} data-testid="share-button">
          Share
        </Button>
      }
    >
      <ShareBody dashboardId={dashboardId} canManage={canManage} />
    </Popover>
  );
}

function ShareBody({ dashboardId, canManage }: SharePopoverProps) {
  const { workspace } = useWorkspace();
  const ws = useWs();
  const grants = useGrants(dashboardId);
  const { workspace: workspaceGrant, teams, members } = splitGrants(grants.data);
  const manage = canManage && (grants.data?.canManage ?? true);
  return (
    <div className={s.popover} data-testid="share-popover">
      <div className={s.workspaceRow}>
        <Avatar kind="workspace" name={workspace.name} src={workspace.logoUrl} seed={workspace.id} size={34} />
        <span className={s.workspaceTitle}>Workspace access</span>
        {workspaceGrant ? (
          <PermissionLevelSelect
            value={workspaceGrant.level}
            aria-label="Workspace access"
            isDisabled={!manage}
            onChange={(level) => void setGrantLevel(ws, dashboardId, { type: 'workspace', id: workspace.id }, level)}
            data-testid="share-workspace-level"
          />
        ) : (
          <Skeleton shape="text" width={80} />
        )}
      </div>
      <hr className={s.rule} />
      <div className={s.body}>
        <TargetSearch dashboardId={dashboardId} grants={grants.data} disabled={!manage} />
        {grants.isError && (
          <p className={s.note} role="alert">
            Failed to load who has access.
          </p>
        )}
        {teams.length > 0 && (
          <>
            <div className={s.sectionLabel}>Teams</div>
            {teams.map((g) => (
              <GrantRow key={g.target.id} grant={g} dashboardId={dashboardId} canManage={manage} />
            ))}
          </>
        )}
        <div className={s.sectionLabel}>Individual members</div>
        {grants.isPending && <Skeleton shape="text" width={160} />}
        {members.map((g) => (
          <GrantRow key={g.target.id} grant={g} dashboardId={dashboardId} canManage={manage} />
        ))}
        {!manage && grants.data && (
          <p className={s.note}>You need Full access to this dashboard to change who can see it.</p>
        )}
      </div>
      <hr className={s.rule} />
      <div className={s.footer}>
        <a className={s.footerLink} href={brand.supportUrl} target="_blank" rel="noreferrer">
          <Icon icon="help" size={16} />
          Learn more about permissions
        </a>
      </div>
    </div>
  );
}
