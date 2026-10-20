// The Calls page `/$ws/calls` (BACKLOG 10.11; I calls): header tabs, toolbar (Sorted by Date · Filter chips ·
// search with `?query=` · View settings), the favourites strip, date groups and 52 px rows, with the empty states.
// Sort, filters, grouping and "Show favorites" are per browser (workspace-scoped where workspace-scoped).
import {
  Button,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  Submenu,
  Switch,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useShortcut } from '../../lib/shortcuts';
import { usePersistentState } from '../../lib/storage';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useFavorites } from '../favorites';
import { EmptyArt } from '../shell/EmptyArt';
import { useCalendar } from '../tasks/calendar';
import { CallCard } from './CallCard';
import { CallRow, CallsTableHead } from './CallRow';
import { CallsHeader } from './CallsHeader';
import { type CallsListParams, useCallsList, useWsRef } from './data';
import { FilterButton, FilterChips } from './FilterBar';
import { callKeys } from './keys';
import * as s from './list.css';
import { groupCalls, type StoredFilter, toListFilters } from './model';

type Direction = 'asc' | 'desc';
type GroupBy = 'meeting-date' | 'none';

/** The search box: collapsed behind the magnifier, `mod+f` expands it, the text mirrors `?query=` (replace, 200 ms). */
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(value !== '');
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (text.trim() !== value.trim()) onChange(text.trim());
    }, 200);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useShortcut('mod+f', () => setOpen(true), { description: 'Search calls' });
  if (!open)
    return (
      <IconButton
        icon="search"
        size={28}
        aria-label="Search calls"
        tooltip="Search calls"
        onPress={() => setOpen(true)}
        data-testid="calls-search-open"
      />
    );
  return (
    <span className={s.searchBox} data-testid="calls-search">
      <Icon icon="search" size={16} className={s.muted} />
      <input
        ref={input}
        className={s.searchInput}
        placeholder="Search calls"
        aria-label="Search calls"
        value={text}
        data-testid="calls-search-input"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            document.querySelector<HTMLElement>('[data-call-link]')?.focus();
          } else if (e.key === 'Escape') {
            setText('');
            onChange('');
            setOpen(false);
          } else if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
            e.preventDefault();
            if (!text) setOpen(false);
          }
        }}
      />
      <IconButton
        icon="close"
        size={20}
        aria-label="Clear search"
        onPress={() => {
          setText('');
          onChange('');
          setOpen(false);
        }}
      />
    </span>
  );
}

