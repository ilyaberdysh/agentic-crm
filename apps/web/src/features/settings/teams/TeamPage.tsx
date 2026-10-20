// Team page `/settings/members-and-teams/teams/$teamId/{configuration|members|usage}` (J permissions §6; raw s54, s55):
// header with the team tile, name and "Manage team members and other relevant settings"; tabs Configuration (name,
// description, danger zone), Members <n> (table with "Added at", Add members, Remove from team) and Usage <n> (where the
// team is referenced).
import type { TeamDetail } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  toast,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Link } from 'react-aria-components';
import { errorEnvelopeOf } from '../../../data/trpc';
import { ContentSpinner } from '../../shell/AppShell';
import { useWorkspace } from '../../shell/workspaceContext';
import * as a from '../admin/admin.css';
import { AutosaveInput, MemberAvatar, memberName, PlainPage } from '../admin/parts';
import { useMembersList } from '../members/data';
import * as os from '../objects/objects.css';
import { addTeamMembers, removeTeamMembers, updateTeam, useTeam } from './data';
import { MemberPickerDialog, TeamIconPicker, TeamTile } from './parts';
import { DeleteTeamDialog } from './TeamsTab';
import * as t from './teams.css';

export type TeamTabId = 'configuration' | 'members' | 'usage';
export const TEAM_TAB_IDS: TeamTabId[] = ['configuration', 'members', 'usage'];

