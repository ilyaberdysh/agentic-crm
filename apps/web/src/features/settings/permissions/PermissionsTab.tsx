// Permissions tab of an object or list:
// Members → "Workspace access" row; Teams, Individual members and Automations with "+ Add" pickers and one level
// dropdown per grant (Full access · Read and write · Read only · No access, "Remove" for overrides). A row whose own
// level is below what it inherits shows the inherited level with an amber ⚠ and the tooltip 'Inheriting "…" from …'.
import type { AccessScope, PermissionGrant, ResourceKind } from '@agentic-crm/contracts';
import { accessScopeRank } from '@agentic-crm/contracts';
import {
  Avatar,
  Button,
  ErrorState,
  FilterableMenu,
  Icon,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  Tooltip,
  toast,
} from '@agentic-crm/ui';
import { Button as AriaButton } from 'react-aria-components';
import { errorEnvelopeOf } from '../../../data/trpc';
import { brand } from '../../../lib/brand';
import { useWorkspace } from '../../shell/workspaceContext';
import { MemberAvatar, memberName, useFileUrl } from '../admin/parts';
import { useMembersList } from '../members/data';
import { useTeams } from '../teams/data';
import { TeamTile } from '../teams/parts';
import { useWorkspaceDetail } from '../workspace/data';
import { inheritanceHint, LEVEL_META, putPermission, removePermission, usePermissions } from './data';
import * as p from './permissions.css';

const HELP: Record<string, string> = {
  object: `${brand.supportUrl}/objects/manage-access-to-objects`,
  list: `${brand.supportUrl}/lists/lists-access`,
};

