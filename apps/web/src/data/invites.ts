// Invites addressed to the signed-in user (`/workspaces` "Invited" rows, `/auth/join/$workspaceSlug`; K
// legacy-welcome §9–10). The invite link carries the invite id as its token.
import { queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from './keys';
import { queryClient } from './queryClient';
import { api, type RouterOutputs } from './trpc';
import { toWorkspaceSummary, type WorkspaceSummary } from './workspaces';

export type MyInvite = RouterOutputs['invites']['listMine'][number];

export const myInvitesQuery = () =>
  queryOptions({
    queryKey: ['invites', 'mine'] as const,
    queryFn: () => api.invites.listMine.query(),
    staleTime: 60_000,
  });

export function useMyInvites(enabled = true): MyInvite[] {
  return useQuery({ ...myInvitesQuery(), enabled }).data ?? [];
}

/** Accepts by token (invite id) or by workspace handle; idempotent for existing members. */
export async function acceptInvite(
  target: { inviteId: string } | { workspaceSlug: string },
): Promise<WorkspaceSummary> {
  const { workspace } = await api.invites.accept.mutate(target);
  const summary = toWorkspaceSummary(workspace);
  queryClient.setQueryData<WorkspaceSummary[]>(keys.workspaces(), (prev) =>
    prev ? [...prev.filter((w) => w.id !== summary.id), summary] : [summary],
  );
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.workspaces() }),
    queryClient.invalidateQueries({ queryKey: myInvitesQuery().queryKey }),
  ]);
  return summary;
}

/** Invite link for a pending invite (shown to admins once invites ship; the token is the invite id). */
export function inviteLink(workspaceSlug: string, inviteId: string): string {
  return `${window.location.origin}/auth/join/${encodeURIComponent(workspaceSlug)}?invite=${encodeURIComponent(inviteId)}`;
}
