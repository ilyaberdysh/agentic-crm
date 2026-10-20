// Favorites and favorite folders (BACKLOG 3.17; B sidebar §6; CROSS-DOMAIN B.18). Personal to the member, one cached
// list `{directories, favorites}` under ['ws', ws, 'favorite-list']. Every write is optimistic on that list and
// reverts on error; the realtime echo refetches it (and the note / template reads that carry `favoriteId`).
import {
  type FavoriteType,
  type ListFavoritesOutput,
  type RemoveFavoriteByTargetInput,
  rankBefore,
  rankBetween,
} from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { type QueryClient, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { keys } from '../../data/keys';
import { api, errorEnvelopeOf, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useWorkspace } from '../shell/workspaceContext';

export type Favorite = ListFavoritesOutput['favorites'][number];
export type FavoriteDirectory = ListFavoritesOutput['directories'][number];
export type FavoritesList = ListFavoritesOutput;

export const favoritesKey = (ws: string) => keys.resource(ws, 'favorite-list');

export const favoritesQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: favoritesKey(ws.id),
    queryFn: () => api.favorites.list.query(undefined, inWorkspace(ws)),
  });

function useWs(): WorkspaceRef {
  const { workspace } = useWorkspace();
  return useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
}

export function useFavorites() {
  return useQuery(favoritesQuery(useWs()));
}

/** Top level (folders and loose favorites) in rank order, and each folder's children. */
export interface FavoriteTree {
  top: ({ kind: 'directory'; directory: FavoriteDirectory } | { kind: 'favorite'; favorite: Favorite })[];
  children: Map<string, Favorite[]>;
}

export function favoriteTree(list: FavoritesList | undefined): FavoriteTree {
  const children = new Map<string, Favorite[]>();
  const top: FavoriteTree['top'] = [];
  if (!list) return { top, children };
  for (const d of list.directories) {
    top.push({ kind: 'directory', directory: d });
    children.set(d.id, []);
  }
  for (const f of list.favorites) {
    if (f.directoryId && children.has(f.directoryId)) children.get(f.directoryId)?.push(f);
    else top.push({ kind: 'favorite', favorite: f });
  }
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  top.sort((a, b) =>
    order(
      a.kind === 'directory' ? a.directory.sortOrder : a.favorite.sortOrder,
      b.kind === 'directory' ? b.directory.sortOrder : b.favorite.sortOrder,
    ),
  );
  for (const list of children.values()) list.sort((a, b) => order(a.sortOrder, b.sortOrder));
  return { top, children };
}

/** Rank before every top-level item (new favorites and folders go to the top). */
export function topRank(list: FavoritesList | undefined): string {
  const ranks = [...(list?.directories ?? []), ...(list?.favorites ?? []).filter((f) => !f.directoryId)].map(
    (x) => x.sortOrder,
  );
  const first = ranks.sort()[0] ?? null;
  return first ? rankBefore(first) : rankBetween(null, null);
}

// ---- optimistic writes ----------------------------------------------------------------------------------------

async function optimistic(
  client: QueryClient,
  ws: WorkspaceRef,
  update: (prev: FavoritesList) => FavoritesList,
  write: () => Promise<{ seq: string | null }>,
  failure: string,
): Promise<boolean> {
  const key = favoritesKey(ws.id);
  await client.cancelQueries({ queryKey: key });
  const before = client.getQueryData<FavoritesList>(key);
  if (before) client.setQueryData<FavoritesList>(key, update(before));
  try {
    const { seq } = await write();
    noteAcceptAfter(ws.id, seq);
    return true;
  } catch (error) {
    if (before) client.setQueryData(key, before);
    toast.error({ title: failure, description: errorEnvelopeOf(error).message });
    return false;
  } finally {
    void client.invalidateQueries({ queryKey: key });
  }
}

export interface FavoriteTarget {
  favoriteType: FavoriteType;
  targetId: string;
  /** Records: their object (id or api slug). */
  entityDefinitionId?: string;
}

export function addFavorite(client: QueryClient, ws: WorkspaceRef, target: FavoriteTarget) {
  const id = newId();
  const list = client.getQueryData<FavoritesList>(favoritesKey(ws.id));
  const sortOrder = topRank(list);
  const placeholder: Favorite = {
    id,
    favoriteType: target.favoriteType,
    entityDefinitionId: target.entityDefinitionId ?? null,
    targetId: target.targetId,
    directoryId: null,
    sortOrder,
    createdAt: new Date().toISOString(),
    target: { state: 'unknown', label: null, secondaryLabel: null },
  };
  return optimistic(
    client,
    ws,
    (prev) => ({ ...prev, favorites: [...prev.favorites, placeholder] }),
    () => api.favorites.put.mutate({ id, ...target, sortOrder }, inWorkspace(ws)),
    'Failed to add favorite',
  );
}

