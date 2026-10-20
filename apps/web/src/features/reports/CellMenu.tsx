// The report ⋮ menu (H README §3.6; BACKLOG acceptance 4, X-12): Download as image, Edit, Duplicate, Duplicate to…,
// separator, Delete report, separator, footer "Created by {member}" + time. The editor's menu is the same without Edit.
// Used by dashboard cells, the editor and the viewer.
import type { Actor } from '@agentic-crm/contracts';
import { AlertDialog, IconButton, Menu, MenuItem, MenuSeparator, MenuTrigger, Submenu } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useWorkspace } from '../shell/workspaceContext';
import { useMembers } from '../views/data';
import * as d from './dashboard/dashboard.css';
import { deleteReport, duplicateReport, duplicateReportTo, useDashboards, useWs } from './data';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "9 Oct 2026 1:46 PM" (menu footers: `d MMM yyyy h:mm a`), in the viewer's zone. */
export function formatCreated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${MONTHS[Number(get('month')) - 1]} ${get('year')} ${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
}

/** Name of the member behind an actor ("Attio system"-style names for system actors). */
export function useActorName(actor: Actor | null | undefined): string {
  const members = useMembers();
  if (!actor) return 'Unknown';
  if (actor.type === 'workspace-member') {
    const m = members?.find((x) => x.id === actor.id);
    if (!m) return 'Workspace member';
    return [m.firstName, m.lastName].filter(Boolean).join(' ') || m.emailAddress;
  }
  if (actor.type === 'system') return 'System';
  if (actor.type === 'workflow') return 'Workflow';
  return 'Integration';
}

export interface CellMenuProps {
  dashboardId: string;
  cellId: string;
  reportId: string;
  createdBy: Actor;
  createdAt: string;
  /** May update the dashboard (Edit, Duplicate, Delete). */
  canEdit: boolean;
  /** The dashboard's menu has Edit; the editor's does not. */
  withEdit: boolean;
  onDownload: () => void;
  /** After the report was deleted (the editor / viewer return to the dashboard). */
  onDeleted?: () => void;
  'aria-label'?: string;
}

export function CellMenu({
  dashboardId,
  cellId,
  reportId,
  createdBy,
  createdAt,
  canEdit,
  withEdit,
  onDownload,
  onDeleted,
  'aria-label': ariaLabel = 'Cell menu',
}: CellMenuProps) {
  const ws = useWs();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const dashboards = useDashboards();
  const [confirming, setConfirming] = useState(false);
  const author = useActorName(createdBy);

  const go = (path: string) => void navigate({ href: href(path) });
  const onAction = async (key: React.Key) => {
    const id = String(key);
    if (id === 'download') onDownload();
    else if (id === 'edit') go(`reports/dashboard/${dashboardId}/cell/${cellId}/edit`);
    else if (id === 'duplicate') {
      const copy = await duplicateReport(ws, dashboardId, reportId);
      if (copy) go(`reports/dashboard/${dashboardId}/cell/${copy.cell.id}/edit`);
    } else if (id === 'delete') setConfirming(true);
    else if (id.startsWith('to:')) void duplicateReportTo(ws, reportId, id.slice(3));
  };
  const targets = dashboards.data ?? [];
  return (
    <>
      <MenuTrigger>
        <IconButton icon="moreVertical" aria-label={ariaLabel} size={20} data-testid="cell-menu-button" />
        <Menu aria-label="Report actions" placement="bottom end" width={220} onAction={(k) => void onAction(k)}>
          <MenuItem id="download" icon="download">
            Download as image
          </MenuItem>
          {canEdit && withEdit && (
            <MenuItem id="edit" icon="edit">
              Edit
            </MenuItem>
          )}
          {canEdit && (
            <MenuItem id="duplicate" icon="copy">
              Duplicate
            </MenuItem>
          )}
          <Submenu label="Duplicate to..." icon="copy" menuWidth={240} id="duplicate-to">
            {targets.map((t) => (
              <MenuItem key={t.id} id={`to:${t.id}`} isDisabled={!t.access.flags.update_reporting_dashboard}>
                {t.title || 'Untitled Dashboard'}
              </MenuItem>
            ))}
          </Submenu>
          {canEdit && <MenuSeparator />}
          {canEdit && (
            <MenuItem id="delete" icon="delete" variant="danger">
              Delete report
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem id="created" isDisabled className={d.menuFooterItem}>
            <span className={d.menuFooter} data-testid="cell-menu-footer">
              <span>Created by {author}</span>
              <span>{formatCreated(createdAt)}</span>
            </span>
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Are you sure?"
        description="Are you sure you want to delete this report?"
        onConfirm={() => void deleteReport(ws, dashboardId, reportId).then((ok) => ok && onDeleted?.())}
      />
    </>
  );
}
