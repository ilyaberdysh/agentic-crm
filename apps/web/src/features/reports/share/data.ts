// Dashboard grants and their member or team targets: one cached list per
// dashboard under ['ws', ws, 'reporting-dashboard', <id>, 'permissions'] (realtime `reporting-dashboard` refreshes it),
// level changes / additions / removals that show at once and are confirmed by the server's answer, and the member and
// team pickers. Used by the Share popover and by Settings → Dashboards → Permissions.
import type { AccessScope } from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { keys } from '../../../data/keys';
import { queryClient } from '../../../data/queryClient';
import { api, errorEnvelopeOf, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../../data/trpc';
import { permissionsKey, useWs } from '../data';
import { type Grants, type GrantTarget, type MemberOption, type TeamOption, withGrant, withoutGrant } from './grants';

export const grantsQuery = (ws: WorkspaceRef, dashboardId: string) =>
  queryOptions({
    queryKey: permissionsKey(ws.id, dashboardId),
    queryFn: (): Promise<Grants> =>
      api.permissions.list.query(
        { resourceKind: 'dashboard', resourceId: dashboardId },
        inWorkspace(ws),
      ) as Promise<Grants>,
  });

export function useGrants(dashboardId: string, enabled = true) {
  const ws = useWs();
  return useQuery({ ...grantsQuery(ws, dashboardId), enabled });
}

// ---- pickers ---------------------------------------------------------------------------------------------------------

const memberOptionsQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: [...keys.members(ws.id), 'grant-targets'] as const,
    queryFn: async (): Promise<MemberOption[]> => {
      const members = await api.members.list.query({ includeRemoved: false }, inWorkspace(ws));
      return members
        .filter((m) => m.accessLevel !== 'suspended' && !m.removedAt)
        .map((m) => ({
          id: m.id,
          name: [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.emailAddress,
          email: m.emailAddress,
        }));
    },
    staleTime: 30_000,
  });

const teamOptionsQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: [...keys.resource(ws.id, 'workspace-team-list'), 'grant-targets'] as const,
    queryFn: async (): Promise<TeamOption[]> =>
      (await api.teams.list.query(undefined, inWorkspace(ws))).map((t) => ({
        id: t.id,
        name: t.name,
        memberCount: t.memberCount,
      })),
    staleTime: 15_000,
  });

/** Active members (not suspended or removed) a grant can name. */
export function useMemberOptions(enabled = true) {
  const ws = useWs();
  return useQuery({ ...memberOptionsQuery(ws), enabled });
}

export function useTeamOptions(enabled = true) {
  const ws = useWs();
  return useQuery({ ...teamOptionsQuery(ws), enabled });
}

/** Members and teams together with their loading state (the Share popover's search). */
export function useGrantTargets(enabled = true) {
  const members = useMemberOptions(enabled);
  const teams = useTeamOptions(enabled);
  return useMemo(
    () => ({
      members: members.data ?? [],
      teams: teams.data ?? [],
      isPending: members.isPending || teams.isPending,
    }),
    [members.data, members.isPending, teams.data, teams.isPending],
  );
}

// ---- writes ----------------------------------------------------------------------------------------------------------

function settle(ws: WorkspaceRef, dashboardId: string): void {
  // Grants, and the dashboard's own detail (the viewer's access may have changed with them).
  void queryClient.invalidateQueries({ queryKey: [...keys.resource(ws.id, 'reporting-dashboard'), dashboardId] });
  void queryClient.invalidateQueries({ queryKey: keys.resource(ws.id, 'reporting-dashboard-list') });
}

async function writeGrants(
  ws: WorkspaceRef,
  dashboardId: string,
  update: (prev: Grants) => Grants,
  write: () => Promise<{ seq: string | null }>,
  failure: string,
): Promise<boolean> {
  const key = permissionsKey(ws.id, dashboardId);
  await queryClient.cancelQueries({ queryKey: key });
  const before = queryClient.getQueryData<Grants>(key);
  if (before) queryClient.setQueryData<Grants>(key, update(before));
  try {
    const { seq } = await write();
    noteAcceptAfter(ws.id, seq);
    return true;
  } catch (error) {
    if (before) queryClient.setQueryData(key, before);
    toast.error({ title: failure, description: errorEnvelopeOf(error).message });
    return false;
  } finally {
    settle(ws, dashboardId);
  }
}

/** Sets the level of the workspace, a team or a member (creates the grant for a new target). Immediate, no Save. */
export function setGrantLevel(
  ws: WorkspaceRef,
  dashboardId: string,
  target: GrantTarget,
  level: AccessScope,
  label?: { name: string; detail: string | null },
): Promise<boolean> {
  return writeGrants(
    ws,
    dashboardId,
    (prev) => withGrant(prev, target, level, label),
    async () => {
      const { seq } = await api.permissions.put.mutate(
        { resourceKind: 'dashboard', resourceId: dashboardId, target, level },
        inWorkspace(ws),
      );
      return { seq };
    },
    'Failed to update access',
  );
}

/** "Remove team-level override" / "Remove member-level override". */
export function removeGrant(ws: WorkspaceRef, dashboardId: string, target: GrantTarget): Promise<boolean> {
  return writeGrants(
    ws,
    dashboardId,
    (prev) => withoutGrant(prev, target),
    async () => {
      const { seq } = await api.permissions.remove.mutate(
        { resourceKind: 'dashboard', resourceId: dashboardId, target },
        inWorkspace(ws),
      );
      return { seq };
    },
    'Failed to remove access',
  );
}
