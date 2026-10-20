// Members and teams → Members (J workspace-admin §3.1, raw s70/s71): search, Filter (Invited · Suspended · Active),
// "Invite members", and the members table — User (avatar, name "(You)", email) · Role · Teams · ⋮. Pending invites come
// first with "Invite pending". Row menus: Manage teams, Make workspace admin/member, Suspend from workspace /
// Reactivate user, Remove from workspace; invites: Copy invite link, Revoke invite.
import type { MemberSummary, Team, WorkspaceInvite } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  ErrorState,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SearchField,
  Skeleton,
  toast,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { inviteLink } from '../../../data/invites';
import { errorEnvelopeOf } from '../../../data/trpc';
import { useWorkspace } from '../../shell/workspaceContext';
import * as a from '../admin/admin.css';
import { MemberAvatar, memberName } from '../admin/parts';
import * as os from '../objects/objects.css';
import { copyToClipboard } from '../objects/parts';
import { useTeams } from '../teams/data';
import { TeamTile } from '../teams/parts';
import {
  ROLE_LABEL,
  reactivateMember,
  removeMember,
  revokeInvite,
  setAccessLevel,
  suspendMember,
  useInvites,
  useMembersList,
} from './data';
import { InviteDialog } from './InviteDialog';
import { ManageTeamsDialog } from './ManageTeamsDialog';
import * as m from './members.css';

type StatusFilter = 'invited' | 'suspended' | 'active';

type Row = { kind: 'member'; member: MemberSummary } | { kind: 'invite'; invite: WorkspaceInvite };

export function RoleChip({ level }: { level: 'admin' | 'member' | 'suspended' }) {
  return (
    <span className={`${m.roleChip} ${level === 'admin' ? m.roleAdmin : level === 'suspended' ? m.roleSuspended : ''}`}>
      {ROLE_LABEL[level]}
    </span>
  );
}

export function TeamChips({ ids, teams }: { ids: string[]; teams: Team[] }) {
  const named = ids.map((id) => teams.find((t) => t.id === id)).filter((t): t is Team => Boolean(t));
  if (named.length === 0) return null;
  const shown = named.slice(0, 2);
  const rest = named.length - shown.length;
  return (
    <span className={a.chips}>
      {shown.map((t) => (
        <span key={t.id} className={a.chip}>
          <TeamTile icon={t.icon} size={16} />
          <span className={os.cellText}>{t.name}</span>
        </span>
      ))}
      {rest > 0 && <span className={a.chip}>+{rest}</span>}
    </span>
  );
}

