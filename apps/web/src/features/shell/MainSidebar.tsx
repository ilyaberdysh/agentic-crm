// Main sidebar: header, Search row, main nav, Records (objects from the API), Lists, footer.
import {
  Icon,
  IconButton,
  IconTile,
  Kbd,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  NavItem,
  Skeleton,
  Tooltip,
  toast,
} from '@agentic-crm/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { Button } from 'react-aria-components';
import { objectPath, type RecordsSort, sortObjects, useObjects } from '../../data/objects';
import { usePersistentState } from '../../lib/storage';
import { ChatsSection } from '../ask/ChatsSection';
import { openQuickActions } from '../command-palette';
import { FavoritesSection } from '../favorites/FavoritesSection';
import { SidebarLists } from '../lists/SidebarLists';
import { InboxButton } from '../notifications/InboxPopover';
import { useAction } from '../shortcuts/catalog';
import { ShortcutTooltip } from '../shortcuts/ShortcutHint';
import { TasksBadge } from '../tasks/TasksBadge';
import { mainNav, type NavEntry } from './navigation';
import { objectAppearance } from './objectAppearance';
import { SidebarSection } from './SidebarSection';
import * as s from './shell.css';
import { useSidebar } from './sidebarState';
import { SidebarHeader } from './WorkspaceMenu';
import { useWorkspace } from './workspaceContext';

/** Show every item up to six; otherwise show five and an "All …" row. */
const ITEM_LIMIT = 6;

function useIsCurrent(): (href: string) => boolean {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  return (href) => pathname === href || pathname.startsWith(`${href}/`);
}

function MainNavItem({ entry }: { entry: NavEntry }) {
  const { href } = useWorkspace();
  const isCurrent = useIsCurrent();
  const to = href(entry.path);
  const item = (
    <NavItem
      href={to}
      icon={entry.icon}
      isCurrent={isCurrent(to)}
      className={s.navItemCompact}
      trailing={entry.id === 'tasks' ? <TasksBadge /> : undefined}
    >
      {entry.label}
    </NavItem>
  );
  if (!entry.tooltip) return item;
  return (
    <Tooltip content={<ShortcutTooltip description={entry.tooltip} shortcut={entry.shortcut} />} placement="right">
      {item}
    </Tooltip>
  );
}

function NavShortcuts() {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const go = (path: string) => () => void navigate({ href: href(path) });
  useAction('go-home', go('home'));
  useAction('go-tasks', go('tasks'));
  useAction('go-notes', go('notes'));
  useAction('go-emails', go('emails'));
  useAction('go-reports', go('reports'));
  useAction('go-people', go('people'));
  useAction('go-companies', go('companies'));
  return null;
}

function RecordsSection() {
  const { workspace, isAdmin, href } = useWorkspace();
  const sidebar = useSidebar();
  const isCurrent = useIsCurrent();
  const navigate = useNavigate();
  const objects = useObjects(workspace);
  const [sort, setSort] = usePersistentState<RecordsSort>('sidebar-records-sort', 'custom');
  const [showAll, setShowAll] = usePersistentState<boolean>('sidebar-records-show-all', false);
  const [menuOpen, setMenuOpen] = useState(false);
  const list = sortObjects(objects.data ?? [], sort);
  const overLimit = list.length > ITEM_LIMIT;
  const visible = overLimit && !showAll ? list.slice(0, ITEM_LIMIT - 1) : list;

  const actions: ReactNode = (
    <>
      <MenuTrigger
        onOpenChange={(open) => {
          setMenuOpen(open);
          sidebar.holdOpen(open);
        }}
      >
        <Tooltip content="Record options" placement="bottom">
          <Button className={s.sectionAction} aria-label="Record options">
            <Icon icon="settings" size={16} />
          </Button>
        </Tooltip>
        <Menu
          width={180}
          placement="bottom start"
          aria-label="Record options"
          selectionMode="single"
          selectedKeys={[sort]}
          onSelectionChange={(keys) => {
            const next = [...(keys as Set<string>)][0];
            if (next === 'recently-created' || next === 'alphabetical' || next === 'custom') setSort(next);
            if (next === 'show-all') setShowAll(!showAll);
          }}
        >
          <MenuSection title="Sort">
            <MenuItem id="recently-created">Recently created</MenuItem>
            <MenuItem id="alphabetical">Alphabetical</MenuItem>
            <MenuItem id="custom">Custom</MenuItem>
          </MenuSection>
          {overLimit && (
            <>
              <MenuSeparator />
              <MenuItem id="show-all">{showAll ? 'Show fewer objects' : 'Show all objects'}</MenuItem>
            </>
          )}
        </Menu>
      </MenuTrigger>
      {isAdmin && (
        <Tooltip content="Create new objects or enable standard objects" placement="bottom">
          <Button
            className={s.sectionAction}
            aria-label="Create new objects or enable standard objects"
            onPress={() => void navigate({ href: href('settings/data/objects') })}
          >
            <Icon icon="add" size={16} />
          </Button>
        </Tooltip>
      )}
    </>
  );

  return (
    <SidebarSection id="records" title="Records" actions={actions} actionsOpen={menuOpen}>
      {objects.isPending &&
        [96, 72, 120].map((w) => (
          <div key={w} className={s.rowSkeleton}>
            <Skeleton shape="circle" width={16} />
            <Skeleton width={w} height={10} />
          </div>
        ))}
      {visible.map((o) => {
        const look = objectAppearance(o);
        const to = href(objectPath(o));
        const shortcut = o.entityType === 'company-record' ? 'g c' : o.entityType === 'person-record' ? 'g p' : null;
        const item = (
          <NavItem
            key={o.id}
            href={to}
            isCurrent={isCurrent(to)}
            icon={<IconTile icon={look.icon} color={look.color} size={16} />}
            className={s.navItemCompact}
          >
            {o.pluralNoun}
          </NavItem>
        );
        return shortcut ? (
          <Tooltip
            key={o.id}
            content={
              <ShortcutTooltip description={`Go to all ${o.pluralNoun.toLowerCase()} page`} shortcut={shortcut} />
            }
            placement="right"
          >
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
      {overLimit && !showAll && (
        <NavItem href={href('settings/data/objects')} icon="more" className={s.ghostRow}>
          All objects
        </NavItem>
      )}
    </SidebarSection>
  );
}

export function MainSidebar() {
  const { isAdmin, href } = useWorkspace();
  return (
    <>
      <SidebarHeader />
      <div className={s.searchRow}>
        <Button className={s.searchButton} aria-label="Search" onPress={() => openQuickActions()}>
          <Icon icon="search" size={16} className={s.searchIcon} />
          <span className={s.searchLabel}>Search</span>
          <Kbd keys={['mod', 'k']} size={18} />
        </Button>
        <InboxButton />
      </div>
      <div className={s.scroll}>
        <nav className={s.navGroup} aria-label="Main">
          {mainNav.map((entry) => (
            <MainNavItem key={entry.id} entry={entry} />
          ))}
        </nav>
        <FavoritesSection />
        <RecordsSection />
        <SidebarLists />
        <ChatsSection />
      </div>
      {isAdmin && (
        <div className={s.footer}>
          <NavItem href={href('settings/members-and-teams')} icon="invite" className={s.navItemCompact}>
            Invite members
          </NavItem>
        </div>
      )}
      <NavShortcuts />
    </>
  );
}
