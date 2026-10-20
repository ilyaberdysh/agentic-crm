// Members and teams → Teams (J permissions §6; evidence/J/teams-list.png): search + "New team", the teams table
// (Team · Members · Usage · ⋮ Copy team ID / Delete team), the empty state ("No teams — Keep your workspace organized
// with teams"), the "New team" dialog and the delete confirmation that lists what the team is used by.
import type { Team, TeamDetail, TeamIcon } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  SearchField,
  Skeleton,
  TextInput,
  toast,
} from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { errorEnvelopeOf } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { useWorkspace } from '../../shell/workspaceContext';
import * as a from '../admin/admin.css';
import * as os from '../objects/objects.css';
import { copyToClipboard, submitOnModEnter } from '../objects/parts';
import { createTeam, deleteTeam, randomTeamIcon, teamQuery, useTeams } from './data';
import { TeamIconPicker, TeamTile } from './parts';
import * as t from './teams.css';

export function TeamsTab() {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const teams = useTeams(workspace);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Team | null>(null);
  const q = query.trim().toLowerCase();
  const visible = (teams.data ?? []).filter((team) => !q || team.name.toLowerCase().includes(q));
  const open = (team: Team) =>
    void navigate({ href: href(`settings/members-and-teams/teams/${team.id}/configuration`) });

  if (teams.isError)
    return (
      <ErrorState
        message="Failed to load teams"
        style={{ padding: 48 }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void teams.refetch()}>
            Retry
          </Button>
        }
      />
    );

  if (teams.data && teams.data.length === 0) {
    return (
      <>
        <EmptyState
          icon="people"
          iconSize={40}
          title="No teams"
          description="Keep your workspace organized with teams"
          style={{ padding: '56px 24px' }}
          actions={
            <Button variant="primary" size={28} icon="add" onPress={() => setCreating(true)}>
              Create first team
            </Button>
          }
        />
        <NewTeamDialog isOpen={creating} onOpenChange={setCreating} />
      </>
    );
  }

  return (
    <>
      <div className={a.toolbar}>
        <SearchField
          aria-label="Search teams"
          placeholder="Search"
          size={32}
          value={query}
          onChange={setQuery}
          className={a.toolbarGrow}
        />
        <Button variant="primary" size={32} icon="add" onPress={() => setCreating(true)}>
          New team
        </Button>
      </div>
      <div className={os.table} role="table" aria-label="Teams">
        <div className={`${os.tableHeader} ${t.teamsGrid} ${t.teamsHeader}`} role="row">
          <div className={os.headerCell} role="columnheader">
            <Icon icon="people" size={14} className={os.headerIcon} />
            Team
          </div>
          <div className={os.headerCell} role="columnheader">
            <Icon icon="user" size={14} className={os.headerIcon} />
            Members
          </div>
          <div className={os.headerCell} role="columnheader">
            <Icon icon="link" size={14} className={os.headerIcon} />
            Usage
          </div>
          <div role="columnheader" aria-label="Actions" />
        </div>
        {teams.isPending &&
          [0, 1].map((i) => (
            <div key={i} className={`${os.row} ${t.teamsGrid}`} data-static role="row">
              <Skeleton shape="text" width={140} />
              <Skeleton shape="text" width={24} />
              <Skeleton shape="text" width={24} />
            </div>
          ))}
        {visible.map((team) => (
          <div
            key={team.id}
            className={`${os.row} ${t.teamsGrid}`}
            role="row"
            tabIndex={0}
            onClick={() => open(team)}
            onKeyDown={(e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                open(team);
              }
            }}
          >
            <div className={os.cell} role="cell">
              <div className={t.nameCell}>
                <TeamTile icon={team.icon} size={16} />
                <span className={os.cellText}>{team.name}</span>
              </div>
            </div>
            <div className={os.cell} role="cell">
              {team.memberCount}
            </div>
            <div className={os.cell} role="cell">
              {team.usageCount > 0 ? team.usageCount : null}
            </div>
            <div
              className={os.rowActions}
              role="cell"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <MenuTrigger>
                <IconButton icon="moreVertical" aria-label="Options" variant="ghost" size={28} />
                <Menu aria-label="Team options" placement="bottom end" width={160}>
                  <MenuItem
                    icon="copy"
                    onAction={() => void copyToClipboard(team.id, (title) => toast(title, { icon: 'copy' }))}
                  >
                    Copy team ID
                  </MenuItem>
                  <MenuItem icon="delete" variant="danger" onAction={() => setDeleting(team)}>
                    Delete team
                  </MenuItem>
                </Menu>
              </MenuTrigger>
            </div>
          </div>
        ))}
        {teams.data && visible.length === 0 && <div className={os.tableEmpty}>No teams match that search</div>}
      </div>
      <NewTeamDialog isOpen={creating} onOpenChange={setCreating} />
      <DeleteTeamDialog team={deleting} onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />
    </>
  );
}