export function MembersTab() {
  const { workspace, href, me } = useWorkspace();
  const navigate = useNavigate();
  const members = useMembersList(workspace);
  const invites = useInvites(workspace, true);
  const teams = useTeams(workspace);
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<Set<StatusFilter>>(new Set());
  const [inviting, setInviting] = useState(false);
  const [managing, setManaging] = useState<MemberSummary | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: 'suspend'; member: MemberSummary }
    | { kind: 'remove'; member: MemberSummary }
    | { kind: 'revoke'; invite: WorkspaceInvite }
    | null
  >(null);
  const selfId = workspace.membership.id;

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (name: string, email: string) =>
      !q || name.toLowerCase().includes(q) || email.toLowerCase().includes(q);
    const out: Row[] = [];
    const want = (s: StatusFilter) => statuses.size === 0 || statuses.has(s);
    if (want('invited'))
      for (const invite of invites.data ?? [])
        if (matches(memberName(invite), invite.emailAddress)) out.push({ kind: 'invite', invite });
    for (const member of members.data ?? []) {
      const status: StatusFilter = member.accessLevel === 'suspended' ? 'suspended' : 'active';
      if (want(status) && matches(memberName(member), member.emailAddress)) out.push({ kind: 'member', member });
    }
    return out;
  }, [members.data, invites.data, query, statuses]);

  async function run(label: string, action: () => Promise<unknown>, done?: string) {
    try {
      await action();
      if (done) toast.success(done);
    } catch (e) {
      toast.error({ title: `Failed to ${label}`, description: errorEnvelopeOf(e).message });
    }
  }

  const pending = members.isPending || invites.isPending;
  if (members.isError)
    return (
      <ErrorState
        message="Failed to load members"
        style={{ padding: 48 }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void members.refetch()}>
            Retry
          </Button>
        }
      />
    );

  return (
    <>
      <div className={a.toolbar}>
        <SearchField
          aria-label="Search name or email"
          placeholder="Search name or email"
          size={32}
          value={query}
          onChange={setQuery}
          className={a.toolbarGrow}
        />
        <MenuTrigger>
          <Button variant="secondary" size={32} icon="filter" isActive={statuses.size > 0}>
            Filter
          </Button>
          <Menu
            aria-label="Filter by"
            placement="bottom end"
            width={200}
            selectionMode="multiple"
            selectedKeys={statuses}
            onSelectionChange={(keys) => setStatuses(new Set([...(keys as Set<StatusFilter>)]))}
          >
            <MenuItem id="invited">Invited</MenuItem>
            <MenuItem id="suspended">Suspended</MenuItem>
            <MenuItem id="active">Active</MenuItem>
            <MenuSeparator />
            <MenuItem id="reset" isDisabled={statuses.size === 0} onAction={() => setStatuses(new Set())}>
              Reset filters
            </MenuItem>
          </Menu>
        </MenuTrigger>
        <Button variant="primary" size={32} icon="invite" onPress={() => setInviting(true)}>
          Invite members
        </Button>
      </div>
      <div className={os.table} role="table" aria-label="Members">
        <div className={`${os.tableHeader} ${m.membersGrid}`} role="row">
          <div className={os.headerCell} role="columnheader">
            <Icon icon="user" size={14} className={os.headerIcon} />
            User
          </div>
          <div className={os.headerCell} role="columnheader">
            <Icon icon="lock" size={14} className={os.headerIcon} />
            Role
          </div>
          <div className={os.headerCell} role="columnheader">
            <Icon icon="people" size={14} className={os.headerIcon} />
            Teams
          </div>
          <div role="columnheader" aria-label="Actions" />
        </div>
        {pending &&
          [0, 1, 2].map((i) => (
            <div key={i} className={`${os.row} ${m.membersGrid}`} data-static role="row">
              <Skeleton shape="text" width={160} />
              <Skeleton shape="text" width={50} />
              <Skeleton shape="text" width={60} />
            </div>
          ))}
        {rows.map((row) =>
          row.kind === 'invite' ? (
            <div key={row.invite.id} className={`${os.row} ${m.membersGrid}`} data-static role="row">
              <div className={os.cell} role="cell">
                <div className={m.userCell}>
                  <span className={m.pendingAvatar} aria-hidden="true">
                    ?
                  </span>
                  <span className={m.userName}>{row.invite.emailAddress}</span>
                </div>
              </div>
              <div className={os.cell} role="cell">
                <span className={m.roleChip}>{ROLE_LABEL[row.invite.accessLevel]}</span>
              </div>
              <div className={os.cell} role="cell">
                <span className={a.pendingChip}>Invite pending</span>
              </div>
              <div className={os.rowActions} role="cell">
                <MenuTrigger>
                  <IconButton icon="moreVertical" aria-label="Options" variant="ghost" size={28} />
                  <Menu aria-label="Invite options" placement="bottom end" width={200}>
                    <MenuItem
                      icon="link"
                      onAction={() =>
                        void copyToClipboard(inviteLink(workspace.slug, row.invite.id), () =>
                          toast('Link copied to clipboard', { icon: 'link' }),
                        )
                      }
                    >
                      Copy invite link
                    </MenuItem>
                    <MenuItem
                      icon="delete"
                      variant="danger"
                      onAction={() => setConfirm({ kind: 'revoke', invite: row.invite })}
                    >
                      Revoke invite
                    </MenuItem>
                  </Menu>
                </MenuTrigger>
              </div>
            </div>
          ) : (
            <MemberRow
              key={row.member.id}
              member={row.member}
              isSelf={row.member.id === selfId || row.member.userId === me.user.id}
              teams={teams.data ?? []}
              onOpen={() => void navigate({ href: href(`settings/members-and-teams/members/${row.member.id}`) })}
              onManageTeams={() => setManaging(row.member)}
              onRole={(level) =>
                void run('update the role', () => setAccessLevel(workspace, row.member.id, level), 'Role updated')
              }
              onSuspend={() => setConfirm({ kind: 'suspend', member: row.member })}
              onReactivate={() =>
                void run('reactivate the user', () => reactivateMember(workspace, row.member.id), 'User reactivated')
              }
              onRemove={() => setConfirm({ kind: 'remove', member: row.member })}
            />
          ),
        )}
        {!pending && rows.length === 0 && <div className={os.tableEmpty}>No members match that filter</div>}
      </div>
      <InviteDialog isOpen={inviting} onOpenChange={setInviting} />
      <ManageTeamsDialog member={managing} onClose={() => setManaging(null)} />
      <AlertDialog
        isOpen={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.kind === 'suspend'
            ? 'Suspend user'
            : confirm?.kind === 'remove'
              ? 'Remove from workspace'
              : 'Revoke invite'
        }
        description={
          confirm?.kind === 'suspend'
            ? 'Are you sure you want to suspend this user?'
            : confirm?.kind === 'remove'
              ? 'The member loses access to the workspace and leaves every team. Their history stays.'
              : 'Are you sure you want to revoke this invite?'
        }
        confirmLabel={confirm?.kind === 'suspend' ? 'Suspend' : confirm?.kind === 'remove' ? 'Remove' : 'Revoke invite'}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (!c) return;
          if (c.kind === 'suspend')
            void run('suspend the user', () => suspendMember(workspace, c.member.id), 'User suspended');
          else if (c.kind === 'remove')
            void run('remove the member', () => removeMember(workspace, c.member.id), 'Member removed');
          else void run('revoke the invite', () => revokeInvite(workspace, c.invite.id), 'Invite revoked');
        }}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

