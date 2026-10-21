// Shared beforeLoad logic: the logged-out routing matrix  and the post-auth workspace pick
// (legacy-welcome).
import type { QueryClient } from '@tanstack/react-query';
import { type ParsedLocation, redirect } from '@tanstack/react-router';
import { type Me, meQuery } from '../data/session';
import { pickWorkspace, type WorkspaceSummary, workspacesQuery } from '../data/workspaces';
import { safeOrigin } from '../lib/origin';

export interface RouterContext {
  queryClient: QueryClient;
}

export function originOf(location: ParsedLocation): string {
  return `${location.pathname}${location.searchStr ?? ''}`;
}

export function getMe(context: RouterContext): Promise<Me | null> {
  return context.queryClient.ensureQueryData(meQuery());
}

export function getWorkspaces(context: RouterContext): Promise<WorkspaceSummary[]> {
  return context.queryClient.ensureQueryData(workspacesQuery());
}

/** Signed-in user or a redirect to `/auth/sign-in?origin=<this page>`. */
export async function requireMe(context: RouterContext, location: ParsedLocation): Promise<Me> {
  const me = await getMe(context);
  if (!me) throw redirect({ to: '/auth/sign-in', search: { origin: originOf(location) }, replace: true });
  return me;
}

/** Where a signed-in user lands from `/`: their single / last workspace, the picker, or workspace creation. */
export async function homeRedirect(context: RouterContext): Promise<never> {
  const pick = pickWorkspace(await getWorkspaces(context));
  if (pick === null) throw redirect({ to: '/welcome/workspace-details', replace: true });
  if (pick === 'picker') throw redirect({ to: '/workspaces', replace: true });
  throw redirect({ to: '/$workspaceSlug', params: { workspaceSlug: pick.slug }, replace: true });
}

/** After sign-in: the same-origin `origin`, else `/`. */
export function afterSignInPath(origin: unknown): string {
  return safeOrigin(origin) ?? '/';
}

export function stringSearch(search: Record<string, unknown>, key: string): string | undefined {
  const v = search[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
