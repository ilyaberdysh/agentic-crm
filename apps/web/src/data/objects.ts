// Workspace objects used by the sidebar Records section and object routes.
// Entity definitions are cached once per id (normalised) and the list holds them in order.
import type { EntityDefinition } from '@agentic-crm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from './keys';
import { queryClient } from './queryClient';
import { api, inWorkspace, type WorkspaceRef } from './trpc';

export type ObjectSummary = Pick<
  EntityDefinition,
  | 'id'
  | 'apiSlug'
  | 'singularNoun'
  | 'pluralNoun'
  | 'entityType'
  | 'standardObjectType'
  | 'icon'
  | 'sortOrder'
  | 'isArchived'
  | 'createdAt'
>;

/** Objects shown under Records: people, companies, standard and custom objects (not lists, tasks, members). */
const RECORD_ENTITY_TYPES = ['person-record', 'company-record', 'standard-object', 'custom-record'] as const;

async function fetchObjects(workspace: WorkspaceRef): Promise<ObjectSummary[]> {
  const defs = await api.schema.objects.list.query(
    { includeArchived: false, entityTypes: [...RECORD_ENTITY_TYPES] },
    inWorkspace(workspace),
  );
  // Normalise: each definition also lives under its own key.
  for (const def of defs) queryClient.setQueryData(keys.object(workspace.id, def.id), def);
  return defs;
}

export const objectsQuery = (workspace: WorkspaceRef) =>
  queryOptions({
    queryKey: keys.objects(workspace.id),
    queryFn: () => fetchObjects(workspace),
  });

export function useObjects(workspace: WorkspaceRef | null) {
  return useQuery({
    ...objectsQuery(workspace ?? { id: '', slug: '' }),
    enabled: Boolean(workspace),
    select: (objects: ObjectSummary[]) => objects.filter((o) => !o.isArchived),
  });
}

export type RecordsSort = 'recently-created' | 'alphabetical' | 'custom';

export function sortObjects(objects: ObjectSummary[], sort: RecordsSort): ObjectSummary[] {
  const list = [...objects];
  if (sort === 'alphabetical') return list.sort((a, b) => a.pluralNoun.localeCompare(b.pluralNoun));
  if (sort === 'recently-created') return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list.sort(
    (a, b) => (a.sortOrder ?? '~').localeCompare(b.sortOrder ?? '~') || a.createdAt.localeCompare(b.createdAt),
  );
}

/** App route of an object's index page below `/<workspaceSlug>/`. */
export function objectPath(object: Pick<ObjectSummary, 'apiSlug' | 'entityType'>): string {
  return object.entityType === 'custom-record' ? `custom/${object.apiSlug}` : object.apiSlug;
}
