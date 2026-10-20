// Member detail `/settings/members-and-teams/members/$memberId` (J workspace-admin §3.3, raw s72): avatar, name, role pill,
// email and a ⋮ menu; the Teams section ("See all teams this user belongs to": Name · Added at, "Add to team", row ⋮
// "Remove from team"). Connected accounts, Ask AI usage and sessions arrive with their slices.
import type { MemberDetail } from '@agentic-crm/contracts';
import { AlertDialog, Button, EmptyState, Icon, IconButton, Menu, MenuItem, MenuTrigger, toast } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Link } from 'react-aria-components';
import { errorEnvelopeOf } from '../../../data/trpc';
import { ContentSpinner } from '../../shell/AppShell';
import { useWorkspace } from '../../shell/workspaceContext';
import * as a from '../admin/admin.css';
import { MemberAvatar, memberName, PlainPage } from '../admin/parts';
import * as os from '../objects/objects.css';
import { addTeamMembers, removeTeamMembers, useTeams } from '../teams/data';
import { TeamTile } from '../teams/parts';
import { formatAddedAt } from '../teams/TeamPage';
import * as t from '../teams/teams.css';
import { reactivateMember, removeMember, setAccessLevel, suspendMember, useMemberDetail } from './data';
import { RoleChip } from './MembersTab';
import * as m from './members.css';

export function MemberDetailPage({ memberId }: { memberId: string }) {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const membersHref = href('settings/members-and-teams/members');
  const query = useMemberDetail(workspace, memberId);
  const member = query.data;
  const isSelf = member ? member.id === workspace.membership.id : false;

  const crumbs = [
    { label: 'Members and teams', icon: 'people' as const, href: href('settings/members-and-teams/members') },
    { label: 'Members', href: membersHref },
    ...(member ? [{ label: memberName(member) }] : []),
  ];

  let body: React.ReactNode;
  if (query.isPending) body = <ContentSpinner />;
  else if (!member || member.removedAt)
    body = (
      <EmptyState
        icon="user"
        title="Member not found"
        description="This member does not exist or has been removed."
        style={{ padding: '72px 24px' }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void navigate({ href: membersHref })}>
            Back to members
          </Button>
        }
      />
    );
  else
    body = (
      <>
        <Link href={membersHref} className={os.backLink}>
          <Icon icon="chevronLeft" size={14} />
          Back
        </Link>
        <div className={m.detailHeader}>
          <MemberAvatar member={member} size={56} />
          <div className={os.objectHeaderText} style={{ flex: 1 }}>
            <div className={m.detailNameRow}>
              <h1 className={os.objectTitle}>{memberName(member)}</h1>
              <RoleChip level={member.accessLevel} />
            </div>
            <p className={m.detailEmail}>{member.emailAddress}</p>
          </div>
          {!isSelf && <MemberActions member={member} onRemoved={() => void navigate({ href: membersHref })} />}
        </div>
        <div className={m.detailSections}>
          <TeamsSection member={member} />
        </div>
      </>
    );

  return (
    <PlainPage crumbs={crumbs} documentTitle={member ? `${memberName(member)} · Members` : 'Members'}>
      {body}
    </PlainPage>
  );
}

function MemberActions({ member, onRemoved }: { member: MemberDetail; onRemoved: () => void }) {
  const { workspace } = useWorkspace();
  const [confirm, setConfirm] = useState<'suspend' | 'remove' | null>(null);
  const run = async (label: string, action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      toast.success(done);
    } catch (e) {
      toast.error({ title: `Failed to ${label}`, description: errorEnvelopeOf(e).message });
    }
  };
  return (
    <>
      <MenuTrigger>
        <IconButton icon="moreVertical" aria-label="Options" variant="secondary" size={28} />
        <Menu aria-label="Member options" placement="bottom end" width={240}>
          {member.accessLevel === 'admin' && (
            <MenuItem
              icon="user"
              onAction={() =>
                void run('update the role', () => setAccessLevel(workspace, member.id, 'member'), 'Role updated')
              }
            >
              Make workspace member
            </MenuItem>
          )}
          {member.accessLevel === 'member' && (
            <MenuItem
              icon="lock"
              onAction={() =>
                void run('update the role', () => setAccessLevel(workspace, member.id, 'admin'), 'Role updated')
              }
            >
              Make workspace admin
            </MenuItem>
          )}
          {member.accessLevel === 'suspended' ? (
            <MenuItem
              icon="refresh"
              onAction={() =>
                void run('reactivate the user', () => reactivateMember(workspace, member.id), 'User reactivated')
              }
            >
              Reactivate user
            </MenuItem>
          ) : (
            <MenuItem icon="hide" onAction={() => setConfirm('suspend')}>
              Suspend from workspace
            </MenuItem>
          )}
          <MenuItem icon="delete" variant="danger" onAction={() => setConfirm('remove')}>
            Remove from workspace
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <AlertDialog
        isOpen={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'suspend' ? 'Suspend user' : 'Remove from workspace'}
        description={
          confirm === 'suspend'
            ? 'Are you sure you want to suspend this user?'
            : 'The member loses access to the workspace and leaves every team. Their history stays.'
        }
        confirmLabel={confirm === 'suspend' ? 'Suspend' : 'Remove'}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c === 'suspend')
            void run('suspend the user', () => suspendMember(workspace, member.id), 'User suspended');
          if (c === 'remove')
            void run('remove the member', () => removeMember(workspace, member.id), 'Member removed').then(onRemoved);
        }}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

