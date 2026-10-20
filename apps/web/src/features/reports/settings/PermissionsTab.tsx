// Permissions tab of a dashboard's settings (H README §3.11; evidence H/settings-dashboard-permissions.png; J
// permissions §4–5): "Members — Set access rules for people in your workspace.", the "Workspace access" card with its
// level, "Teams" and "Individual members" with "+ Add" (a search popover over those without a grant; adding creates the
// grant with the current workspace level) and one row per grant (avatar, name, email, level dropdown, Remove). Every
// change is saved at once through permissions.put / remove; admins can always manage grants (OQ-067).
import { Avatar, Button, FilterableMenu, Icon, MenuItem, MenuTrigger, Skeleton } from '@agentic-crm/ui';
import { brand } from '../../../lib/brand';
import { useWorkspace } from '../../shell/workspaceContext';
import { useWs } from '../data';
import {
  freeTargets,
  GrantRow,
  type Grants,
  PermissionLevelSelect,
  setGrantLevel,
  splitGrants,
  TeamTile,
  useGrants,
  useGrantTargets,
} from '../share';
import * as s from './dashboardSettings.css';

export function PermissionsTab({ dashboardId }: { dashboardId: string }) {
  const { workspace } = useWorkspace();
  const ws = useWs();
  const grants = useGrants(dashboardId);
  const { workspace: workspaceGrant, teams, members } = splitGrants(grants.data);
  const canManage = grants.data?.canManage ?? false;
  return (
    <div className={s.permissions} data-testid="settings-permissions">
      <section aria-label="Members">
        <h2 className={s.sectionTitle}>Members</h2>
        <p className={s.sectionSub}>
          Set access rules for people in your workspace.{' '}
          <a className={s.learn} href={brand.supportUrl} target="_blank" rel="noreferrer">
            Learn more
          </a>{' '}
          <Icon icon="arrowUpRight" size={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
        </p>
      </section>
      <div className={`${s.workspaceCard} ${s.afterHeading}`} data-testid="workspace-access">
        <Avatar kind="workspace" name={workspace.name} src={workspace.logoUrl} seed={workspace.id} size={40} />
        <div className={s.workspaceText}>
          <span className={s.cardTitle}>Workspace access</span>
          <span className={s.cardSub}>Set default access for all workspace members</span>
        </div>
        {workspaceGrant ? (
          <PermissionLevelSelect
            value={workspaceGrant.level}
            variant="outline"
            aria-label="Workspace access"
            isDisabled={!canManage}
            onChange={(level) => void setGrantLevel(ws, dashboardId, { type: 'workspace', id: workspace.id }, level)}
            data-testid="settings-workspace-level"
          />
        ) : (
          <Skeleton shape="text" width={90} />
        )}
      </div>
      <Group
        title="Teams"
        description="Set access for teams. Team members will still inherit workspace access."
        kind="team"
        dashboardId={dashboardId}
        grants={grants.data}
        rows={teams}
        canManage={canManage}
      />
      <Group
        title="Individual members"
        description="Set access for members. Members will still inherit team and workspace access."
        kind="member"
        dashboardId={dashboardId}
        grants={grants.data}
        rows={members}
        canManage={canManage}
      />
    </div>
  );
}

type Row = ReturnType<typeof splitGrants>['members'][number];

function Group({
  title,
  description,
  kind,
  dashboardId,
  grants,
  rows,
  canManage,
}: {
  title: string;
  description: string;
  kind: 'team' | 'member';
  dashboardId: string;
  grants: Grants | undefined;
  rows: Row[];
  canManage: boolean;
}) {
  return (
    <section className={s.group} aria-label={title} data-testid={`permissions-${kind}s`}>
      <div className={s.sectionHead}>
        <div>
          <h3 className={s.groupTitle}>{title}</h3>
          <p className={s.groupSub}>{description}</p>
        </div>
        <AddTarget kind={kind} dashboardId={dashboardId} grants={grants} disabled={!canManage} />
      </div>
      {rows.length > 0 ? (
        <div className={s.grantCard}>
          {rows.map((g) => (
            <GrantRow
              key={g.target.id}
              grant={g}
              dashboardId={dashboardId}
              canManage={canManage}
              variant="outline"
              avatarSize={24}
              className={s.grantRow}
            />
          ))}
        </div>
      ) : (
        <hr className={s.groupRule} />
      )}
    </section>
  );
}

/** "+ Add": a search popover of the teams or members without a grant. */
function AddTarget({
  kind,
  dashboardId,
  grants,
  disabled,
}: {
  kind: 'team' | 'member';
  dashboardId: string;
  grants: Grants | undefined;
  disabled: boolean;
}) {
  const ws = useWs();
  const targets = useGrantTargets(!disabled);
  const free = freeTargets(grants, targets.members, targets.teams);
  const workspaceLevel = splitGrants(grants).workspace?.level ?? 'full-access';
  const label = kind === 'team' ? 'team' : 'member';
  return (
    <MenuTrigger>
      <Button variant="secondary" size={28} icon="add" isDisabled={disabled} data-testid={`add-${kind}`}>
        Add
      </Button>
      <FilterableMenu
        aria-label={`Add ${label}`}
        placeholder={`Search ${label}s...`}
        emptyLabel={`No ${label}s`}
        placement="bottom end"
        width={320}
        onAction={(key) => {
          const id = String(key);
          const entry = kind === 'team' ? free.teams.find((t) => t.id === id) : free.members.find((m) => m.id === id);
          void setGrantLevel(
            ws,
            dashboardId,
            { type: kind, id },
            workspaceLevel,
            entry
              ? {
                  name: entry.name,
                  detail: 'email' in entry ? entry.email : String(entry.memberCount),
                }
              : undefined,
          );
        }}
      >
        {kind === 'team'
          ? free.teams.map((t) => (
              <MenuItem key={t.id} id={t.id} textValue={t.name} icon={<TeamTile size={20} />}>
                {t.name}
              </MenuItem>
            ))
          : free.members.map((m) => (
              <MenuItem
                key={m.id}
                id={m.id}
                textValue={`${m.name} ${m.email}`}
                icon={<Avatar kind="member" name={m.name} seed={m.id} size={20} />}
                description={m.email}
              >
                {m.name}
              </MenuItem>
            ))}
      </FilterableMenu>
    </MenuTrigger>
  );
}
