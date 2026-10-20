// Reports tab of a dashboard's settings (H README §3.11): table Report | Created at ("about 15 hours ago"), rows link to
// the report's full-screen view, ⋮ "Options" → "Delete report" (confirm "Report deletion" / "Deleting a report deletes
// its data permanently and cannot be undone."). Empty: "There are no reports in this dashboard".
import type { DashboardDetail } from '@agentic-crm/contracts';
import { AlertDialog, EmptyState, Icon, IconButton, Menu, MenuItem, MenuTrigger } from '@agentic-crm/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import * as os from '../../settings/objects/objects.css';
import { useWorkspace } from '../../shell/workspaceContext';
import { useWs } from '../data';
import { formatDistanceAgo } from '../index/format';
import { reportTitle } from '../index/model';
import * as s from './dashboardSettings.css';
import { deleteReportInSettings } from './data';

type Cell = DashboardDetail['cells'][number];

export function ReportsTab({ detail }: { detail: DashboardDetail }) {
  const dashboardId = detail.dashboard.id;
  return (
    <div className={os.table} role="table" aria-label="Reports" data-testid="settings-reports">
      <div className={`${os.tableHeader} ${s.reportsGrid} ${s.headRow}`} role="row">
        <div className={os.headerCell} role="columnheader">
          <Icon icon="reports" size={14} className={os.headerIcon} />
          Report
        </div>
        <div className={os.headerCell} role="columnheader">
          <Icon icon="calendar" size={14} className={os.headerIcon} />
          Created at
        </div>
        <div role="columnheader" aria-label="Actions" />
      </div>
      {detail.cells.length === 0 ? (
        <div data-testid="settings-reports-empty">
          <EmptyState icon="reports" title="There are no reports in this dashboard" style={{ padding: '32px 24px' }} />
        </div>
      ) : (
        detail.cells.map((cell) => <ReportRow key={cell.id} cell={cell} dashboardId={dashboardId} />)
      )}
    </div>
  );
}

function ReportRow({ cell, dashboardId }: { cell: Cell; dashboardId: string }) {
  const ws = useWs();
  const { href } = useWorkspace();
  const [confirm, setConfirm] = useState(false);
  const report = cell.report;
  return (
    <>
      <div
        className={`${os.row} ${s.reportsGrid} ${s.dataRow}`}
        role="row"
        data-testid="settings-report-row"
        data-report-id={report.id}
      >
        <div className={os.cell} role="cell">
          <Link to={href(`reports/dashboard/${dashboardId}/cell/${cell.id}`)} className={s.rowLink}>
            {reportTitle(report.title)}
          </Link>
        </div>
        <div className={os.cell} role="cell">
          <span className={s.small}>{formatDistanceAgo(report.createdAt)}</span>
        </div>
        <div className={s.actions} role="cell">
          <MenuTrigger>
            <IconButton icon="moreVertical" aria-label="Options" size={28} data-testid="report-options" />
            <Menu
              aria-label="Options"
              placement="bottom end"
              width={200}
              onAction={(key) => {
                if (key === 'delete') setConfirm(true);
              }}
            >
              <MenuItem id="delete" icon="delete" variant="danger">
                Delete report
              </MenuItem>
            </Menu>
          </MenuTrigger>
        </div>
      </div>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Report deletion"
        description="Deleting a report deletes its data permanently and cannot be undone."
        confirmLabel="Confirm"
        onConfirm={() => void deleteReportInSettings(ws, dashboardId, report.id)}
      />
    </>
  );
}