function MemberRow({
  member,
  isSelf,
  teams,
  onOpen,
  onManageTeams,
  onRole,
  onSuspend,
  onReactivate,
  onRemove,
}: {
  member: MemberSummary;
  isSelf: boolean;
  teams: Team[];
  onOpen: () => void;
  onManageTeams: () => void;
  onRole: (level: 'admin' | 'member') => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`${os.row} ${m.membersGrid}`}
      role="row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className={os.cell} role="cell">
        <div className={m.userCell}>
          <MemberAvatar member={member} size={16} />
          <span className={m.userName}>{memberName(member)}</span>
          {isSelf && <span className={m.you}>(You)</span>}
          <span className={m.userEmail}>{member.emailAddress}</span>
        </div>
      </div>
      <div className={os.cell} role="cell">
        <RoleChip level={member.accessLevel} />
      </div>
      <div className={os.cell} role="cell">
        <TeamChips ids={member.teamIds} teams={teams} />
      </div>
      <div
        className={os.rowActions}
        role="cell"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="Options" variant="ghost" size={28} />
          <Menu aria-label="Member options" placement="bottom end" width={240}>
            <MenuItem
              icon="people"
              onAction={onManageTeams}
              trailing={<span className={a.muted}>{member.teamIds.length}</span>}
            >
              Manage teams
            </MenuItem>
            {!isSelf && member.accessLevel === 'admin' && (
              <MenuItem icon="user" onAction={() => onRole('member')}>
                Make workspace member
              </MenuItem>
            )}
            {!isSelf && member.accessLevel === 'member' && (
              <MenuItem icon="lock" onAction={() => onRole('admin')}>
                Make workspace admin
              </MenuItem>
            )}
            {!isSelf && member.accessLevel === 'suspended' && (
              <MenuItem icon="refresh" onAction={onReactivate}>
                Reactivate user
              </MenuItem>
            )}
            {!isSelf && member.accessLevel !== 'suspended' && (
              <MenuItem icon="hide" onAction={onSuspend}>
                Suspend from workspace
              </MenuItem>
            )}
            {!isSelf && (
              <MenuItem icon="delete" variant="danger" onAction={onRemove}>
                Remove from workspace
              </MenuItem>
            )}
          </Menu>
        </MenuTrigger>
      </div>
    </div>
  );
}
