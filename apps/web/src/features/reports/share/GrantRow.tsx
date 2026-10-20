// One team or member grant: avatar (or team tile), name, muted email or member count, and the level dropdown with
// "Remove" (the Share popover and the Permissions tab share it).
import { Avatar, Icon } from '@agentic-crm/ui';
import { useWs } from '../data';
import { removeGrant, setGrantLevel } from './data';
import type { Grant } from './grants';
import { inheritanceOf } from './levels';
import { PermissionLevelSelect } from './PermissionLevelSelect';
import * as s from './share.css';

export function grantLabel(grant: Grant): { primary: string; secondary: string } {
  const name = grant.targetName ?? (grant.target.type === 'team' ? 'Team' : 'Member');
  if (grant.target.type === 'team') {
    const n = Number(grant.targetDetail ?? 0);
    return { primary: name, secondary: Number.isNaN(n) ? '' : `${n} ${n === 1 ? 'member' : 'members'}` };
  }
  return { primary: name, secondary: grant.targetDetail ?? '' };
}

/** A team's 16 / 20 / 24 px tile. */
export function TeamTile({ size = 16 }: { size?: 16 | 20 | 24 }) {
  return (
    <span className={s.teamTile} style={{ width: size, height: size }} aria-hidden="true">
      <Icon icon="people" size={size === 16 ? 12 : 14} />
    </span>
  );
}

export function TargetAvatar({ grant, size = 16 }: { grant: Grant; size?: 16 | 20 | 24 }) {
  if (grant.target.type === 'team') return <TeamTile size={size} />;
  return <Avatar kind="member" name={grant.targetName ?? '?'} seed={grant.target.id} size={size} />;
}

export function GrantRow({
  grant,
  dashboardId,
  canManage,
  variant = 'ghost',
  avatarSize = 16,
  className,
}: {
  grant: Grant;
  dashboardId: string;
  canManage: boolean;
  variant?: 'ghost' | 'outline';
  avatarSize?: 16 | 20 | 24;
  className?: string;
}) {
  const ws = useWs();
  const { primary, secondary } = grantLabel(grant);
  const type = grant.target.type === 'team' ? 'team' : 'member';
  const target = { type, id: grant.target.id } as const;
  return (
    <div
      className={className ?? s.grantRow}
      data-testid="grant-row"
      data-target-type={type}
      data-target-id={grant.target.id}
    >
      <TargetAvatar grant={grant} size={avatarSize} />
      <span className={s.grantName}>
        <span className={s.grantPrimary}>{primary}</span>
        {secondary && <span className={s.grantSecondary}>{secondary}</span>}
      </span>
      <PermissionLevelSelect
        value={grant.level}
        variant={variant}
        aria-label={`${primary} access`}
        isDisabled={!canManage}
        inherited={inheritanceOf(grant)}
        remove={{
          description: type === 'team' ? 'Remove team-level override' : 'Remove member-level override',
          onRemove: () => void removeGrant(ws, dashboardId, target),
        }}
        onChange={(level) => void setGrantLevel(ws, dashboardId, target, level)}
      />
    </div>
  );
}
