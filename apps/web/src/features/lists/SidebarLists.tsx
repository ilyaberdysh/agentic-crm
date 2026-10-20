// Sidebar Lists section (B sidebar.md §5, §5.1, §8): rows = list emoji + name → `/collection/<id>` (a visit is
// recorded for "Most relevant"); hover actions (with ≥ 1 list) Cog "List options" (Sort: Most relevant · Recently
// added · Alphabetical · Custom; "Show all lists" when over the limit) and "+" ("Create a list"). No lists → "+ New
// list". More than 6 lists → 5 + "All lists" opening the 300 px flyout (title "Lists" + "+", "Search lists...",
// "No lists found"). Custom order: drag a row → "Change list order" confirmation → the moved list's new rank.
import { rankBetween } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  NavItem,
  Skeleton,
  Tooltip,
} from '@agentic-crm/ui';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from 'react-aria-components';
import { usePersistentState } from '../../lib/storage';
import { SidebarSection } from '../shell/SidebarSection';
import * as shell from '../shell/shell.css';
import { useSidebar } from '../shell/sidebarState';
import { useWorkspace } from '../shell/workspaceContext';
import { useVerticalReorder } from '../views/useVerticalReorder';
import { type List, type ListsSort, sortLists, updateList, useLists } from './data';
import { listPath, openListsDialog } from './flows';
import { ListIcon } from './icon';
import * as s from './sidebar.css';
import { readVisits, recordListVisit, relevanceOf, subscribeVisits } from './visits';

/** sidebar.md §5: ≤ 6 → all, else 5 + "All lists". */
export const ITEM_LIMIT = 6;

export function visibleLists<T>(lists: readonly T[], showAll: boolean): { rows: T[]; overLimit: boolean } {
  const overLimit = lists.length > ITEM_LIMIT;
  return { rows: overLimit && !showAll ? lists.slice(0, ITEM_LIMIT - 1) : [...lists], overLimit };
}

let visitsVersion = 0;
subscribeVisits(() => {
  visitsVersion++;
});

