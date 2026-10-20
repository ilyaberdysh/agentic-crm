// Members administration data (BACKLOG 6.03; J workspace-admin §3, J permissions §1): `members.*` and `invites.*`.
// The members table lists everyone but removed members; invites are admin-only. Role changes, suspend, reactivate and
// remove are admin writes (the domain checks the role again and keeps the last admin).
import type {
  AccessLevel,
  CreateInvitesInput,
  MemberDetail,
  MemberSummary,
  WorkspaceInvite,
} from '@agentic-crm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../../data/keys';
import { queryClient } from '../../../data/queryClient';
import { api, inWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { written } from '../admin/parts';

export const membersListQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: [...keys.members(ws.id), 'admin'] as const,
    queryFn: () => api.members.list.query({ includeRemoved: false }, inWorkspace(ws)) as Promise<MemberSummary[]>,
  });

export function useMembersList(ws: WorkspaceRef) {
  return useQuery(membersListQuery(ws));
}

export const invitesQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: keys.invites(ws.id),
    queryFn: () => api.invites.list.query(undefined, inWorkspace(ws)) as Promise<WorkspaceInvite[]>,
  });

export function useInvites(ws: WorkspaceRef, enabled: boolean) {
  return useQuery({ ...invitesQuery(ws), enabled });
}

export const memberDetailQuery = (ws: WorkspaceRef, memberId: string) =>
  queryOptions({
    queryKey: keys.member(ws.id, memberId),
    queryFn: () => api.members.get.query({ memberId }, inWorkspace(ws)) as Promise<MemberDetail>,
  });

export function useMemberDetail(ws: WorkspaceRef, memberId: string) {
  return useQuery(memberDetailQuery(ws, memberId));
}

function refresh(ws: WorkspaceRef, memberId?: string) {
  void queryClient.invalidateQueries({ queryKey: keys.members(ws.id) });
  if (memberId) void queryClient.invalidateQueries({ queryKey: keys.member(ws.id, memberId) });
  void queryClient.invalidateQueries({ queryKey: keys.invites(ws.id) });
  void queryClient.invalidateQueries({ queryKey: keys.teams(ws.id) });
}

export async function inviteMembers(ws: WorkspaceRef, input: CreateInvitesInput): Promise<WorkspaceInvite[]> {
  const { invites } = await written(ws, api.invites.create.mutate(input, inWorkspace(ws)));
  refresh(ws);
  return invites as WorkspaceInvite[];
}

export async function revokeInvite(ws: WorkspaceRef, inviteId: string) {
  await written(ws, api.invites.revoke.mutate({ inviteId }, inWorkspace(ws)));
  refresh(ws);
}

export async function setAccessLevel(ws: WorkspaceRef, memberId: string, accessLevel: AccessLevel) {
  await written(ws, api.members.updateAccessLevel.mutate({ memberId, accessLevel }, inWorkspace(ws)));
  refresh(ws, memberId);
  // The member's own workspace entry carries their level (admin gating of the settings navigation).
  void queryClient.invalidateQueries({ queryKey: keys.workspaces() });
}

export async function suspendMember(ws: WorkspaceRef, memberId: string) {
  await written(ws, api.members.suspend.mutate({ memberId }, inWorkspace(ws)));
  refresh(ws, memberId);
}

export async function reactivateMember(ws: WorkspaceRef, memberId: string) {
  await written(ws, api.members.reactivate.mutate({ memberId }, inWorkspace(ws)));
  refresh(ws, memberId);
}

export async function removeMember(ws: WorkspaceRef, memberId: string) {
  await written(ws, api.members.remove.mutate({ memberId }, inWorkspace(ws)));
  refresh(ws, memberId);
}

export const ROLE_LABEL: Record<AccessLevel, string> = { admin: 'Admin', member: 'Member', suspended: 'Suspended' };

/** The invite email addresses a pasted string holds (separated by whitespace, commas or semicolons). */
export function splitEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
