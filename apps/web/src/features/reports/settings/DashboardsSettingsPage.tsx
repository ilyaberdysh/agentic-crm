// Settings → Dashboards `/$ws/settings/reports/dashboards` (BACKLOG 9.09; H README §3.11): "Dashboards — Manage
// reporting dashboards in your workspace. Learn more", a "Search dashboards" box and the admin list of every
// dashboard of the workspace (also the ones without a grant for the admin): Dashboard | Reports (chips, "+N") |
// Created at ("Oct 9th 2026") and a ⋮ "Options" menu with "Delete dashboard". Rows open the dashboard's Reports tab.
import type { DashboardSummary } from '@agentic-crm/contracts';
import { Button, EmptyState, Icon, SearchField, Skeleton, toast } from '@agentic-crm/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { errorEnvelopeOf } from '../../../data/trpc';
import { brand } from '../../../lib/brand';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import * as os from '../../settings/objects/objects.css';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import * as shell from '../../shell/shell.css';
import { useWorkspace } from '../../shell/workspaceContext';
import { useCalendar } from '../../tasks/calendar';
import { createDashboard, useDashboards, useWs } from '../data';
import { formatAbsoluteDate } from '../index/format';
import { dashboardTitle, filterByTitle, sortByCreation } from '../index/model';
import { DashboardMenu, DashboardTile, ReportChips } from '../index/parts';
import { dashboardsCrumbIcon } from './crumbs';
import * as s from './dashboardSettings.css';

const SETTINGS_CHIPS = 2;

export function DashboardsSettingsPage() {
  useDocumentTitle('Dashboards');
  const { isAdmin } = useWorkspace();
  const dashboards = useDashboards({ scope: 'admin' });
  const [query, setQuery] = useState('');
  const visible = useMemo(
    () => (dashboards.data ? filterByTitle(sortByCreation(dashboards.data, 'desc'), query) : []),
    [dashboards.data, query],
  );
  return (
    <>
      <PageHeader crumbs={[{ label: 'Dashboards', icon: dashboardsCrumbIcon }]} actions={<HelpButton />} />
      <div className={shell.content}>
        <div className={os.page} data-testid="settings-dashboards">
          <div className={os.headerRow}>
            <div>
              <h1 className={os.pageTitle}>Dashboards</h1>
              <p className={os.pageDescription}>
                Manage reporting dashboards in your workspace.{' '}
                <a className={s.learn} href={brand.supportUrl} target="_blank" rel="noreferrer">
                  Learn more
                </a>{' '}
                <Icon icon="arrowUpRight" size={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
              </p>
            </div>
          </div>
          <div className={os.pageRule} />
          {!isAdmin ? (
            <EmptyState
              icon="lock"
              title="You don't have access"
              description="Only workspace admins can manage dashboards."
              style={{ padding: '40px 24px' }}
            />
          ) : (
            <>
              <div className={os.toolbar}>
                <SearchField
                  aria-label="Search dashboards"
                  placeholder="Search dashboards"
                  size={32}
                  value={query}
                  onChange={setQuery}
                  className={os.toolbarSearch}
                />
              </div>
              <div className={os.table} role="table" aria-label="Dashboards">
                <div className={`${os.tableHeader} ${s.listGrid} ${s.headRow}`} role="row">
                  <div className={os.headerCell} role="columnheader">
                    <Icon icon="dashboards" size={14} className={os.headerIcon} />
                    Dashboard
                  </div>
                  <div className={os.headerCell} role="columnheader">
                    <Icon icon="reports" size={14} className={os.headerIcon} />
                    Reports
                  </div>
                  <div className={os.headerCell} role="columnheader">
                    <Icon icon="calendar" size={14} className={os.headerIcon} />
                    Created at
                  </div>
                  <div role="columnheader" aria-label="Actions" />
                </div>
                <Rows
                  pending={dashboards.isPending}
                  error={dashboards.isError}
                  onRetry={() => void dashboards.refetch()}
                  all={dashboards.data}
                  visible={visible}
                  query={query}
                  onClear={() => setQuery('')}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Rows({
  pending,
  error,
  onRetry,
  all,
  visible,
  query,
  onClear,
}: {
  pending: boolean;
  error: boolean;
  onRetry: () => void;
  all: DashboardSummary[] | undefined;
  visible: DashboardSummary[];
  query: string;
  onClear: () => void;
}) {
  const ws = useWs();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  if (error && !all) {
    return (
      <EmptyState
        icon="warning"
        title="Something went wrong"
        description="We couldn't load the dashboards of this workspace."
        style={{ padding: '40px 24px' }}
        actions={
          <Button variant="secondary" size={28} onPress={onRetry}>
            Retry
          </Button>
        }
      />
    );
  }
  if (pending || !all) {
    return (
      <>
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${os.row} ${s.listGrid} ${s.dataRow}`} data-static role="row">
            <Skeleton shape="text" width={150} />
            <Skeleton shape="text" width={180} />
            <Skeleton shape="text" width={80} />
          </div>
        ))}
      </>
    );
  }
  if (all.length === 0) {
    return (
      <EmptyState
        icon="dashboards"
        title="No dashboards yet"
        description="There are currently no dashboards created"
        style={{ padding: '40px 24px' }}
        actions={
          <Button
            variant="secondary"
            size={28}
            isPending={creating}
            onPress={() => {
              setCreating(true);
              createDashboard(ws)
                .then((id) => navigate({ href: href(`reports/dashboard/${id}`) }))
                .catch((e: unknown) =>
                  toast.error({ title: 'Failed to create dashboard', description: errorEnvelopeOf(e).message }),
                )
                .finally(() => setCreating(false));
            }}
          >
            Create first dashboard
          </Button>
        }
      />
    );
  }
  if (visible.length === 0) {
    return (
      <div data-testid="settings-no-results">
        <EmptyState
          icon="search"
          title="No dashboards found"
          description="We couldn't find any dashboards matching your search."
          style={{ padding: '40px 24px' }}
          actions={
            query ? (
              <Button variant="secondary" size={28} onPress={onClear}>
                Clear search
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }
  return (
    <>
      {visible.map((d) => (
        <ListRow key={d.id} dashboard={d} />
      ))}
    </>
  );
}

function ListRow({ dashboard: d }: { dashboard: DashboardSummary }) {
  const { href } = useWorkspace();
  const calendar = useCalendar();
  return (
    <div
      className={`${os.row} ${s.listGrid} ${s.dataRow}`}
      role="row"
      data-testid="settings-dashboard-row"
      data-dashboard-id={d.id}
    >
      <div className={os.cell} role="cell">
        <DashboardTile id={d.id} size={20} />
        <Link to={href(`settings/reports/dashboards/${d.id}/reports`)} className={`${s.rowLink} ${s.linkPrimary}`}>
          {dashboardTitle(d.title)}
        </Link>
      </div>
      <div className={`${os.cell} ${s.chipsCell}`} role="cell">
        <ReportChips reports={d.reports} max={SETTINGS_CHIPS} />
      </div>
      <div className={os.cell} role="cell">
        <span className={s.small}>{formatAbsoluteDate(d.createdAt, calendar.timeZone)}</span>
      </div>
      <div className={s.actions} role="cell">
        <DashboardMenu dashboard={d} label="Options" showMeta={false} />
      </div>
    </div>
  );
}