export function removeFavoriteByTarget(client: QueryClient, ws: WorkspaceRef, target: RemoveFavoriteByTargetInput) {
  return optimistic(
    client,
    ws,
    (prev) => ({
      ...prev,
      favorites: prev.favorites.filter(
        (f) => !(f.favoriteType === target.favoriteType && f.targetId === target.targetId),
      ),
    }),
    () => api.favorites.removeByTarget.mutate(target, inWorkspace(ws)),
    'Failed to remove favorite',
  );
}

export function removeFavorite(client: QueryClient, ws: WorkspaceRef, favoriteId: string) {
  return optimistic(
    client,
    ws,
    (prev) => ({ ...prev, favorites: prev.favorites.filter((f) => f.id !== favoriteId) }),
    () => api.favorites.delete.mutate({ favoriteId }, inWorkspace(ws)),
    'Failed to remove favorite',
  );
}

export function moveFavorite(
  client: QueryClient,
  ws: WorkspaceRef,
  favoriteId: string,
  directoryId: string | null,
  sortOrder: string,
) {
  return optimistic(
    client,
    ws,
    (prev) => ({
      ...prev,
      favorites: prev.favorites.map((f) => (f.id === favoriteId ? { ...f, directoryId, sortOrder } : f)),
    }),
    () => api.favorites.move.mutate({ favoriteId, directoryId, sortOrder }, inWorkspace(ws)),
    'Failed to move favorite',
  );
}

export function createDirectory(client: QueryClient, ws: WorkspaceRef, title: string) {
  const id = newId();
  const sortOrder = topRank(client.getQueryData<FavoritesList>(favoritesKey(ws.id)));
  return optimistic(
    client,
    ws,
    (prev) => ({
      ...prev,
      directories: [...prev.directories, { id, title, sortOrder, createdAt: new Date().toISOString() }],
    }),
    () => api.favorites.putDirectory.mutate({ id, title, sortOrder }, inWorkspace(ws)),
    'Failed to create folder',
  );
}

export function updateDirectory(
  client: QueryClient,
  ws: WorkspaceRef,
  directoryId: string,
  patch: { title?: string; sortOrder?: string },
) {
  return optimistic(
    client,
    ws,
    (prev) => ({ ...prev, directories: prev.directories.map((d) => (d.id === directoryId ? { ...d, ...patch } : d)) }),
    () => api.favorites.updateDirectory.mutate({ directoryId, ...patch }, inWorkspace(ws)),
    'Failed to update folder',
  );
}

/** Deletes the folder and every favorite inside it (B sidebar §6). */
export function deleteDirectory(client: QueryClient, ws: WorkspaceRef, directoryId: string) {
  return optimistic(
    client,
    ws,
    (prev) => ({
      directories: prev.directories.filter((d) => d.id !== directoryId),
      favorites: prev.favorites.filter((f) => f.directoryId !== directoryId),
    }),
    () => api.favorites.deleteDirectory.mutate({ directoryId }, inWorkspace(ws)),
    'Failed to delete folder',
  );
}

// ---- star toggles ---------------------------------------------------------------------------------------------

/** Whether the item is a favorite (from the member's list) and a toggle for stars and "Add to favorites" items. */
export function useFavoriteToggle(target: FavoriteTarget | null): {
  isFavorite: boolean;
  toggle: () => void;
  favoriteId: string | null;
} {
  const ws = useWs();
  const client = useQueryClient();
  const list = useFavorites().data;
  const favorite = target
    ? (list?.favorites.find((f) => f.favoriteType === target.favoriteType && f.targetId === target.targetId) ?? null)
    : null;
  const toggle = useCallback(() => {
    if (!target) return;
    if (favorite)
      void removeFavoriteByTarget(client, ws, { favoriteType: target.favoriteType, targetId: target.targetId });
    else void addFavorite(client, ws, target);
  }, [client, ws, target, favorite]);
  return { isFavorite: Boolean(favorite), toggle, favoriteId: favorite?.id ?? null };
}
