// Permissions tab data (BACKLOG 6.04; J permissions §4–5): `permissions.list / put / remove` for one object or list. The
// rows live below the definition's key (['ws', id, 'entity-definition', definitionId, 'permissions']) so grant changes
// (realtime `entity-definition`) and team membership changes refresh them.
import type {
  AccessScope,
  ListPermissionsOutput,
  PermissionGrant,
  PermissionTarget,
  ResourceKind,
} from '@agentic-crm/contracts';
import { accessScopeRank } from '@agentic-crm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../../data/keys';
import { queryClient } from '../../../data/queryClient';
import { api, inWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { written } from '../admin/parts';

export const permissionsQuery = (ws: WorkspaceRef, kind: ResourceKind, resourceId: string) =>
  queryOptions({
    queryKey: [...keys.object(ws.id, resourceId), 'permissions', kind] as const,
    queryFn: () =>
      api.permissions.list.query({ resourceKind: kind, resourceId }, inWorkspace(ws)) as Promise<ListPermissionsOutput>,
  });

export function usePermissions(ws: WorkspaceRef, kind: ResourceKind, resourceId: string) {
  return useQuery(permissionsQuery(ws, kind, resourceId));
}

function refresh(ws: WorkspaceRef, kind: ResourceKind, resourceId: string) {
  void queryClient.invalidateQueries({ queryKey: permissionsQuery(ws, kind, resourceId).queryKey });
  // What the caller may do changes with grants: gating and the sidebar follow.
  void queryClient.invalidateQueries({ queryKey: keys.object(ws.id, resourceId) });
  void queryClient.invalidateQueries({ queryKey: keys.objects(ws.id) });
  if (kind === 'list') void queryClient.invalidateQueries({ queryKey: keys.collections(ws.id) });
}

export async function putPermission(
  ws: WorkspaceRef,
  kind: ResourceKind,
  resourceId: string,
  target: PermissionTarget,
  level: AccessScope,
) {
  await written(ws, api.permissions.put.mutate({ resourceKind: kind, resourceId, target, level }, inWorkspace(ws)));
  refresh(ws, kind, resourceId);
}

export async function removePermission(
  ws: WorkspaceRef,
  kind: ResourceKind,
  resourceId: string,
  target: PermissionTarget,
) {
  await written(ws, api.permissions.remove.mutate({ resourceKind: kind, resourceId, target }, inWorkspace(ws)));
  refresh(ws, kind, resourceId);
}

// ---- copy ------------------------------------------------------------------------------------------------------------

export const LEVEL_META: Record<
  AccessScope,
  { label: string; description: string; icon: 'key' | 'edit' | 'show' | 'hide' }
> = {
  'full-access': { label: 'Full access', description: 'Can manage attributes, permissions and details', icon: 'key' },
  'read-write': { label: 'Read and write', description: 'Can create, edit, and delete records', icon: 'edit' },
  'read-only': { label: 'Read only', description: 'Can only view records', icon: 'show' },
  'no-access': { label: 'No access', description: 'Has no access to object', icon: 'hide' },
};

/** The ⚠ tooltip of a row that inherits more access than its own level ('Inheriting "<level>" from …'). */
export function inheritanceHint(grant: PermissionGrant): string | null {
  const { level, source } = grant.effective;
  if (accessScopeRank[level] <= accessScopeRank[grant.level]) return null;
  const label = LEVEL_META[level].label;
  switch (source.type) {
    case 'workspace':
      return `Inheriting "${label}" from the workspace`;
    case 'team':
      return source.name ? `Inheriting "${label}" from the "${source.name}" team` : `Inheriting "${label}" from a team`;
    default:
      return `Inheriting "${label}" from another permission`;
  }
}