function TeamsSection({ member }: { member: MemberDetail }) {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const teams = useTeams(workspace);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const joined = new Set(member.teams.map((x) => x.teamId));
  const available = (teams.data ?? []).filter((x) => !joined.has(x.id));
  const [picked, setPicked] = useState<Set<string>>(new Set());

  return (
    <section className={os.section} aria-label="Teams">
      <div className={os.sectionHeader}>
        <div>
          <h2 className={os.sectionTitle}>Teams</h2>
          <p className={os.sectionDescription}>See all teams this user belongs to</p>
        </div>
        <Button variant="primary" size={28} icon="invite" onPress={() => setAdding(true)}>
          Add to team
        </Button>
      </div>
      {member.teams.length === 0 ? (
        <EmptyState
          icon="people"
          title="No teams"
          description="This user is not in any team"
          style={{ padding: '32px 24px' }}
        />
      ) : (
        <div className={os.table} role="table" aria-label="Teams">
          <div className={`${os.tableHeader} ${t.teamMembersGrid}`} role="row">
            <div className={os.headerCell} role="columnheader">
              <Icon icon="people" size={14} className={os.headerIcon} />
              Name
            </div>
            <div className={os.headerCell} role="columnheader">
              <Icon icon="calendar" size={14} className={os.headerIcon} />
              Added at
            </div>
            <div role="columnheader" aria-label="Actions" />
          </div>
          {member.teams.map((row) => {
            const team = teams.data?.find((x) => x.id === row.teamId);
            return (
              <div
                key={row.teamId}
                className={`${os.row} ${t.teamMembersGrid}`}
                role="row"
                tabIndex={0}
                onClick={() =>
                  void navigate({ href: href(`settings/members-and-teams/teams/${row.teamId}/configuration`) })
                }
              >
                <div className={os.cell} role="cell">
                  <div className={t.nameCell}>
                    <TeamTile icon={team?.icon} size={16} />
                    <span className={os.cellText}>{row.name}</span>
                  </div>
                </div>
                <div className={os.cell} role="cell">
                  {formatAddedAt(row.addedAt)}
                </div>
                <div
                  className={os.rowActions}
                  role="cell"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <MenuTrigger>
                    <IconButton icon="moreVertical" aria-label="Options" variant="ghost" size={28} />
                    <Menu aria-label="Team options" placement="bottom end" width={180}>
                      <MenuItem icon="remove" onAction={() => setRemoving(row.teamId)}>
                        Remove from team
                      </MenuItem>
                    </Menu>
                  </MenuTrigger>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <AlertDialog
        isOpen={adding && available.length === 0}
        onOpenChange={(o) => !o && setAdding(false)}
        title="Add to team"
        variant="primary"
        description="This user is already in every team in the workspace"
        confirmLabel="Got it"
        cancelLabel="Close"
        onConfirm={() => setAdding(false)}
        onCancel={() => setAdding(false)}
      />
      <AddToTeamDialog
        isOpen={adding && available.length > 0}
        onClose={() => {
          setAdding(false);
          setPicked(new Set());
        }}
        teams={available}
        picked={picked}
        setPicked={setPicked}
        onConfirm={async () => {
          try {
            for (const id of picked) await addTeamMembers(workspace, id, [member.id]);
          } catch (e) {
            toast.error({ title: 'Failed to add to team', description: errorEnvelopeOf(e).message });
          }
        }}
      />
      <AlertDialog
        isOpen={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove from team"
        description="Are you sure you want to remove this member from the team?"
        confirmLabel="Remove"
        onConfirm={() => {
          const id = removing;
          setRemoving(null);
          if (id)
            void removeTeamMembers(workspace, id, [member.id]).catch((e) =>
              toast.error({ title: 'Failed to remove from team', description: errorEnvelopeOf(e).message }),
            );
        }}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}

import type { Team } from '@agentic-crm/contracts';
import { Checkbox, DialogBody, DialogFooter, DialogHeader, Modal } from '@agentic-crm/ui';

function AddToTeamDialog({
  isOpen,
  onClose,
  teams,
  picked,
  setPicked,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  teams: Team[];
  picked: Set<string>;
  setPicked: (next: Set<string>) => void;
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Modal isOpen={isOpen} onOpenChange={(o) => !o && onClose()} size="small" aria-label="Add to team" overlay>
      <DialogHeader title="Add to team" onClose={onClose} />
      <DialogBody className={a.dialogBody}>
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 280, overflowY: 'auto' }}>
          {teams.map((team) => (
            <label key={team.id} className={a.checkRow}>
              <Checkbox
                aria-label={team.name}
                isSelected={picked.has(team.id)}
                onChange={(on) => {
                  const next = new Set(picked);
                  if (on) next.add(team.id);
                  else next.delete(team.id);
                  setPicked(next);
                }}
              />
              <TeamTile icon={team.icon} size={16} />
              <span className={a.rowName}>{team.name}</span>
            </label>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" size={28} shortcut={['esc']} onPress={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size={28}
          shortcut={['mod', 'enter']}
          isDisabled={picked.size === 0}
          isPending={pending}
          onPress={() => {
            setPending(true);
            void onConfirm().finally(() => {
              setPending(false);
              onClose();
            });
          }}
        >
          Confirm
        </Button>
      </DialogFooter>
    </Modal>
  );
}
