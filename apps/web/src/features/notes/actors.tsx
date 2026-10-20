// Actors as notes, tasks and comments show them: a workspace member (avatar + name), an API token ("API"), a
// workflow or the system. Members come from the cached member list (features/attributes).
import type { Actor } from '@agentic-crm/contracts';
import { Avatar, type AvatarSize, cx, toast } from '@agentic-crm/ui';
import { useMembers } from '../attributes/data/queries';
import { actorTypeLabel, memberName } from '../attributes/format/formatValue';
import type { Member } from '../attributes/types';
import * as s from './notesPage.css';

export function useMember(memberId: string | null | undefined): Member | undefined {
  const members = useMembers();
  return memberId ? members.find((m) => m.id === memberId) : undefined;
}

export function actorName(actor: Actor | null | undefined, members: Member[]): string {
  if (!actor) return 'Unknown';
  if (actor.type === 'workspace-member') {
    const m = members.find((x) => x.id === actor.id);
    return m ? memberName(m) || m.emailAddress : 'Workspace member';
  }
  if (actor.type === 'api-token') return 'API';
  return actorTypeLabel(actor.type);
}

export function MemberAvatarById({ memberId, size = 16 }: { memberId: string | null; size?: AvatarSize }) {
  const member = useMember(memberId);
  const name = member ? memberName(member) || member.emailAddress : '?';
  return <Avatar name={name} seed={memberId ?? name} size={size} kind="member" />;
}

/** Avatar + name of whoever created / authored something. */
export function ActorLabel({
  actor,
  size = 16,
  className,
  bold = false,
}: {
  actor: Actor | null | undefined;
  size?: AvatarSize;
  className?: string;
  bold?: boolean;
}) {
  const members = useMembers();
  const name = actorName(actor, members);
  const isMember = actor?.type === 'workspace-member';
  return (
    <span className={cx(s.actor, className)}>
      {isMember ? (
        <Avatar name={name} seed={actor?.id ?? name} size={size} kind="member" />
      ) : (
        <span className={s.actorTile} style={{ width: size, height: size, fontSize: Math.max(8, size - 6) }}>
          {(name[0] ?? '?').toUpperCase()}
        </span>
      )}
      <span className={cx(s.actorName, bold && s.actorNameBold)}>{name}</span>
    </span>
  );
}

/** Copies text and confirms with a neutral toast. */
export async function copyToClipboard(value: string, title = 'Copied to clipboard'): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast({ title });
  } catch {
    toast.error({ title: 'Could not copy to the clipboard' });
  }
}