const ORDINALS = ['th', 'st', 'nd', 'rd'];
/** "9th Oct 2026" (member detail and team member tables, J workspace-admin §3.3). */
export function formatAddedAt(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const v = day % 100;
  const suffix = ORDINALS[(v - 20) % 10] ?? ORDINALS[v] ?? ORDINALS[0];
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${day}${suffix} ${month} ${d.getFullYear()}`;
}

const USAGE_TYPE: Record<TeamDetail['usage'][number]['type'], string> = {
  'object-permission': 'Object permission',
  'list-permission': 'List permission',
  'dashboard-permission': 'Dashboard permission',
  'workflow-permission': 'Workflow permission',
  'sequence-permission': 'Sequence permission',
};

export function TeamPage({ teamId, tab }: { teamId: string; tab: TeamTabId }) {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const teamsHref = href('settings/members-and-teams/teams');
  const team = useTeam(workspace, teamId);
  const detail = team.data;

  const crumbs = [
    { label: 'Members and teams', icon: 'people' as const, href: href('settings/members-and-teams/members') },
    { label: 'Teams', href: teamsHref },
    ...(detail ? [{ label: detail.name, icon: <TeamTile icon={detail.icon} size={16} /> }] : []),
  ];

  let body: React.ReactNode;
  if (team.isPending) body = <ContentSpinner />;
  else if (!detail)
    body = (
      <EmptyState
        icon="people"
        title="Team not found"
        description="This team does not exist or has been deleted."
        style={{ padding: '72px 24px' }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void navigate({ href: teamsHref })}>
            Back to teams
          </Button>
        }
      />
    );
  else
    body = (
      <>
        <Link href={teamsHref} className={os.backLink}>
          <Icon icon="chevronLeft" size={14} />
          Back
        </Link>
        <div className={os.objectHeader}>
          <TeamTile icon={detail.icon} size={56} />
          <div className={os.objectHeaderText}>
            <h1 className={os.objectTitle}>{detail.name}</h1>
            <p className={os.pageDescription}>Manage team members and other relevant settings</p>
          </div>
        </div>
        <Tabs
          selectedKey={tab}
          onSelectionChange={(k) => void navigate({ href: `${teamsHref}/${teamId}/${String(k)}` })}
          className={os.tabs}
        >
          <div className={os.tabRow}>
            <TabList aria-label="Team">
              <Tab id="configuration" icon="settings">
                Configuration
              </Tab>
              <Tab id="members" icon="user" count={detail.memberCount}>
                Members
              </Tab>
              <Tab id="usage" icon="link" count={detail.usage.length}>
                Usage
              </Tab>
            </TabList>
          </div>
          <TabPanel id={tab} className={os.tabPanel}>
            {tab === 'configuration' && (
              <ConfigurationTab team={detail} onDeleted={() => void navigate({ href: teamsHref })} />
            )}
            {tab === 'members' && <MembersTab team={detail} />}
            {tab === 'usage' && <UsageTab team={detail} />}
          </TabPanel>
        </Tabs>
      </>
    );

  return (
    <PlainPage crumbs={crumbs} documentTitle={detail ? `${detail.name} · Teams` : 'Teams'}>
      {body}
    </PlainPage>
  );
}

function ConfigurationTab({ team, onDeleted }: { team: TeamDetail; onDeleted: () => void }) {
  const { workspace } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const patch = async (input: Parameters<typeof updateTeam>[1], label: string) => {
    try {
      await updateTeam(workspace, input);
    } catch (e) {
      toast.error({ title: `Failed to update ${label}`, description: errorEnvelopeOf(e).message });
    }
  };
  return (
    <div className={os.sections}>
      <section className={os.section} aria-label="General">
        <div>
          <h2 className={os.sectionTitle}>General</h2>
          <p className={os.sectionDescription}>Define the name and description for this team</p>
        </div>
        <div className={os.fieldGrid}>
          <div className={os.nounRow}>
            <TeamIconPicker
              value={team.icon ?? { id: 'bookmark', color: 'purple' }}
              onChange={(icon) => void patch({ teamId: team.id, icon }, 'team icon')}
            />
            <AutosaveInput
              label="Team name"
              value={team.name}
              onSave={(name) => patch({ teamId: team.id, name }, 'team name')}
            />
          </div>
          <AutosaveInput
            label="Team description"
            value={team.description}
            allowEmpty
            placeholder="Enter team description"
            onSave={(description) => patch({ teamId: team.id, description }, 'team description')}
          />
        </div>
      </section>
      <section className={os.section} aria-label="Danger zone">
        <h2 className={os.sectionTitle}>Danger zone</h2>
        <div className={os.dangerCard}>
          <div>
            <h3 className={os.subTitle}>Delete team</h3>
            <p className={os.subDescription}>Once deleted, your team cannot be recovered.</p>
          </div>
          <Button variant="destructive" size={28} icon="delete" onPress={() => setConfirming(true)}>
            Delete team
          </Button>
        </div>
      </section>
      <DeleteTeamDialog
        team={confirming ? team : null}
        onClose={() => setConfirming(false)}
        onDeleted={() => {
          setConfirming(false);
          onDeleted();
        }}
      />
    </div>
  );
}

function MembersTab({ team }: { team: TeamDetail }) {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const members = useMembersList(workspace);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const all = members.data ?? [];
  const inTeam = new Set(team.members.map((m) => m.memberId));
  const rows = team.members
    .map((m) => ({ membership: m, member: all.find((x) => x.id === m.memberId) }))
    .filter((r): r is { membership: (typeof team.members)[number]; member: (typeof all)[number] } => Boolean(r.member));
  const candidates = all.filter((m) => !inTeam.has(m.id) && m.accessLevel !== 'suspended');

  const picker = (
    <MemberPickerDialog
      isOpen={adding}
      onOpenChange={setAdding}
      label="Invite to team"
      members={candidates}
      onConfirm={async (ids) => {
        try {
          await addTeamMembers(workspace, team.id, ids);
        } catch (e) {
          toast.error({ title: 'Failed to add members', description: errorEnvelopeOf(e).message });
          throw e;
        }
      }}
    />
  );

  if (rows.length === 0)
    return (
      <>
        <EmptyState
          icon="user"
          iconSize={40}
          title="No members"
          description="You have not added members to this team"
          style={{ padding: '56px 24px' }}
          actions={
            <Button variant="primary" size={28} icon="add" onPress={() => setAdding(true)}>
              Add members
            </Button>
          }
        />
        {picker}
      </>
    );

  return (
    <>
      <div className={a.toolbar} style={{ justifyContent: 'flex-end' }}>
        <Button variant="primary" size={32} icon="add" onPress={() => setAdding(true)}>
          Add members
        </Button>
      </div>
      <div className={os.table} role="table" aria-label="Team members">
        <div className={`${os.tableHeader} ${t.teamMembersGrid}`} role="row">
          <div className={os.headerCell} role="columnheader">
            <Icon icon="user" size={14} className={os.headerIcon} />
            User
          </div>
          <div className={os.headerCell} role="columnheader">
            <Icon icon="calendar" size={14} className={os.headerIcon} />
            Added at
          </div>
          <div role="columnheader" aria-label="Actions" />
        </div>
        {rows.map(({ membership, member }) => (
          <div
            key={membership.id}
            className={`${os.row} ${t.teamMembersGrid}`}
            role="row"
            tabIndex={0}
            onClick={() => void navigate({ href: href(`settings/members-and-teams/members/${member.id}`) })}
          >
            <div className={os.cell} role="cell">
              <div className={t.nameCell}>
                <MemberAvatar member={member} size={16} />
                <span className={os.cellText}>{memberName(member)}</span>
                <span className={a.muted}>{member.emailAddress}</span>
              </div>
            </div>
            <div className={os.cell} role="cell">
              {formatAddedAt(membership.createdAt)}
            </div>
            <div
              className={os.rowActions}
              role="cell"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <MenuTrigger>
                <IconButton icon="moreVertical" aria-label="Options" variant="ghost" size={28} />
                <Menu aria-label="Member options" placement="bottom end" width={180}>
                  <MenuItem icon="remove" onAction={() => setRemoving(member.id)}>
                    Remove from team
                  </MenuItem>
                </Menu>
              </MenuTrigger>
            </div>
          </div>
        ))}
      </div>
      {picker}
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
            void removeTeamMembers(workspace, team.id, [id]).catch((e) =>
              toast.error({ title: 'Failed to remove member', description: errorEnvelopeOf(e).message }),
            );
        }}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}

function UsageTab({ team }: { team: TeamDetail }) {
  if (team.usage.length === 0)
    return (
      <EmptyState
        icon="link"
        iconSize={40}
        title="No usage"
        description="This team is not used anywhere"
        style={{ padding: '56px 24px' }}
      />
    );
  return (
    <div className={os.table} role="table" aria-label="Team usage">
      <div className={`${os.tableHeader} ${t.usageGrid}`} role="row">
        <div className={os.headerCell} role="columnheader">
          <Icon icon="record" size={14} className={os.headerIcon} />
          Item
        </div>
        <div className={os.headerCell} role="columnheader">
          <Icon icon="table" size={14} className={os.headerIcon} />
          Type
        </div>
      </div>
      {team.usage.map((u) => (
        <div key={`${u.type}:${u.resourceId}`} className={`${os.row} ${t.usageGrid}`} data-static role="row">
          <div className={os.cell} role="cell">
            <span className={os.cellText}>{u.name ?? 'Unknown'}</span>
          </div>
          <div className={os.cell} role="cell">
            {USAGE_TYPE[u.type]}
          </div>
        </div>
      ))}
    </div>
  );
}