function SortMenu({ direction, onChange }: { direction: Direction; onChange: (d: Direction) => void }) {
  return (
    <MenuTrigger>
      <AriaButton className={s.toolbarButton} data-testid="calls-sort">
        <Icon icon="sort" size={16} className={s.muted} />
        <span className={s.muted}>Sorted by</span>
        Date
      </AriaButton>
      <Menu
        aria-label="Sort"
        placement="bottom start"
        width={220}
        selectionMode="multiple"
        selectedKeys={['field', direction]}
        onSelectionChange={(keys) => {
          for (const key of keys as Set<string>)
            if ((key === 'asc' || key === 'desc') && key !== direction) onChange(key);
        }}
      >
        <MenuSection>
          <MenuItem id="field" icon="calendarDays">
            Date
          </MenuItem>
        </MenuSection>
        <MenuSeparator />
        <MenuSection>
          <MenuItem id="asc" icon="arrowUp">
            Ascending
          </MenuItem>
          <MenuItem id="desc" icon="arrowDown">
            Descending
          </MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}

function ViewSettings({
  groupBy,
  onGroupBy,
  showFavorites,
  onShowFavorites,
}: {
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
  showFavorites: boolean;
  onShowFavorites: (v: boolean) => void;
}) {
  return (
    <MenuTrigger>
      <Button variant="secondary" size={28} icon="viewSettings" data-testid="calls-view-settings">
        View settings
      </Button>
      <Menu aria-label="View settings" placement="bottom end" width={240}>
        <Submenu
          label="Group by"
          icon="rows"
          trailing={<span className={s.muted}>{groupBy === 'meeting-date' ? 'Date' : 'None'}</span>}
        >
          <MenuItem id="group-date" icon="calendarDays" onAction={() => onGroupBy('meeting-date')}>
            Date
          </MenuItem>
          <MenuItem id="group-none" icon="remove" onAction={() => onGroupBy('none')}>
            None
          </MenuItem>
        </Submenu>
        <MenuSeparator />
        <MenuItem
          id="favorites"
          icon="favorite"
          onAction={() => onShowFavorites(!showFavorites)}
          trailing={<Switch isSelected={showFavorites} aria-label="Show favorites" onChange={onShowFavorites} />}
        >
          Show favorites
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

function FavoritesStrip({ children }: { children?: React.ReactNode }) {
  return (
    <section className={s.favorites} aria-label="Favorites" data-testid="favorites-strip">
      <p className={s.favoritesLabel}>Favorites</p>
      {children ? (
        <div className={s.favoritesRow}>{children}</div>
      ) : (
        <div className={s.favoritesEmpty}>
          <span className={s.favoritesEmptyTitle}>Favorites</span>
          <span className={s.favoritesEmptyText}>Calls that you favorite will appear here</span>
        </div>
      )}
    </section>
  );
}

function ListSkeleton() {
  return (
    <div data-testid="calls-loading" aria-label="Loading calls...">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${s.tableRow} ${s.dataRow}`} style={{ cursor: 'default' }}>
          <div className={`${s.cell} ${s.callCell}`}>
            <Skeleton width={24} height={24} />
            <Skeleton width={160} height={12} />
          </div>
          <div className={s.cell}>
            <Skeleton width={100} height={12} />
          </div>
          <div className={s.cell}>
            <Skeleton width={60} height={20} />
          </div>
          <div className={s.cell}>
            <Skeleton width={70} height={12} />
          </div>
          <div className={s.cell} />
        </div>
      ))}
    </div>
  );
}

export function CallsPage() {
  useDocumentTitle('Calls');
  const ws = useWsRef();
  const client = useQueryClient();
  const navigate = useNavigate();
  const calendar = useCalendar();
  const search = useSearch({ strict: false }) as { query?: string };
  const urlQuery = typeof search.query === 'string' ? search.query : '';

  const [direction, setDirection] = usePersistentState<Direction>('call-recordings-list-view-sort-cache', 'desc');
  const [filters, setFilters] = usePersistentState<StoredFilter[]>(
    `${ws.id}:call-recordings-list-view-filters-cache`,
    [],
  );
  const [groupBy, setGroupBy] = usePersistentState<GroupBy>(
    `${ws.id}:call-recordings-list-view-grouping-cache`,
    'meeting-date',
  );
  const [showFavorites, setShowFavorites] = usePersistentState<boolean>(
    `${ws.id}:call-recordings-list-view-show-favorites`,
    true,
  );

  const query = urlQuery.trim();
  const filtered = filters.length > 0 || query !== '';
  const params: CallsListParams = {
    filters: toListFilters(filters),
    ...(query ? { query } : {}),
    sort: { field: 'meeting-start-at', direction },
    groupBy,
    timeZone: calendar.timeZone,
    includeFavorites: showFavorites && !filtered,
  };
  const list = useCallsList(params);

  // Favourites change from the star, the sidebar or another tab: the strip follows.
  const favorites = useFavorites();
  const favoriteIds = new Set(
    (favorites.data?.favorites ?? []).filter((f) => f.favoriteType === 'call-recording').map((f) => f.targetId),
  );
  const favoritesStamp = useRef<number | null>(null);
  useEffect(() => {
    const stamp = favorites.dataUpdatedAt;
    if (favoritesStamp.current !== null && favoritesStamp.current !== stamp)
      void client.invalidateQueries({ queryKey: callKeys.lists(ws.id) });
    favoritesStamp.current = stamp;
  }, [favorites.dataUpdatedAt]);

  const setQuery = (value: string) =>
    void navigate({
      to: '.',
      search: ((prev: Record<string, unknown>) => ({ ...prev, query: value || undefined })) as never,
      replace: true,
    });

  // More rows as the end of the list scrolls into view.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = end.current;
    if (!node || !list.hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !list.isFetchingNextPage) void list.fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [list.hasNextPage, list.isFetchingNextPage, list.data?.items.length]);

  const data = list.data;
  const groups = data ? groupCalls(data.items, data.groups, groupBy) : [];
  const unfilteredEmpty = data !== undefined && data.total === 0 && !filtered;

  const moveFocus = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const target = e.target as HTMLElement;
    if (!target.matches('[data-call-link]')) return;
    const links = [...document.querySelectorAll<HTMLElement>('[data-call-link]')];
    const next = links[links.indexOf(target) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <>
      <CallsHeader active="calls" />
      <div className={s.page} data-testid="calls-page">
        <div className={s.toolbar}>
          <SortMenu direction={direction} onChange={setDirection} />
          <span className={s.toolbarSeparator} />
          <FilterChips filters={filters} onChange={setFilters} />
          <FilterButton filters={filters} onChange={setFilters} />
          <span className={s.toolbarSpacer} />
          <SearchBox value={urlQuery} onChange={setQuery} />
          <ViewSettings
            groupBy={groupBy}
            onGroupBy={setGroupBy}
            showFavorites={showFavorites}
            onShowFavorites={setShowFavorites}
          />
        </div>
        <div className={s.scroll} onKeyDown={moveFocus}>
          {showFavorites && !filtered && !unfilteredEmpty && (
            <FavoritesStrip>
              {data?.favorites?.length
                ? data.favorites.map((c) => <CallCard key={c.id} call={c} variant="favorite" />)
                : undefined}
            </FavoritesStrip>
          )}
          {list.isError ? (
            <div className={s.state} data-testid="calls-error">
              <span className={s.stateError}>
                Something went wrong trying to load calls. Refresh the page to try again.
              </span>
            </div>
          ) : list.isPending ? (
            <ListSkeleton />
          ) : unfilteredEmpty ? (
            <div className={s.state} data-testid="calls-empty">
              <EmptyArt icon="meeting" />
              <span className={s.stateTitle}>Call recordings</span>
              <span className={s.stateText}>No call recordings yet! Record your first call to get started.</span>
            </div>
          ) : groups.length === 0 ? (
            <div className={s.state} data-testid="calls-no-match">
              <span className={s.stateTitle}>No calls found</span>
              <span className={s.stateText}>
                {query && filters.length === 0
                  ? 'No calls found matching your query.'
                  : query
                    ? 'No calls found matching your query and filters.'
                    : filters.length === 1
                      ? 'No calls found matching your filter.'
                      : 'No calls found matching your filters.'}
              </span>
              <span className={s.stateAction}>
                <Button
                  variant="secondary"
                  size={28}
                  icon="filter"
                  onPress={() => {
                    setFilters([]);
                    setQuery('');
                  }}
                  data-testid="calls-clear-filters"
                >
                  {query && filters.length === 0
                    ? 'Clear query'
                    : filters.length === 1 && !query
                      ? 'Clear filter'
                      : 'Clear filters'}
                </Button>
              </span>
            </div>
          ) : (
            <div className={s.table} role="table" aria-label="Calls">
              <CallsTableHead />
              {groups.map((g) => (
                <div key={g.key} role="rowgroup" aria-label={g.label}>
                  {groupBy === 'meeting-date' && (
                    <div className={s.tableGroup} data-testid="calls-group">
                      {g.label}
                      <span className={s.count}>{g.count}</span>
                    </div>
                  )}
                  {g.items.map((c) => (
                    <CallRow key={c.id} call={c} isFavorite={favoriteIds.has(c.id)} />
                  ))}
                </div>
              ))}
              <div ref={end} className={s.loadMore} aria-hidden={!list.hasNextPage}>
                {list.isFetchingNextPage && <Skeleton width={120} height={12} />}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
