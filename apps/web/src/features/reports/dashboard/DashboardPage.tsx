// Dashboard page:
// page header (breadcrumb, favourite, presence, Share, help, ⋮ menu), the title row (inline-editable title and
// description, + New report), the grid of report cells (or the empty state) and an <Outlet/> for the editor and viewer
// overlays, which keep the grid mounted behind them.
import {
  AlertDialog,
  AvatarGroup,
  Breadcrumbs,
  Button,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  Tooltip,
} from '@agentic-crm/ui';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { Suspense, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { FavoriteStar, useFavoriteToggle } from '../../favorites';
import { PageHeader } from '../../shell/PageHeader';
import { useWorkspace } from '../../shell/workspaceContext';
import { formatCreated, useActorName } from '../CellMenu';
import { ChartMessage } from '../charts';
import { deleteDashboard, updateDashboardHeader, useDashboard, useWs } from '../data';
import { InlineEdit } from '../InlineEdit';
import { DashboardPresenceContext, useDashboardPresence } from '../presence';
import { SharePopover } from '../share/SharePopover';
import { DashboardGrid } from './DashboardGrid';
import * as d from './dashboard.css';

export function DashboardPage({ dashboardId }: { dashboardId: string }) {
  const { href, me, workspace, isAdmin } = useWorkspace();
  const ws = useWs();
  const navigate = useNavigate();
  const query = useDashboard(dashboardId);
  const detail = query.data;
  const self = { userId: me.user.id, name: me.user.name };
  const presence = useDashboardPresence(workspace.id, dashboardId, self);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const favorite = useFavoriteToggle({ favoriteType: 'reporting-dashboard', targetId: dashboardId });
  const author = useActorName(detail?.dashboard.createdBy);
  useDocumentTitle(detail?.dashboard.title || 'Untitled Dashboard');

  const newReport = () => void navigate({ href: href(`reports/dashboard/${dashboardId}/cell/new`) });
  const reportsCrumb = { id: 'reports', label: 'Reports', icon: 'reports' as const, href: href('reports') };

  if (query.isPending) {
    return (
      <>
        <PageHeader crumbs={[{ label: 'Reports', icon: 'reports', href: href('reports') }]} />
        <div className={d.page}>
          <div className={d.titleRow}>
            <Skeleton width={180} height={20} />
          </div>
        </div>
      </>
    );
  }
  if (!detail) {
    return (
      <>
        <PageHeader crumbs={[{ label: 'Reports', icon: 'reports', href: href('reports') }]} />
        <div className={d.notFound} data-testid="dashboard-not-found">
          This dashboard either doesn't exist or you don't have permission to access it.
        </div>
      </>
    );
  }

  const { dashboard, cells, access } = detail;
  const canEdit = access.flags.update_reporting_dashboard;
  const title = dashboard.title || 'Untitled Dashboard';

  return (
    <>
      <PageHeader
        start={
          <div className={d.headerStart}>
            <Breadcrumbs items={[reportsCrumb, { id: 'dashboard', label: title }]} />
            <FavoriteStar favoriteType="reporting-dashboard" targetId={dashboardId} />
          </div>
        }
        actions={
          <div className={d.headerActions}>
            {presence.length > 0 && (
              <span data-testid="dashboard-presence">
                <AvatarGroup
                  size={20}
                  max={4}
                  items={presence.map((u) => ({ id: u.userId, name: u.name, seed: u.userId, kind: 'member' as const }))}
                />
              </span>
            )}
            <SharePopover dashboardId={dashboardId} canManage={access.canManagePermissions} />
            <span className={d.headerDivider} />
            <span className={d.headerGroup}>
              <IconButton icon="help" aria-label="Help" tooltip="Open help drawer" />
              <MenuTrigger>
                <IconButton icon="moreVertical" aria-label="Dashboard menu" data-testid="dashboard-menu-button" />
                <Menu
                  aria-label="Dashboard menu"
                  placement="bottom end"
                  width={240}
                  onAction={(key) => {
                    if (key === 'settings')
                      void navigate({ href: href(`settings/reports/dashboards/${dashboardId}/reports`) });
                    else if (key === 'favorite') favorite.toggle();
                    else if (key === 'delete') setConfirmDelete(true);
                  }}
                >
                  {isAdmin && (
                    <MenuItem id="settings" icon="settings">
                      Dashboard settings
                    </MenuItem>
                  )}
                  <MenuItem id="favorite" icon={favorite.isFavorite ? 'favoriteRemove' : 'favorite'}>
                    {favorite.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  </MenuItem>
                  {access.flags.delete_reporting_dashboard && (
                    <MenuItem id="delete" icon="delete" variant="danger">
                      Delete dashboard
                    </MenuItem>
                  )}
                  <MenuSeparator />
                  <MenuItem id="created" isDisabled className={d.menuFooterItem}>
                    <span className={d.menuFooter}>
                      <span>Created by {author}</span>
                      <span>{formatCreated(dashboard.createdAt)}</span>
                    </span>
                  </MenuItem>
                </Menu>
              </MenuTrigger>
            </span>
            <Tooltip content="Ask AI">
              <Button variant="secondary" size={28} icon="chat">
                Ask AI
              </Button>
            </Tooltip>
          </div>
        }
      />
      <div className={d.page} data-testid="dashboard-page">
        <div className={d.titleRow}>
          <div className={d.titleGroup}>
            <InlineEdit
              variant="title"
              value={dashboard.title}
              placeholder="Enter dashboard title..."
              emptyLabel="Untitled Dashboard"
              readOnly={!canEdit}
              maxLength={256}
              data-testid="dashboard-title"
              onCommit={(value) => void updateDashboardHeader(ws, dashboardId, { title: value })}
            />
            <InlineEdit
              variant="description"
              value={dashboard.description ?? ''}
              placeholder="Describe dashboard..."
              readOnly={!canEdit}
              maxLength={4000}
              data-testid="dashboard-description"
              onCommit={(value) => void updateDashboardHeader(ws, dashboardId, { description: value })}
            />
          </div>
          {canEdit && (
            <Button variant="primary" size={28} icon="add" onPress={newReport} data-testid="new-report-button">
              New report
            </Button>
          )}
        </div>
        {detail.hiddenReportCount > 0 && (
          <div className={d.notice} data-testid="hidden-reports-notice">
            Some reports are not visible as they use a data source that has been deleted or that you do not have access
            to.
          </div>
        )}
        <div className={d.scroll}>
          {cells.length === 0 ? (
            <div className={d.emptyWrap} style={{ minHeight: 'calc(100% - 1px)', height: '100%' }}>
              <ChartMessage
                title="Empty dashboard"
                subtitle="No reports in this dashboard yet"
                action={
                  canEdit ? (
                    <Button variant="primary" size={32} icon="add" onPress={newReport} data-testid="empty-new-report">
                      New report
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <DashboardGrid dashboardId={dashboardId} cells={cells} canEdit={canEdit} />
              {canEdit && (
                <div style={{ padding: '0 14px 14px' }}>
                  <AriaButton
                    className={d.addTile}
                    aria-label="Add report"
                    onPress={newReport}
                    data-testid="add-report-tile"
                  >
                    <Icon icon="add" size={16} />
                  </AriaButton>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Are you sure?"
        description="Are you sure you want to delete this dashboard?"
        onConfirm={() =>
          void deleteDashboard(ws, dashboardId).then(
            (ok) => ok && void navigate({ href: href('reports'), replace: true }),
          )
        }
      />
      <DashboardPresenceContext.Provider value={presence}>
        <Suspense fallback={null}>
          <Outlet />
        </Suspense>
      </DashboardPresenceContext.Provider>
    </>
  );
}
