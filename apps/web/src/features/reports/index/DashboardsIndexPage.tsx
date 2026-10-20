// Dashboards index `/$ws/reports` (BACKLOG 9.01; H README §2.1, §3.1, §3.9, §3.10; evidence
// H/dashboards-index-favorites.png): page header (Reports crumb, Help, Ask AI), toolbar (Sorted by Creation date,
// expanding title search driving `?query=`, View settings, + New dashboard), the Favorites strip, then the table
// Dashboard | Reports | Created at grouped by creation date in the viewer's zone ("Created today 1"). Sort, grouping and
// "Show favorites" are per member. The list is fetched once and searched / grouped on the client; realtime keeps it live
// (`reporting-dashboard-list`, favourites).
import type { DashboardSummary } from '@agentic-crm/contracts';
import { Button, Icon, Skeleton, toast } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { errorEnvelopeOf } from '../../../data/trpc';
import { usePersistentState } from '../../../lib/storage';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { useFavorites } from '../../favorites';
import { SortMenu, ViewSettingsMenu } from '../../notes/indexParts';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import { useWorkspace } from '../../shell/workspaceContext';
import { useCalendar } from '../../tasks/calendar';
import { createDashboard, useDashboards, useWs } from '../data';
import * as s from './dashboardsIndex.css';
import {
  DEFAULT_VIEW_SETTINGS,
  favouritesOf,
  filterByTitle,
  type Group,
  groupDashboards,
  type IndexViewSettings,
  sortByCreation,
} from './model';
import { DashboardRow, FavoriteCard } from './parts';
import { SearchToggle } from './SearchToggle';

export interface DashboardsIndexPageProps {
  query: string;
  onQueryChange: (query: string) => void;
}

export function DashboardsIndexPage({ query, onQueryChange }: DashboardsIndexPageProps) {
  useDocumentTitle('Dashboards');
  const { me, href } = useWorkspace();
  const ws = useWs();
  const navigate = useNavigate();
  const calendar = useCalendar();
  const [stored, setView] = usePersistentState<Partial<IndexViewSettings>>(`reports-index-view:${me.user.id}`, {});
  const view: IndexViewSettings = useMemo(() => ({ ...DEFAULT_VIEW_SETTINGS, ...stored }), [stored]);
  const patchView = (patch: Partial<IndexViewSettings>) => setView((prev) => ({ ...prev, ...patch }));

  const dashboards = useDashboards();
  const favorites = useFavorites();
  const [creating, setCreating] = useState(false);

  const all = dashboards.data;
  const trimmed = query.trim();
  const visible = useMemo(
    () => (all ? sortByCreation(filterByTitle(all, trimmed), view.direction) : []),
    [all, trimmed, view.direction],
  );
  const groups = useMemo(
    () => groupDashboards(visible, view.groupBy, calendar, view.direction),
    [visible, view.groupBy, calendar, view.direction],
  );
  const ranks = useMemo(() => {
    if (!favorites.data) return undefined;
    return new Map(
      favorites.data.favorites
        .filter((f) => f.favoriteType === 'reporting-dashboard')
        .map((f) => [f.targetId, f.sortOrder] as const),
    );
  }, [favorites.data]);
  const starred = useMemo(() => (all ? favouritesOf(all, ranks) : []), [all, ranks]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await createDashboard(ws);
      await navigate({ href: href(`reports/dashboard/${id}`) });
    } catch (error) {
      toast.error({ title: 'Failed to create dashboard', description: errorEnvelopeOf(error).message });
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Reports', icon: 'reports' }]}
        actions={
          <>
            <HelpButton />
            <Button variant="secondary" size={28} icon="chat">
              Ask AI
            </Button>
          </>
        }
      />
      <div className={s.page} data-testid="dashboards-index">
        <div className={s.toolbar}>
          <SortMenu direction={view.direction} onChange={(direction) => patchView({ direction })} />
          <span className={s.toolbarSpacer} />
          <SearchToggle query={query} onQueryChange={onQueryChange} />
          <ViewSettingsMenu
            groupBy={view.groupBy}
            onGroupBy={(groupBy) => patchView({ groupBy })}
            showFavorites={view.showFavorites}
            onShowFavorites={(showFavorites) => patchView({ showFavorites })}
          />
          <Button
            variant="primary"
            size={28}
            icon="add"
            isPending={creating}
            onPress={() => void create()}
            data-testid="new-dashboard"
          >
            New dashboard
          </Button>
        </div>
        <div className={s.scroll}>
          {view.showFavorites && <FavoritesStrip dashboards={starred} />}
          <Body
            all={all}
            groups={groups}
            pending={dashboards.isPending}
            error={dashboards.isError}
            onRetry={() => void dashboards.refetch()}
            query={trimmed}
            onClearSearch={() => onQueryChange('')}
            onCreate={() => void create()}
            creating={creating}
          />
        </div>
      </div>
    </>
  );
}

