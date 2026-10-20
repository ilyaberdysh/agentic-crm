// Routes below `/$workspaceSlug/settings` owned by slice 6 (J README §1): Profile, Workspace general, Members and teams
// (members, member detail, teams, team page), the read-only members page, Developers and Security. The `_admin` route
// group redirects non-admins (to Profile; Members and teams to the read-only page); `_non-admin` redirects admins.
//
//   account                                       Profile
//   workspace                                     Workspace › General (admin)
//   members-and-teams[/members[/$memberId]]       Members and teams (admin; `/` → members)
//   members-and-teams/teams[/$teamId[/$tab]]      Teams, team page (configuration · members · usage)
//   members-read-only                             read-only members (non-admins)
//   developers[/access-tokens|/webhooks]          Developers (admin)
//   security                                      Security (admin)
import { type AnyRoute, createRoute, redirect } from '@tanstack/react-router';
import { DevelopersPage, type DevelopersTabId } from './developers/DevelopersPage';
import { MemberDetailPage } from './members/MemberDetailPage';
import { MembersAndTeamsPage, MembersReadOnlyPage } from './members/MembersAndTeamsPage';
import { ProfilePage } from './profile/ProfilePage';
import { SecurityPage } from './security/SecurityPage';
import { TEAM_TAB_IDS, TeamPage, type TeamTabId } from './teams/TeamPage';
import { WorkspaceGeneralPage } from './workspace/WorkspaceGeneralPage';

/** Paths (below `settings/`) of the pages this module serves; the placeholder generator skips them. */
export const ownedSettingsPaths = new Set([
  'account',
  'workspace',
  'members-and-teams',
  'members-read-only',
  'developers',
  'security',
]);

interface GuardContext {
  workspace: { slug: string; membership: { accessLevel: string } } | null;
}

function slugOf(context: GuardContext): string | null {
  return context.workspace?.slug ?? null;
}

function requireAdmin(context: GuardContext, fallback = 'account'): void {
  const slug = slugOf(context);
  if (!slug) return;
  if (context.workspace?.membership.accessLevel !== 'admin') {
    throw redirect({ href: `/${slug}/settings/${fallback}`, replace: true });
  }
}

function requireNonAdmin(context: GuardContext): void {
  const slug = slugOf(context);
  if (!slug) return;
  if (context.workspace?.membership.accessLevel === 'admin') {
    throw redirect({ href: `/${slug}/settings/account`, replace: true });
  }
}

/** Pass the settings route (`getParentRoute`). */
export function adminSettingsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const account = createRoute({ getParentRoute, path: 'account', component: ProfilePage });

  const workspace = createRoute({
    getParentRoute,
    path: 'workspace',
    beforeLoad: ({ context }) => requireAdmin(context as GuardContext),
    component: WorkspaceGeneralPage,
  });

  const membersIndex = createRoute({
    getParentRoute,
    path: 'members-and-teams',
    beforeLoad: ({ context, location }) => {
      requireAdmin(context as GuardContext, 'members-read-only');
      throw redirect({ href: `${location.pathname.replace(/\/$/, '')}/members`, replace: true });
    },
  });
  const members = createRoute({
    getParentRoute,
    path: 'members-and-teams/members',
    beforeLoad: ({ context }) => requireAdmin(context as GuardContext, 'members-read-only'),
    component: () => <MembersAndTeamsPage tab="members" />,
  });
  const memberDetail = createRoute({
    getParentRoute,
    path: 'members-and-teams/members/$memberId',
    beforeLoad: ({ context }) => requireAdmin(context as GuardContext, 'members-read-only'),
    component: function MemberRoute() {
      return <MemberDetailPage memberId={(memberDetail.useParams() as { memberId: string }).memberId} />;
    },
  });
  const teams = createRoute({
    getParentRoute,
    path: 'members-and-teams/teams',
    beforeLoad: ({ context }) => requireAdmin(context as GuardContext, 'members-read-only'),
    component: () => <MembersAndTeamsPage tab="teams" />,
  });
  const teamIndex = createRoute({
    getParentRoute,
    path: 'members-and-teams/teams/$teamId',
    beforeLoad: ({ context, location }) => {
      requireAdmin(context as GuardContext, 'members-read-only');
      throw redirect({ href: `${location.pathname.replace(/\/$/, '')}/configuration`, replace: true });
    },
  });
  const teamTab = createRoute({
    getParentRoute,
    path: 'members-and-teams/teams/$teamId/$tab',
    beforeLoad: ({ context, params, location }) => {
      requireAdmin(context as GuardContext, 'members-read-only');
      const { tab } = params as { tab: string };
      if (!(TEAM_TAB_IDS as string[]).includes(tab)) {
        const base = location.pathname.slice(0, location.pathname.lastIndexOf('/'));
        throw redirect({ href: `${base}/configuration`, replace: true });
      }
    },
    component: function TeamRoute() {
      const { teamId, tab } = teamTab.useParams() as { teamId: string; tab: TeamTabId };
      return <TeamPage teamId={teamId} tab={tab} />;
    },
  });

  const readOnly = createRoute({
    getParentRoute,
    path: 'members-read-only',
    beforeLoad: ({ context }) => requireNonAdmin(context as GuardContext),
    component: MembersReadOnlyPage,
  });

  const developersIndex = createRoute({
    getParentRoute,
    path: 'developers',
    beforeLoad: ({ context, location }) => {
      requireAdmin(context as GuardContext);
      throw redirect({ href: `${location.pathname.replace(/\/$/, '')}/access-tokens`, replace: true });
    },
  });
  const developersTab = createRoute({
    getParentRoute,
    path: 'developers/$tab',
    beforeLoad: ({ context, params, location }) => {
      requireAdmin(context as GuardContext);
      const { tab } = params as { tab: string };
      if (tab !== 'access-tokens' && tab !== 'webhooks') {
        const base = location.pathname.slice(0, location.pathname.lastIndexOf('/'));
        throw redirect({ href: `${base}/access-tokens`, replace: true });
      }
    },
    component: function DevelopersRoute() {
      return <DevelopersPage tab={(developersTab.useParams() as { tab: DevelopersTabId }).tab} />;
    },
  });

  const security = createRoute({
    getParentRoute,
    path: 'security',
    beforeLoad: ({ context }) => requireAdmin(context as GuardContext),
    component: SecurityPage,
  });

  return [
    account,
    workspace,
    membersIndex,
    members,
    memberDetail,
    teams,
    teamIndex,
    teamTab,
    readOnly,
    developersIndex,
    developersTab,
    security,
  ];
}
