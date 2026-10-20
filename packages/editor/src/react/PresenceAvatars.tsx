// Presence avatar stack for a note window header (E editor.md §10.5, components.md §5 PresenceAvatarStack): one
// avatar per distinct viewing user (current user included), 2 px surface ring, overlapping, max 10 then "+N".
import { Avatar, type AvatarSize, Tooltip } from '@agentic-crm/ui';
import { presenceHue } from '../model/colors.ts';
import * as s from './menus.css.ts';
import type { PresenceUser } from './types.ts';

export interface PresenceAvatarsProps {
  users: readonly PresenceUser[];
  size?: Extract<AvatarSize, 16 | 20 | 24>;
  max?: number;
  className?: string;
}

export function PresenceAvatars({ users, size = 24, max = 10, className }: PresenceAvatarsProps) {
  const shown = users.slice(0, max);
  const more = users.length - shown.length;
  return (
    <span className={`${s.presenceStack} ${className ?? ''}`} data-testid="presence-avatars" aria-label="Viewing now">
      {shown.map((user) => (
        <Tooltip key={user.id} content={user.isSelf ? `${user.name} (you)` : user.name}>
          <span className={s.presenceItem} data-user={user.name} tabIndex={-1}>
            <Avatar
              name={user.name}
              src={user.avatarUrl ?? null}
              size={size}
              color={presenceHue(user.memberId || user.id)}
              kind="member"
            />
          </span>
        </Tooltip>
      ))}
      {more > 0 ? <span className={s.presenceMore}>+{more}</span> : null}
    </span>
  );
}