export function SidebarLists() {
  const { workspace, href } = useWorkspace();
  const sidebar = useSidebar();
  const lists = useLists(workspace);
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const [sort, setSort] = usePersistentState<ListsSort>('sidebar-lists-sort', 'custom');
  const [showAll, setShowAll] = usePersistentState<boolean>('sidebar-lists-show-all', false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [flyout, setFlyout] = useState(false);
  const [reorder, setReorder] = useState<{ list: List; rank: string } | null>(null);
  const version = useSyncExternalStore(
    subscribeVisits,
    () => visitsVersion,
    () => 0,
  );
  const sorted = useMemo(
    () => sortLists(lists.data ?? [], sort, sort === 'most-relevant' ? relevanceOf(readVisits()) : undefined),
    [lists.data, sort, version],
  );
  const { rows, overLimit } = visibleLists(sorted, showAll);
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useVerticalReorder(containerRef, (from, to) => {
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    // Ranks are compared within the full custom order: neighbours of the drop position.
    const before = next[to - 1]?.sortOrder ?? null;
    const after = next[to + 1]?.sortOrder ?? null;
    try {
      setReorder({ list: moved, rank: rankBetween(before, after && before && after <= before ? null : after) });
    } catch {
      // Malformed ranks (imported decimals): leave the order alone.
    }
  });
  const canReorder = sort === 'custom';
  const isCurrent = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
  const hasLists = (lists.data?.length ?? 0) > 0;

  const actions: ReactNode = hasLists ? (
    <>
      <MenuTrigger
        onOpenChange={(open) => {
          setMenuOpen(open);
          sidebar.holdOpen(open);
        }}
      >
        <Tooltip content="List options" placement="bottom">
          <Button className={shell.sectionAction} aria-label="List options">
            <Icon icon="settings" size={16} />
          </Button>
        </Tooltip>
        <Menu
          width={180}
          placement="bottom start"
          aria-label="List options"
          selectionMode="single"
          selectedKeys={[sort]}
          onSelectionChange={(keys) => {
            const next = [...(keys as Set<string>)][0];
            if (next === 'most-relevant' || next === 'recently-added' || next === 'alphabetical' || next === 'custom')
              setSort(next);
            if (next === 'show-all') setShowAll(!showAll);
          }}
        >
          <MenuSection title="Sort">
            <MenuItem id="most-relevant">Most relevant</MenuItem>
            <MenuItem id="recently-added">Recently added</MenuItem>
            <MenuItem id="alphabetical">Alphabetical</MenuItem>
            <MenuItem id="custom">Custom</MenuItem>
          </MenuSection>
          {overLimit && (
            <>
              <MenuSeparator />
              <MenuItem id="show-all">{showAll ? 'Show fewer lists' : 'Show all lists'}</MenuItem>
            </>
          )}
        </Menu>
      </MenuTrigger>
      <Tooltip content="Create a list" placement="bottom">
        <Button
          className={shell.sectionAction}
          aria-label="Add list"
          onPress={() => openListsDialog({ kind: 'create-list', then: 'open-list' })}
        >
          <Icon icon="add" size={16} />
        </Button>
      </Tooltip>
    </>
  ) : undefined;

  const dropTop = drag.dropLineTop();
  return (
    <SidebarSection id="lists" title="Lists" actions={actions} actionsOpen={menuOpen}>
      {lists.isPending &&
        [88, 120].map((w) => (
          <div key={w} className={shell.rowSkeleton}>
            <Skeleton width={16} height={16} />
            <Skeleton width={w} height={10} />
          </div>
        ))}
      {lists.data && !hasLists && (
        <NavItem
          icon="add"
          className={shell.ghostRow}
          onPress={() => openListsDialog({ kind: 'create-list', then: 'open-list' })}
          aria-label="New list"
        >
          New list
        </NavItem>
      )}
      <div ref={containerRef} className={s.rows} data-testid="sidebar-lists">
        {rows.map((l, i) => {
          const to = href(listPath(l));
          return (
            <div
              key={l.id}
              data-reorder-index={i}
              className={s.row}
              data-dragging={drag.dragging === i || undefined}
              onPointerDown={canReorder ? (e) => drag.onPointerDown(i, e) : undefined}
              onClickCapture={(e) => {
                if (drag.didDragRecently()) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
            >
              <NavItem
                href={to}
                isCurrent={isCurrent(to)}
                icon={<ListIcon icon={l.icon} size={16} />}
                className={shell.navItemCompact}
                onPress={() => recordListVisit(l.id)}
              >
                {l.name}
              </NavItem>
            </div>
          );
        })}
        {dropTop !== null && <div className={s.dropLine} style={{ top: dropTop }} />}
      </div>
      {overLimit && !showAll && (
        <NavItem icon="more" className={shell.ghostRow} onPress={() => setFlyout((o) => !o)} aria-expanded={flyout}>
          All lists
        </NavItem>
      )}
      {flyout && <AllListsPanel lists={sorted} onClose={() => setFlyout(false)} />}
      <AlertDialog
        isOpen={reorder !== null}
        onOpenChange={(open) => !open && setReorder(null)}
        title="Change list order"
        description="The new list ordering will be visible for all workspace members."
        confirmLabel="Update for everyone"
        variant="primary"
        onCancel={() => setReorder(null)}
        onConfirm={() => {
          const r = reorder;
          setReorder(null);
          if (r) void updateList(workspace, r.list, { sortOrder: r.rank }).catch(() => undefined);
        }}
      />
    </SidebarSection>
  );
}

/** "All lists" flyout (sidebar.md §5.1): docked at the sidebar's right edge, search + keyboard highlight. */
function AllListsPanel({ lists, onClose }: { lists: List[]; onClose: () => void }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const sidebar = useSidebar();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const shown = q ? lists.filter((l) => l.name.toLowerCase().includes(q)) : lists;
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);
  const openList = (l: List | undefined) => {
    if (!l) return;
    recordListVisit(l.id);
    void navigate({ href: href(listPath(l)) });
    onClose();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openList(shown[active]);
    }
  };
  return (
    <div
      ref={panelRef}
      className={s.flyout}
      style={{ left: sidebar.width - 1 }}
      role="dialog"
      aria-label="All lists"
      data-testid="all-lists-panel"
      onKeyDown={onKeyDown}
    >
      <div className={s.flyoutHeader}>
        <span className={s.flyoutTitle}>Lists</span>
        <IconButton
          icon="add"
          aria-label="Create Lists"
          size={20}
          variant="ghost"
          onPress={() => {
            onClose();
            openListsDialog({ kind: 'create-list', then: 'open-list' });
          }}
        />
      </div>
      <div className={s.flyoutSearch}>
        <input
          className={s.flyoutInput}
          placeholder="Search lists..."
          aria-label="Search lists"
          value={query}
          ref={(el) => el?.focus()}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className={s.flyoutList}>
        {shown.length === 0 && <div className={s.flyoutEmpty}>No lists found</div>}
        {shown.map((l, i) => (
          <button
            key={l.id}
            type="button"
            className={s.flyoutRow}
            data-active={i === active || undefined}
            onMouseMove={() => setActive(i)}
            onClick={() => openList(l)}
          >
            <ListIcon icon={l.icon} size={16} />
            <span className={s.flyoutRowLabel}>{l.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
