// Settings → Dashboards → one dashboard `/$ws/settings/reports/dashboards/$id/<reports|permissions>` (BACKLOG 9.09; H
// README §3.11; evidence H/settings-dashboard-reports.png, settings-dashboard-permissions.png): crumb "Dashboards /
// <title>", "‹ Back", the title, "Manage reports, permissions and other relevant settings.", tabs Reports | Permissions.
// Reports lists the dashboard's reports with a delete; Permissions manages the grants (workspace, teams, members).
import { Button, EmptyState, ErrorState, Icon, Tab, TabList, TabPanel, Tabs } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Link } from 'react-aria-components';
import { httpStatusOf } from '../../../data/trpc';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import * as os from '../../settings/objects/objects.css';
import { ContentSpinner } from '../../shell/AppShell';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import * as shell from '../../shell/shell.css';
import { useWorkspace } from '../../shell/workspaceContext';
import { useDashboard } from '../data';
import { dashboardTitle } from '../index/model';
import { dashboardsCrumbIcon } from './crumbs';
import * as s from './dashboardSettings.css';
import { PermissionsTab } from './PermissionsTab';
import { ReportsTab } from './ReportsTab';

export type DashboardSettingsTabId = 'reports' | 'permissions';

export function DashboardSettingsPage({ dashboardId, tab }: { dashboardId: string; tab: DashboardSettingsTabId }) {
  const { href, isAdmin } = useWorkspace();
  const navigate = useNavigate();
  const listHref = href('settings/reports/dashboards');
  const detail = useDashboard(dashboardId, 'admin');
  const title = detail.data ? dashboardTitle(detail.data.dashboard.title) : null;
  useDocumentTitle(title ? `${title} · Dashboards` : 'Dashboards');

  const crumbs = [
    { label: 'Dashboards', icon: dashboardsCrumbIcon, href: listHref },
    ...(title ? [{ label: title }] : []),
  ];

  let body: ReactNode;
  if (!isAdmin) {
    body = (
      <EmptyState
        icon="lock"
        title="You don't have access"
        description="Only workspace admins can manage dashboards."
        style={{ padding: '72px 24px' }}
      />
    );
  } else if (detail.isError && !detail.data) {
    const missing = httpStatusOf(detail.error) === 404;
    body = missing ? (
      <EmptyState
        icon="dashboards"
        title="Dashboard not found"
        description="This dashboard either doesn't exist or has been deleted."
        style={{ padding: '72px 24px' }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void navigate({ href: listHref })}>
            Back to dashboards
          </Button>
        }
      />
    ) : (
      <ErrorState
        message="Failed to load the dashboard"
        style={{ padding: 48 }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void detail.refetch()}>
            Retry
          </Button>
        }
      />
    );
  } else if (!detail.data) {
    body = <ContentSpinner />;
  } else {
    const d = detail.data;
    body = (
      <div className={os.page} data-testid="settings-dashboard">
        <Link href={listHref} className={os.backLink}>
          <Icon icon="chevronLeft" size={14} />
          Back
        </Link>
        <div className={s.header}>
          <h1 className={s.title}>{dashboardTitle(d.dashboard.title)}</h1>
          <p className={os.pageDescription}>Manage reports, permissions and other relevant settings.</p>
        </div>
        <Tabs
          selectedKey={tab}
          onSelectionChange={(k) =>
            void navigate({ href: href(`settings/reports/dashboards/${dashboardId}/${String(k)}`) })
          }
          className={s.tabsBlock}
        >
          <div className={os.tabRow}>
            <TabList aria-label="Dashboard settings">
              <Tab id="reports" icon="reports">
                Reports
              </Tab>
              <Tab id="permissions" icon="lock">
                Permissions
              </Tab>
            </TabList>
          </div>
          <TabPanel id={tab} className={s.panel}>
            {tab === 'reports' ? <ReportsTab detail={d} /> : <PermissionsTab dashboardId={dashboardId} />}
          </TabPanel>
        </Tabs>
      </div>
    );
  }
  return (
    <>
      <PageHeader crumbs={crumbs} actions={<HelpButton />} />
      <div className={shell.content}>{body}</div>
    </>
  );
}
