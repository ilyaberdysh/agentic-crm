// Workspaces: picker/switcher list, creation with handle availability, and "last workspace" recency (BACKLOG 1.03;
// K legacy-welcome §1, §6.5, §10; sessions §8).
import { queryOptions, useQuery } from '@tanstack/react-query';
import { readRaw, writeRaw } from '../lib/storage';
import { keys } from './keys';
import { queryClient } from './queryClient';
import { api, errorEnvelopeOf, httpStatusOf, type RouterOutputs } from './trpc';

export type AccessLevel = 'admin' | 'member' | 'suspended';

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  membership: { id: string; accessLevel: AccessLevel };
}

type WorkspaceWithMembership = RouterOutputs['workspaces']['list'][number];

export function toWorkspaceSummary(w: WorkspaceWithMembership): WorkspaceSummary {
  return {
    id: w.id,
    slug: w.slug,
    name: w.name,
    logoUrl: w.logoUrl ?? null,
    membership: { id: w.membership.id, accessLevel: w.membership.accessLevel },
  };
}

export const workspacesQuery = () =>
  queryOptions({
    queryKey: keys.workspaces(),
    queryFn: async () => (await api.workspaces.list.query()).map(toWorkspaceSummary),
    staleTime: 10 * 60_000,
  });

export function useWorkspaces(): WorkspaceSummary[] {
  return useQuery(workspacesQuery()).data ?? [];
}

// ---- recency (browser-local, like Attio's agentic-crm:recent-workspaces) -------------------------------------------

const RECENT_KEY = 'recent-workspaces';
const PREFERRED_KEY = 'preferred-workspace-id';

export function recentWorkspaceIds(): string[] {
  const raw = readRaw(RECENT_KEY);
  const ids = raw ? raw.split(',').filter(Boolean) : [];
  const preferred = readRaw(PREFERRED_KEY);
  if (preferred && !ids.includes(preferred)) ids.push(preferred);
  return ids;
}

/** Written on every mount of a workspace shell. */
export function rememberWorkspace(id: string): void {
  const ids = [id, ...recentWorkspaceIds().filter((x) => x !== id)].slice(0, 20);
  writeRaw(RECENT_KEY, ids.join(','));
  writeRaw(PREFERRED_KEY, id);
}

/** Relevance order: most recently opened first, then the rest by name. */
export function relevanceSorted(workspaces: WorkspaceSummary[]): WorkspaceSummary[] {
  const recent = recentWorkspaceIds();
  const rank = (w: WorkspaceSummary) => {
    const i = recent.indexOf(w.id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...workspaces].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Root redirect (legacy-welcome §1): exactly one workspace → it; else the last one opened in this browser; else
 * the picker. Null = no workspaces (→ create one).
 */
export function pickWorkspace(workspaces: WorkspaceSummary[]): WorkspaceSummary | 'picker' | null {
  if (workspaces.length === 0) return null;
  if (workspaces.length === 1) return workspaces[0] as WorkspaceSummary;
  for (const id of recentWorkspaceIds()) {
    const match = workspaces.find((w) => w.id === id);
    if (match) return match;
  }
  return 'picker';
}

// ---- creation -------------------------------------------------------------------------------------------------

export type SlugAvailability = 'available' | 'taken' | 'invalid';

/** Handle check while typing (Attio `GET …/slugs/{slug}`): reserved and taken handles are unavailable. */
export async function checkSlugAvailability(slug: string): Promise<SlugAvailability> {
  const result = await api.workspaces.checkSlug.query({ slug });
  if (!result.valid) return 'invalid';
  return result.available ? 'available' : 'taken';
}

export class SlugTakenError extends Error {
  constructor(message = 'This handle is already in use') {
    super(message);
    this.name = 'SlugTakenError';
  }
}

/**
 * Creates a workspace (the creator becomes admin). The id is minted once per form so a retried submit replays the
 * same create (I3). 409 SLUG_IN_USE / 400 RESERVED_SLUG surface as SlugTakenError.
 */
export async function createWorkspace(input: { id: string; name: string; slug: string }): Promise<WorkspaceSummary> {
  let created: RouterOutputs['workspaces']['create'];
  try {
    created = await api.workspaces.create.mutate({ id: input.id, name: input.name.trim(), slug: input.slug });
  } catch (error) {
    const { code, message } = errorEnvelopeOf(error);
    if (httpStatusOf(error) === 409 || code === 'SLUG_IN_USE') throw new SlugTakenError();
    if (code === 'RESERVED_SLUG') throw new SlugTakenError(message ?? 'This handle is reserved');
    throw error;
  }
  const summary = toWorkspaceSummary(created.workspace);
  queryClient.setQueryData<WorkspaceSummary[]>(keys.workspaces(), (prev) =>
    prev ? [...prev.filter((w) => w.id !== summary.id), summary] : [summary],
  );
  void queryClient.invalidateQueries({ queryKey: keys.workspaces() });
  return summary;
}