export function PermissionsTab({ kind, resourceId }: { kind: 'object' | 'list'; resourceId: string }) {
  const { workspace } = useWorkspace();
  const query = usePermissions(workspace, kind, resourceId);
  const teams = useTeams(workspace);
  const members = useMembersList(workspace);
  const detail = useWorkspaceDetail(workspace);
  const logo = useFileUrl(detail.data?.logoFileId);
  const data = query.data;

  if (query.isError)
    return (
      <ErrorState
        message="Failed to load permissions"
        style={{ padding: 48 }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  if (!data)
    return (
      <div className={p.root}>
        <Skeleton shape="block" height={56} width="100%" />
      </div>
    );

  const grants = data.grants;
  const workspaceGrant = grants.find((g) => g.target.type === 'workspace');
  const teamGrants = grants.filter((g) => g.target.type === 'team');
  const memberGrants = grants.filter((g) => g.target.type === 'member');
  const workflowGrants = grants.filter((g) => g.target.type === 'workflow');
  const workspaceLevel: AccessScope = workspaceGrant?.level ?? 'read-write';
  const canManage = data.canManage;

  async function change(target: Parameters<typeof putPermission>[3], level: AccessScope) {
    try {
      await putPermission(workspace, kind, resourceId, target, level);
    } catch (e) {
      toast.error({
        title: 'You do not have access to update these permissions.',
        description: errorEnvelopeOf(e).message,
      });
    }
  }

  async function remove(target: Parameters<typeof removePermission>[3]) {
    try {
      await removePermission(workspace, kind, resourceId, target);
    } catch (e) {
      toast.error({ title: 'Failed to remove the permission', description: errorEnvelopeOf(e).message });
    }
  }

  const freeTeams = (teams.data ?? []).filter((t) => !teamGrants.some((g) => g.target.id === t.id));
  const freeMembers = (members.data ?? []).filter(
    (m) => m.accessLevel !== 'suspended' && !memberGrants.some((g) => g.target.id === m.id),
  );

  return (
    <div className={p.root} data-testid="permissions-tab">
      <section className={`${p.block} ${p.lead}`} aria-label="Members">
        <div className={p.headText}>
          <h2 className={p.title}>Members</h2>
          <p className={p.description}>
            Set access rules for people in your workspace.{' '}
            <a className={p.learnMore} href={HELP[kind]} target="_blank" rel="noreferrer">
              Learn more
            </a>{' '}
            <Icon icon="arrowUpRight" size={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
          </p>
        </div>
        <div className={p.workspaceCard} data-testid="workspace-access">
          <Avatar
            kind="workspace"
            name={workspace.name}
            src={logo ?? workspace.logoUrl}
            seed={workspace.id}
            size={40}
          />
          <div className={p.workspaceText}>
            <span className={p.workspaceTitle}>Workspace access</span>
            <span className={p.smallDescription}>Set default access for all workspace members</span>
          </div>
          <LevelMenu
            label="Workspace access"
            levels={data.levels}
            value={workspaceLevel}
            display={workspaceLevel}
            bordered
            isDisabled={!canManage}
            onChange={(level) => void change({ type: 'workspace' }, level)}
          />
        </div>
      </section>

      <section className={p.block} aria-label="Teams">
        <div className={p.head}>
          <div className={p.headText}>
            <h3 className={p.subTitle}>Teams</h3>
            <p className={p.smallDescription}>
              Set access for teams. Team members will still inherit workspace access.
            </p>
          </div>
          <AddPicker
            label="Teams"
            placeholder="Search teams..."
            emptyLabel="No teams"
            isDisabled={!canManage}
            items={freeTeams.map((t) => ({ id: t.id, label: t.name, icon: <TeamTile icon={t.icon} size={16} /> }))}
            onPick={(id) => void change({ type: 'team', id }, workspaceLevel)}
          />
        </div>
        {teamGrants.length > 0 && (
          <div className={p.rows}>
            {teamGrants.map((g) => (
              <GrantRow
                key={g.target.id}
                grant={g}
                kind={kind}
                levels={data.levels}
                canManage={canManage}
                lead={<TeamTile icon={teams.data?.find((t) => t.id === g.target.id)?.icon} size={16} />}
                name={g.targetName ?? 'Team'}
                trailingBadge={g.targetDetail ?? undefined}
                removeLabel="Remove team-level override"
                onChange={(level) => void change({ type: 'team', id: g.target.id }, level)}
                onRemove={() => void remove({ type: 'team', id: g.target.id })}
              />
            ))}
          </div>
        )}
      </section>

      <section className={`${p.block} ${p.roomBelow}`} aria-label="Individual members">
        <div className={p.head}>
          <div className={p.headText}>
            <h3 className={p.subTitle}>Individual members</h3>
            <p className={p.smallDescription}>
              Set access for members. Members will still inherit team and workspace access.
            </p>
          </div>
          <AddPicker
            label="Individual members"
            placeholder="Search members..."
            emptyLabel="No members"
            isDisabled={!canManage}
            items={freeMembers.map((m) => ({
              id: m.id,
              label: memberName(m),
              detail: m.emailAddress,
              icon: <MemberAvatar member={m} size={16} />,
            }))}
            onPick={(id) => void change({ type: 'member', id }, workspaceLevel)}
          />
        </div>
        {memberGrants.length > 0 && (
          <div className={p.rows}>
            {memberGrants.map((g) => {
              const member = members.data?.find((m) => m.id === g.target.id);
              return (
                <GrantRow
                  key={g.target.id}
                  grant={g}
                  kind={kind}
                  levels={data.levels}
                  canManage={canManage}
                  lead={member ? <MemberAvatar member={member} size={16} /> : <Icon icon="user" size={16} />}
                  name={g.targetName ?? 'Member'}
                  detail={g.targetDetail ?? undefined}
                  removeLabel="Remove member-level override"
                  onChange={(level) => void change({ type: 'member', id: g.target.id }, level)}
                  onRemove={() => void remove({ type: 'member', id: g.target.id })}
                />
              );
            })}
          </div>
        )}
      </section>

      <section className={p.block} aria-label="Automations">
        <div className={p.head}>
          <div className={p.headText}>
            <h3 className={p.subTitle}>Automations</h3>
            <p className={p.smallDescription}>
              Set access rules for automations. Automations will still inherit workspace access.{' '}
              <a className={p.learnMore} href={HELP[kind]} target="_blank" rel="noreferrer">
                Learn more
              </a>{' '}
              <Icon icon="arrowUpRight" size={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
            </p>
          </div>
          <AddPicker
            label="Automations"
            placeholder="Search workflows…"
            emptyLabel="No workflows"
            isDisabled={!canManage}
            items={[]}
            onPick={() => undefined}
          />
        </div>
        {workflowGrants.length > 0 && (
          <div className={p.rows}>
            {workflowGrants.map((g) => (
              <GrantRow
                key={g.target.id}
                grant={g}
                kind={kind}
                levels={data.levels}
                canManage={canManage}
                lead={<Icon icon="workflows" size={16} />}
                name={g.targetName ?? 'Workflow'}
                removeLabel="Remove automation-level override"
                onChange={(level) => void change({ type: 'workflow', id: g.target.id }, level)}
                onRemove={() => void remove({ type: 'workflow', id: g.target.id })}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function GrantRow({
  grant,
  levels,
  canManage,
  lead,
  name,
  detail,
  trailingBadge,
  removeLabel,
  onChange,
  onRemove,
}: {
  grant: PermissionGrant;
  kind: ResourceKind;
  levels: AccessScope[];
  canManage: boolean;
  lead: React.ReactNode;
  name: string;
  detail?: string;
  trailingBadge?: string;
  removeLabel: string;
  onChange: (level: AccessScope) => void;
  onRemove: () => void;
}) {
  const hint = inheritanceHint(grant);
  return (
    <div className={p.row} data-testid="grant-row" data-target={grant.target.type}>
      <div className={p.rowMain}>
        {lead}
        <span className={p.rowName}>{name}</span>
        {trailingBadge !== undefined && <span className={p.count}>{trailingBadge}</span>}
        {detail && <span className={p.rowDetail}>{detail}</span>}
      </div>
      <LevelMenu
        label={name}
        levels={levels}
        value={grant.level}
        display={hint ? grant.effective.level : grant.level}
        hint={hint}
        floor={grant.effective.level}
        muted
        isDisabled={!canManage}
        removeLabel={removeLabel}
        onChange={onChange}
        onRemove={onRemove}
      />
    </div>
  );
}

/**
 * The level dropdown. `value` is the grant's own level (checked); `display` what the button shows (the inherited level
 * with a ⚠ when the grant is below what it inherits); `floor` disables levels below the inherited one.
 */
function LevelMenu({
  label,
  levels,
  value,
  display,
  hint,
  floor,
  bordered,
  muted,
  isDisabled,
  removeLabel,
  onChange,
  onRemove,
}: {
  label: string;
  levels: AccessScope[];
  value: AccessScope;
  display: AccessScope;
  hint?: string | null;
  floor?: AccessScope;
  bordered?: boolean;
  muted?: boolean;
  isDisabled?: boolean;
  removeLabel?: string;
  onChange: (level: AccessScope) => void;
  onRemove?: () => void;
}) {
  const button = (
    <AriaButton
      className={`${p.levelButton} ${bordered ? p.levelBordered : ''} ${muted ? p.levelMuted : ''}`}
      aria-label={`${label}: ${LEVEL_META[display].label}`}
      isDisabled={isDisabled}
    >
      {hint && <Icon icon="warning" size={14} className={p.warnIcon} />}
      {LEVEL_META[display].label}
      <Icon icon="chevronDown" size={14} />
    </AriaButton>
  );
  return (
    <MenuTrigger>
      {hint ? <Tooltip content={hint}>{button}</Tooltip> : button}
      <Menu
        aria-label={`${label} access`}
        placement="bottom end"
        width={340}
        selectionMode="single"
        selectedKeys={[value]}
        disallowEmptySelection
        onAction={(key) => {
          if (key === 'remove') onRemove?.();
          else onChange(String(key) as AccessScope);
        }}
      >
        {levels.map((level) => (
          <MenuItem
            key={level}
            id={level}
            icon={LEVEL_META[level].icon}
            description={LEVEL_META[level].description}
            isDisabled={floor !== undefined && level !== value && accessScopeRank[level] < accessScopeRank[floor]}
          >
            {LEVEL_META[level].label}
          </MenuItem>
        ))}
        {onRemove && <MenuSeparator />}
        {onRemove && (
          <MenuItem id="remove" icon="close" description={removeLabel}>
            Remove
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );
}

function AddPicker({
  label,
  placeholder,
  emptyLabel,
  items,
  isDisabled,
  onPick,
}: {
  label: string;
  placeholder: string;
  emptyLabel: string;
  items: { id: string; label: string; detail?: string; icon: React.ReactElement }[];
  isDisabled?: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <MenuTrigger>
      <Button variant="secondary" size={28} icon="add" aria-label={`Add ${label}`} isDisabled={isDisabled}>
        Add
      </Button>
      <FilterableMenu
        aria-label={label}
        placeholder={placeholder}
        emptyLabel={emptyLabel}
        placement="bottom end"
        width={260}
        onAction={(key) => onPick(String(key))}
      >
        {items.map((item) => (
          <MenuItem key={item.id} id={item.id} icon={item.icon} textValue={`${item.label} ${item.detail ?? ''}`}>
            {item.label}
            {item.detail && (
              <span style={{ color: 'var(--ar-color-content-tertiary)', marginLeft: 6 }}>{item.detail}</span>
            )}
          </MenuItem>
        ))}
      </FilterableMenu>
    </MenuTrigger>
  );
}
