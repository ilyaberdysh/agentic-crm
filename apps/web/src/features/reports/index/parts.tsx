// Rows and cards of the dashboards index and of Settings → Dashboards: tinted dashboard tile, title link (stretched
// over the whole row), ⓘ description, report chips, favourite card, the row menu with "Delete dashboard" and its
// confirmation (H README §2.1, §3.1, §3.10).
import type { DashboardSummary } from '@agentic-crm/contracts';
import { AlertDialog, Icon, IconButton, Menu, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@agentic-crm/ui';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useMembers } from '../../attributes/data/queries';
import { FavoriteStar, useFavoriteToggle } from '../../favorites';
import { actorName } from '../../notes/actors';
import { relativeDay } from '../../notes/format';
import { useWorkspace } from '../../shell/workspaceContext';
import { useCalendar } from '../../tasks/calendar';
import { deleteDashboard, useWs } from '../data';
import { DashboardTileIcon } from '../icons';
import * as s from './dashboardsIndex.css';
import { formatCreatedAt } from './format';
import { reportGlyph } from './glyphs';
import { dashboardTitle, reportTitle, splitChips, thumbnails, tintOf } from './model';

/** Index rows show up to this many report chips (the rest is a "+N" chip); the chips shrink to fit. */
export const MAX_CHIPS = 6;

export function DashboardTile({ id, size = 24 }: { id: string; size?: 20 | 24 }) {
  return (
    <span className={`${s.tile} ${s.tint[tintOf(id)]}`} style={{ width: size, height: size }} aria-hidden="true">
      <Icon icon={DashboardTileIcon} size={size === 24 ? 16 : 14} />
    </span>
  );
}

/** ⓘ after the title when the dashboard has a description; hover or focus shows it. */
export function DescriptionInfo({ description }: { description: string | null }) {
  if (!description || !description.trim()) return null;
  return (
    <Tooltip content={description} placement="top">
      <AriaButton className={s.infoButton} aria-label="Dashboard description" data-testid="dashboard-info">
        <Icon icon="info" size={14} />
      </AriaButton>
    </Tooltip>
  );
}

export function ReportChips({ reports, max = MAX_CHIPS }: { reports: DashboardSummary['reports']; max?: number }) {
  const { shown, rest } = splitChips(reports, max);
  if (reports.length === 0) return null;
  return (
    <span className={s.chips} data-testid="report-chips">
      {shown.map((r) => (
        <span key={r.id} className={s.chip} data-testid="report-chip" title={reportTitle(r.title)}>
          <Icon icon={reportGlyph(r.visualisationType)} size={12} className={s.chipGlyph} />
          <span className={s.chipText}>{reportTitle(r.title)}</span>
        </span>
      ))}
      {rest > 0 && (
        <span className={s.chipMore} data-testid="report-chips-more">
          +{rest}
        </span>
      )}
    </span>
  );
}

/**
 * ⋮ menu: "Delete dashboard" (destructive, confirmed), and on the index "Created by …" with the absolute time under
 * it (`label` "Options" and no footer in Settings → Dashboards).
 */
export function DashboardMenu({
  dashboard,
  className,
  onDeleted,
  label = 'Dashboard options',
  showMeta = true,
}: {
  dashboard: DashboardSummary;
  className?: string;
  onDeleted?: () => void;
  label?: string;
  showMeta?: boolean;
}) {
  const ws = useWs();
  const calendar = useCalendar();
  const members = useMembers();
  const [confirm, setConfirm] = useState(false);
  const canDelete = dashboard.access.flags.delete_reporting_dashboard;
  return (
    <>
      <MenuTrigger>
        <IconButton
          icon="moreVertical"
          aria-label={label}
          size={28}
          className={className}
          data-testid="dashboard-menu"
        />
        <Menu
          aria-label={label}
          placement="bottom end"
          width={240}
          onAction={(key) => {
            if (key === 'delete') setConfirm(true);
          }}
        >
          <MenuItem id="delete" icon="delete" variant="danger" isDisabled={!canDelete}>
            Delete dashboard
          </MenuItem>
          {showMeta && <MenuSeparator />}
          {showMeta && (
            <MenuItem id="meta" isDisabled className={s.metaItem} textValue="Created by">
              <span>
                <span className={s.metaLine}>Created by {actorName(dashboard.createdBy, members)}</span>
                <br />
                <span className={s.metaSub}>{formatCreatedAt(dashboard.createdAt, calendar.timeZone)}</span>
              </span>
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Are you sure?"
        description="Are you sure you want to delete this dashboard?"
        confirmLabel="Confirm"
        onConfirm={() => {
          void deleteDashboard(ws, dashboard.id).then((ok) => ok && onDeleted?.());
        }}
      />
    </>
  );
}

/** One row of the index table: the title is the link, stretched over the row. */
export function DashboardRow({ dashboard: d }: { dashboard: DashboardSummary }) {
  const { href } = useWorkspace();
  const calendar = useCalendar();
  const { isFavorite } = useFavoriteToggle({ favoriteType: 'reporting-dashboard', targetId: d.id });
  return (
    <div className={`${s.grid} ${s.row}`} role="row" data-testid="dashboard-row" data-dashboard-id={d.id}>
      <span className={`${s.cell} ${s.cellFirst}`} role="cell">
        <DashboardTile id={d.id} />
        <Link to={href(`reports/dashboard/${d.id}`)} className={s.titleLink}>
          {dashboardTitle(d.title)}
        </Link>
        <DescriptionInfo description={d.description} />
      </span>
      <span className={s.cell} role="cell">
        <ReportChips reports={d.reports} />
      </span>
      <span className={`${s.cell} ${s.created}`} role="cell">
        {relativeDay(d.createdAt, calendar.timeZone, calendar.locale)}
      </span>
      <span className={s.rowActions}>
        <FavoriteStar
          favoriteType="reporting-dashboard"
          targetId={d.id}
          size={28}
          className={isFavorite ? undefined : s.hoverOnly}
        />
        <DashboardMenu dashboard={d} className={s.hoverOnly} />
      </span>
    </div>
  );
}

/** A card of the Favorites strip: up to three report thumbnails, "+N", and the title. */
export function FavoriteCard({ dashboard: d }: { dashboard: DashboardSummary }) {
  const { href } = useWorkspace();
  const { shown, more } = thumbnails(d.reports, d.reportCount);
  return (
    <div className={s.card} data-testid="favorite-card" data-dashboard-id={d.id}>
      <div className={s.thumbs} aria-hidden="true">
        {shown.length === 0 && (
          <span className={s.thumb}>
            <Icon icon={DashboardTileIcon} size={20} className={s.headIcon} />
          </span>
        )}
        {shown.map((r) => (
          <span key={r.id} className={s.thumb}>
            <span className={s.thumbGlyph}>
              <Icon icon={reportGlyph(r.visualisationType)} size={16} />
            </span>
          </span>
        ))}
        {more > 0 && <span className={s.thumbMore}>+{more}</span>}
      </div>
      <Link to={href(`reports/dashboard/${d.id}`)} className={s.cardTitle}>
        {dashboardTitle(d.title)}
      </Link>
    </div>
  );
}