function FavoritesStrip({ dashboards }: { dashboards: DashboardSummary[] }) {
  return (
    <section className={s.favorites} aria-label="Favorites" data-testid="favorites-strip">
      <p className={s.favoritesLabel}>Favorites</p>
      {dashboards.length > 0 ? (
        <div className={s.favoritesRow}>
          {dashboards.map((d) => (
            <FavoriteCard key={d.id} dashboard={d} />
          ))}
        </div>
      ) : (
        <div className={s.favoritesEmpty} data-testid="favorites-empty">
          <span className={s.favoritesEmptyTitle}>Favorites</span>
          <span className={s.favoritesEmptyText}>Dashboards that you favorite will appear here</span>
        </div>
      )}
    </section>
  );
}

interface BodyProps {
  all: DashboardSummary[] | undefined;
  groups: Group<DashboardSummary>[];
  pending: boolean;
  error: boolean;
  onRetry: () => void;
  query: string;
  onClearSearch: () => void;
  onCreate: () => void;
  creating: boolean;
}

function Body({ all, groups, pending, error, onRetry, query, onClearSearch, onCreate, creating }: BodyProps) {
  if (error && !all) {
    return (
      <div className={s.state} role="alert" data-testid="dashboards-error">
        <Icon icon="warning" size={24} color="negative" />
        <span className={s.stateTitle}>Error</span>
        <span className={s.stateText}>Something went wrong trying to load dashboards.</span>
        <div className={s.stateActions}>
          <Button variant="secondary" size={28} onPress={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }
  if (pending || !all) return <IndexSkeleton />;
  if (all.length === 0) {
    return (
      <div className={s.state} data-testid="dashboards-empty">
        <span className={s.stateText}>No dashboards yet! Create your first dashboard to get started.</span>
        <div className={s.stateActions}>
          <Button variant="primary" size={28} icon="add" isPending={creating} onPress={onCreate}>
            New dashboard
          </Button>
        </div>
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className={s.state} data-testid="dashboards-no-results">
        <span className={s.stateTitle}>No dashboards found</span>
        <span className={s.stateText}>We couldn't find any dashboards matching your search.</span>
        {query && (
          <div className={s.stateActions}>
            <Button variant="secondary" size={28} onPress={onClearSearch}>
              Clear search
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={s.table} role="table" aria-label="Dashboards" data-testid="dashboards-table">
      <div className={`${s.grid} ${s.head}`} role="row">
        <span className={`${s.headCell} ${s.headFirst}`} role="columnheader">
          Dashboard
        </span>
        <span className={s.headCell} role="columnheader">
          <Icon icon="reports" size={14} className={s.headIcon} />
          Reports
        </span>
        <span className={s.headCell} role="columnheader">
          <Icon icon="calendar" size={14} className={s.headIcon} />
          Created at
        </span>
      </div>
      {groups.map((g) => (
        <div key={g.key} role="rowgroup" aria-label={g.label}>
          <div className={s.groupRow} role="row" data-testid="dashboards-group" data-group={g.key}>
            {g.label}
            <span className={s.count}>{g.items.length}</span>
          </div>
          {g.items.map((d) => (
            <DashboardRow key={d.id} dashboard={d} />
          ))}
        </div>
      ))}
    </div>
  );
}

function IndexSkeleton() {
  return (
    <div role="status" aria-label="Loading dashboards" data-testid="dashboards-loading">
      <div className={`${s.grid} ${s.head}`}>
        <span className={`${s.headCell} ${s.headFirst}`}>Dashboard</span>
        <span className={s.headCell}>
          <Icon icon="reports" size={14} className={s.headIcon} />
          Reports
        </span>
        <span className={s.headCell}>
          <Icon icon="calendar" size={14} className={s.headIcon} />
          Created at
        </span>
      </div>
      <div className={s.groupRow}>
        <Skeleton shape="text" width={90} fontSize={12} />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${s.grid} ${s.row}`}>
          <span className={`${s.cell} ${s.cellFirst}`}>
            <Skeleton width={24} height={24} style={{ borderRadius: 8 }} />
            <Skeleton shape="text" width={140 + i * 20} />
          </span>
          <span className={s.cell}>
            <Skeleton shape="text" width={220} />
          </span>
          <span className={s.cell}>
            <Skeleton shape="text" width={60} />
          </span>
        </div>
      ))}
    </div>
  );
}
