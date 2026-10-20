// Dashboard permissions (H api §1.5, CROSS-DOMAIN B.12): grants in resource_permissions (kind 'dashboard'), four
// levels as presets of four flags. New dashboards get workspace Full access + creator Full access (X-06 defaults in
// contracts resourceKindDefaults). Reports inherit their dashboard's access; on top, a report is hidden from members
// who cannot read its data source (help dashboards.md: "reports on lists are hidden from members without list
// access"). Admins follow grants like everyone else (OQ-067) but can always manage them and see every dashboard in
// Settings → Dashboards.
import {
  type AccessScope,
  type DashboardAccess,
  type DashboardFlag,
  dashboardFlags,
  kindFlagsForScope,
} from '@agentic-crm/contracts';
import { forbidden } from '../errors.ts';
import { isAdminCaller } from '../permissions/admin.ts';
import { loadResourceGrants } from '../permissions/grants.ts';
import { effectiveAccess, principalOf } from '../permissions/resolve.ts';
import { registerResourceKind } from '../permissions/service.ts';
import { subjectOf } from '../permissions.ts';
import type { Tx } from '../tx.ts';
import { type DashboardRow, dashboardNotFound, loadDashboardRow } from './model.ts';

registerResourceKind('dashboard', {
  async load(tx, ref) {
    const row = await loadDashboardRow(tx, ref);
    return { id: row.id, name: row.title };
  },
  emit(tx, id) {
    // Clients refetch the dashboard (and its resolved access) and the index.
    tx.emit('reporting-dashboard', id, { dashboardId: id });
    tx.emit('reporting-dashboard-list', null);
  },
});

/** The caller's resolved access per dashboard id. */
export async function dashboardAccess(tx: Tx, dashboardIds: string[]): Promise<Map<string, DashboardAccess>> {
  const out = new Map<string, DashboardAccess>();
  if (dashboardIds.length === 0) return out;
  const grants = await loadResourceGrants(tx, 'dashboard', dashboardIds);
  const principal = await principalOf(tx, await subjectOf(tx));
  const admin = await isAdminCaller(tx);
  for (const id of dashboardIds) {
    const { level } = effectiveAccess('dashboard', grants.get(id), principal);
    const flags = kindFlagsForScope('dashboard', level) as Record<DashboardFlag, boolean>;
    out.set(id, {
      level,
      flags,
      canManagePermissions: admin || flags.administrate_reporting_dashboard_permissions,
    });
  }
  return out;
}

export function noAccess(): DashboardAccess {
  const level: AccessScope = 'no-access';
  return {
    level,
    flags: Object.fromEntries(dashboardFlags.map((f) => [f, false])) as Record<DashboardFlag, boolean>,
    canManagePermissions: false,
  };
}

/**
 * Loads a dashboard the caller holds `flag` on. Without read access the dashboard does not exist for the caller
 * (404, `dnXvoF`); with read but not `flag`, 403.
 */
export async function requireDashboard(
  tx: Tx,
  dashboardId: string,
  flag: DashboardFlag,
): Promise<{ row: DashboardRow; access: DashboardAccess }> {
  const row = await loadDashboardRow(tx, dashboardId);
  const access = (await dashboardAccess(tx, [row.id])).get(row.id) ?? noAccess();
  if (!access.flags.read_reporting_dashboard) throw dashboardNotFound(dashboardId);
  if (!access.flags[flag]) {
    throw forbidden('You do not have permission to do this', {
      reporting_dashboard_id: row.id,
      action: flag,
    });
  }
  return { row, access };
}