// ---- New team -------------------------------------------------------------------------------------------------

export function NewTeamDialog({
  isOpen,
  onOpenChange,
  onCreated,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (team: Team) => void;
}) {
  const { workspace } = useWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState<TeamIcon>(() => randomTeamIcon());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [id, setId] = useState(newId);

  const close = () => {
    onOpenChange(false);
    setName('');
    setDescription('');
    setError(null);
    setIcon(randomTeamIcon());
    setId(newId());
  };

  async function submit() {
    if (!name.trim()) {
      setError('Please provide a name for the team.');
      return;
    }
    setPending(true);
    try {
      const team = await createTeam(workspace, { id, name: name.trim(), description: description.trim(), icon });
      close();
      onCreated?.(team);
    } catch (e) {
      setError(errorEnvelopeOf(e).message ?? 'Failed to create team');
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(o) => (o ? onOpenChange(true) : close())}
      size={708}
      aria-label="New team"
      overlay
    >
      <DialogHeader title="New team" onClose={close} />
      <DialogBody className={a.formDialogBody}>
        <div className={a.formGrid} onKeyDown={submitOnModEnter(() => void submit())}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <TeamIconPicker value={icon} onChange={setIcon} />
            <TextInput
              label="Team name"
              size={32}
              autoFocus
              value={name}
              onChange={(v) => {
                setName(v);
                setError(null);
              }}
              isInvalid={Boolean(error)}
              errorMessage={error ?? undefined}
              style={{ flex: 1 }}
            />
          </div>
          <TextInput
            label="Team description"
            placeholder="Enter team description"
            size={32}
            value={description}
            onChange={setDescription}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" size={28} shortcut={['esc']} onPress={close}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size={28}
          shortcut={['mod', 'enter']}
          isPending={pending}
          onPress={() => void submit()}
        >
          Confirm
        </Button>
      </DialogFooter>
    </Modal>
  );
}

// ---- Delete team -----------------------------------------------------------------------------------------------

const USAGE_LABEL: Record<TeamDetail['usage'][number]['type'], [string, string]> = {
  'object-permission': ['object permission', 'object permissions'],
  'list-permission': ['list permission', 'list permissions'],
  'dashboard-permission': ['dashboard permission', 'dashboard permissions'],
  'workflow-permission': ['workflow permission', 'workflow permissions'],
  'sequence-permission': ['sequence permission', 'sequence permissions'],
};

export function usageSummary(usage: TeamDetail['usage']): string[] {
  const counts = new Map<string, number>();
  for (const u of usage) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
  return [...counts.entries()].map(([type, n]) => {
    const [one, many] = USAGE_LABEL[type as keyof typeof USAGE_LABEL];
    return `${n} ${n === 1 ? one : many}`;
  });
}

export function DeleteTeamDialog({
  team,
  onClose,
  onDeleted,
}: {
  team: { id: string; name: string } | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { workspace } = useWorkspace();
  const detail = useQuery({ ...teamQuery(workspace, team?.id ?? ''), enabled: Boolean(team) });
  const usage = detail.data ? usageSummary(detail.data.usage) : detail.isError ? [] : null;
  return (
    <AlertDialog
      isOpen={team !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Delete team"
      description="Deleting a team is permanent and cannot be undone"
      confirmLabel="Permanently delete team"
      onConfirm={() => {
        if (!team) return;
        void deleteTeam(workspace, team.id)
          .then(() => {
            toast.success(`${team.name} was deleted`);
            onDeleted();
          })
          .catch((e) => toast.error({ title: 'Failed to delete team', description: errorEnvelopeOf(e).message }));
      }}
      onCancel={onClose}
    >
      <div style={{ marginTop: 8 }}>
        {usage === null ? (
          <Skeleton shape="text" width={160} />
        ) : usage.length === 0 ? (
          'This team is not used anywhere'
        ) : (
          <>
            The following will be affected:
            <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
              {usage.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </AlertDialog>
  );
}
