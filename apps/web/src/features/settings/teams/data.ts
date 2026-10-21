// Teams data (BACKLOG 6.03; J permissions): `teams.*`. Reads are open to every member (pickers, member detail);
// create / update / delete / membership are admin writes. Team ids are client-minted (PUT-style).
import type { CreateTeamInput, Team, TeamDetail, UpdateTeamInput } from '@agentic-crm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../../data/keys';
import { queryClient } from '../../../data/queryClient';
import { api, inWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { written } from '../admin/parts';

export const teamsQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: keys.teams(ws.id),
    queryFn: async () => {
      const teams = (await api.teams.list.query(undefined, inWorkspace(ws))) as Team[];
      return teams;
    },
  });

export function useTeams(ws: WorkspaceRef, enabled = true) {
  return useQuery({ ...teamsQuery(ws), enabled });
}

export const teamQuery = (ws: WorkspaceRef, teamId: string) =>
  queryOptions({
    queryKey: keys.team(ws.id, teamId),
    queryFn: () => api.teams.get.query({ teamId }, inWorkspace(ws)) as Promise<TeamDetail>,
  });

export function useTeam(ws: WorkspaceRef, teamId: string) {
  return useQuery(teamQuery(ws, teamId));
}

/** Teams, members and grants all move together: refresh what a membership change touches. */
function refresh(ws: WorkspaceRef, teamId?: string) {
  void queryClient.invalidateQueries({ queryKey: keys.teams(ws.id) });
  if (teamId) void queryClient.invalidateQueries({ queryKey: keys.team(ws.id, teamId) });
  void queryClient.invalidateQueries({ queryKey: keys.members(ws.id) });
}

export async function createTeam(
  ws: WorkspaceRef,
  input: Omit<CreateTeamInput, 'id'> & { id?: string },
): Promise<Team> {
  const { team } = await written(ws, api.teams.create.mutate({ ...input, id: input.id ?? newId() }, inWorkspace(ws)));
  refresh(ws, team.id);
  return team as Team;
}

export async function updateTeam(ws: WorkspaceRef, input: UpdateTeamInput): Promise<Team> {
  const { team } = await written(ws, api.teams.update.mutate(input, inWorkspace(ws)));
  refresh(ws, input.teamId);
  return team as Team;
}

export async function deleteTeam(ws: WorkspaceRef, teamId: string) {
  const result = await written(ws, api.teams.delete.mutate({ teamId }, inWorkspace(ws)));
  refresh(ws);
  queryClient.removeQueries({ queryKey: keys.team(ws.id, teamId) });
  return result;
}

export async function addTeamMembers(ws: WorkspaceRef, teamId: string, memberIds: string[]) {
  if (memberIds.length === 0) return;
  await written(ws, api.teams.addMembers.mutate({ teamId, memberIds }, inWorkspace(ws)));
  refresh(ws, teamId);
}

export async function removeTeamMembers(ws: WorkspaceRef, teamId: string, memberIds: string[]) {
  if (memberIds.length === 0) return;
  await written(ws, api.teams.removeMembers.mutate({ teamId, memberIds }, inWorkspace(ws)));
  refresh(ws, teamId);
}

// ---- team icons ------------------------------------------------------------------------------------------------

/** The picker's icons and colours (the UI uses "random icon/colour preselected"); `icon.id` is one of the icon names. */
export const TEAM_ICONS = [
  'bookmark',
  'favorite',
  'target',
  'like',
  'teamFlag',
  'teamRocket',
  'teamShield',
  'teamLayers',
  'teamIdea',
  'teamGauge',
  'teamCase',
  'puzzle',
] as const;
export const TEAM_COLORS = ['purple', 'blue', 'green', 'orange', 'pink', 'cyan', 'red', 'yellow'] as const;

export function randomTeamIcon(): { id: string; color: string } {
  return {
    id: TEAM_ICONS[Math.floor(Math.random() * TEAM_ICONS.length)] as string,
    color: TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)] as string,
  };
}
