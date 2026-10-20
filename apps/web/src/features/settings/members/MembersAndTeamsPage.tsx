// Settings → Members and teams (J workspace-admin §3; admin only): the page header with its Members | Teams tabs
// (evidence/J/teams-list.png). Non-admins get the read-only members page instead (§4).
import type { MemberSummary } from '@agentic-crm/contracts';
import { Button, EmptyState, ErrorState, Icon, SearchField, Skeleton } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useWorkspace } from '../../shell/workspaceContext';
import * as a from '../admin/admin.css';
import { MemberAvatar, memberName, TabsPage } from '../admin/parts';
import * as os from '../objects/objects.css';
import { SettingsPage } from '../SettingsPage';
import { findSettingsEntry } from '../settingsNav';
import { useTeams } from '../teams/data';
import { TeamsTab } from '../teams/TeamsTab';
import { useMembersList } from './data';
import { MembersTab, RoleChip, TeamChips } from './MembersTab';
import * as m from './members.css';

export type MembersTabId = 'members' | 'teams';

export function MembersAndTeamsPage({ tab }: { tab: MembersTabId }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  return (
    <TabsPage<MembersTabId>
      crumbs={[{ label: 'Members and teams', icon: 'people' }]}
      title="Members and teams"
      description="Manage workspace members and teams, set access levels, and invite new users."
      tabs={[
        { id: 'members', label: 'Members', icon: 'user' },
        { id: 'teams', label: 'Teams', icon: 'people' },
      ]}
      tab={tab}
      onTab={(next) => void navigate({ href: href(`settings/members-and-teams/${next}`) })}
    >
      {tab === 'members' ? <MembersTab /> : <TeamsTab />}
    </TabsPage>
  );
}

/** `/settings/members-read-only` (non-admins): "View workspace members and access levels" — the list without actions. */
export function MembersReadOnlyPage() {
  const entry = findSettingsEntry('members-read-only');
  const { workspace, me } = useWorkspace();
  const members = useMembersList(workspace);
  const teams = useTeams(workspace);
  const [query, setQuery] = useState('');
  if (!entry) return null;
  const q = query.trim().toLowerCase();
  const rows: MemberSummary[] = (members.data ?? []).filter(
    (member) => !q || memberName(member).toLowerCase().includes(q) || member.emailAddress.toLowerCase().includes(q),
  );
  return (
    <SettingsPage entry={entry}>
      {members.isError ? (
        <ErrorState
          message="Failed to load members"
          style={{ padding: 48 }}
          actions={
            <Button variant="secondary" size={28} onPress={() => void members.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <div className={a.toolbar} style={{ marginBottom: 0 }}>
            <SearchField
              aria-label="Search name or email"
              placeholder="Search name or email"
              size={32}
              value={query}
              onChange={setQuery}
              className={a.toolbarGrow}
            />
          </div>
          <div className={os.table} role="table" aria-label="Members">
            <div className={`${os.tableHeader} ${m.readOnlyGrid}`} role="row">
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
            </div>
            {members.isPending &&
              [0, 1, 2].map((i) => (
                <div key={i} className={`${os.row} ${m.readOnlyGrid}`} data-static role="row">
                  <Skeleton shape="text" width={160} />
                  <Skeleton shape="text" width={50} />
                  <Skeleton shape="text" width={60} />
                </div>
              ))}
            {rows.map((member) => (
              <div key={member.id} className={`${os.row} ${m.readOnlyGrid}`} data-static role="row">
                <div className={os.cell} role="cell">
                  <div className={m.userCell}>
                    <MemberAvatar member={member} size={16} />
                    <span className={m.userName}>{memberName(member)}</span>
                    {member.userId === me.user.id && <span className={m.you}>(You)</span>}
                    <span className={m.userEmail}>{member.emailAddress}</span>
                  </div>
                </div>
                <div className={os.cell} role="cell">
                  <RoleChip level={member.accessLevel} />
                </div>
                <div className={os.cell} role="cell">
                  <TeamChips ids={member.teamIds} teams={teams.data ?? []} />
                </div>
              </div>
            ))}
            {members.data && rows.length === 0 && (
              <EmptyState title="No members match that search" style={{ padding: '24px 16px' }} />
            )}
          </div>
        </>
      )}
    </SettingsPage>
  );
}
