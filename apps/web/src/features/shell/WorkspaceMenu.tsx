// Sidebar header: workspace switcher trigger + menu  and the collapse button.
import {
  Avatar,
  CheckCircleFilled,
  Icon,
  Kbd,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Submenu,
  Tooltip,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { Button } from 'react-aria-components';
import { signOut } from '../../data/session';
import { relevanceSorted, useWorkspaces, type WorkspaceSummary } from '../../data/workspaces';
import { useWorkspaceLogo } from '../settings/workspace/data';
import * as s from './shell.css';
import { useSidebar } from './sidebarState';
import { useWorkspace } from './workspaceContext';

/** Up to 3 workspaces, relevance-sorted; if the active one is not among the first 2 → first 2 + active. */
export function switcherWorkspaces(all: WorkspaceSummary[], activeId: string): WorkspaceSummary[] {
  const sorted = relevanceSorted(all);
  if (sorted.length <= 3) return sorted;
  const firstTwo = sorted.slice(0, 2);
  if (firstTwo.some((w) => w.id === activeId)) return sorted.slice(0, 3);
  const active = sorted.find((w) => w.id === activeId);
  return active ? [...firstTwo, active] : sorted.slice(0, 3);
}

export function SidebarHeader() {
  const { workspace, isAdmin, href } = useWorkspace();
  const sidebar = useSidebar();
  const navigate = useNavigate();
  const all = useWorkspaces();
  const logo = useWorkspaceLogo();
  const shown = switcherWorkspaces(all, workspace.id);
  const more = all.length > 3;

  const go = (to: string) => void navigate({ href: to });

  return (
    <div className={s.header}>
      <MenuTrigger onOpenChange={(open) => sidebar.holdOpen(open)}>
        <Button className={s.workspaceButton} aria-label={`Workspace menu: ${workspace.name}`}>
          <Avatar kind="workspace" name={workspace.name} src={logo} seed={workspace.id} size={24} />
          <span className={s.workspaceName}>{workspace.name}</span>
          <Icon icon="chevronDown" size={16} className={s.workspaceChevron} />
        </Button>
        <Menu width={280} placement="bottom start" offset={8} crossOffset={8} aria-label="Workspace menu">
          <MenuSection aria-label="Workspaces">
            {shown.map((w) => (
              <MenuItem
                key={w.id}
                id={`ws:${w.id}`}
                textValue={w.name}
                icon={<Avatar kind="workspace" name={w.name} src={w.logoUrl} seed={w.id} size={16} />}
                trailing={
                  w.id === workspace.id ? (
                    <CheckCircleFilled size={16} style={{ color: 'var(--ar-color-content-accent)' }} />
                  ) : undefined
                }
                onAction={() => go(`/${w.slug}`)}
              >
                {w.name}
              </MenuItem>
            ))}
            {more ? (
              <Submenu label="All Workspaces" icon="more" menuWidth={260}>
                {relevanceSorted(all).map((w) => (
                  <MenuItem
                    key={w.id}
                    id={`all:${w.id}`}
                    textValue={w.name}
                    icon={<Avatar kind="workspace" name={w.name} src={w.logoUrl} seed={w.id} size={16} />}
                    onAction={() => go(`/${w.slug}`)}
                  >
                    {w.name}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem id="all:new" icon="add" onAction={() => go('/welcome/workspace-details')}>
                  New workspace
                </MenuItem>
              </Submenu>
            ) : (
              <MenuItem id="new-workspace" icon="add" onAction={() => go('/welcome/workspace-details')}>
                New workspace
              </MenuItem>
            )}
          </MenuSection>
          <MenuSeparator />
          <MenuItem id="account-settings" icon="user" onAction={() => go(href('settings/account'))}>
            Account settings
          </MenuItem>
          {isAdmin && (
            <MenuItem id="workspace-settings" icon="settings" onAction={() => go(href('settings/workspace'))}>
              Workspace settings
            </MenuItem>
          )}
          <MenuSeparator />
          {isAdmin && (
            <MenuItem id="invite" icon="invite" onAction={() => go(href('settings/members-and-teams'))}>
              Invite members
            </MenuItem>
          )}
          <MenuItem id="refer" icon="like" onAction={() => go(href('settings/referrals'))}>
            Refer another team
          </MenuItem>
          <MenuSeparator />
          <MenuItem id="apps" icon="apps" onAction={() => go(href('settings/apps'))}>
            Apps
          </MenuItem>
          <MenuSeparator />
          <MenuItem id="sign-out" icon="signOut" onAction={() => signOut()}>
            Sign out
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <Tooltip
        content={
          <>
            {sidebar.mode === 'docked' ? 'Collapse sidebar' : 'Expand sidebar'}{' '}
            <Kbd keys={['mod', '.']} size={20} variant="tooltip" />
          </>
        }
        placement="bottom"
      >
        <Button
          className={s.collapseButton}
          aria-label={sidebar.mode === 'docked' ? 'Collapse sidebar' : 'Expand sidebar'}
          onPress={() => (sidebar.collapsed ? sidebar.setCollapsed(false) : sidebar.setCollapsed(true))}
        >
          <Icon icon="sidebar" size={18} />
        </Button>
      </Tooltip>
    </div>
  );
}
