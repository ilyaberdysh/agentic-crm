// Workspace general and security data (BACKLOG 6.02, 6.09; J workspace-admin §2, §5): `workspace.get`, `workspace.update`
// (name, slug, logo), `workspace.checkSlug`, `workspace.settings.update` (export formula-injection prefix).
import type {
  CheckWorkspaceSlugOutput,
  UpdateWorkspaceGeneralInput,
  UpdateWorkspaceSettingsInput,
  WorkspaceDetail,
} from '@agentic-crm/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../../data/keys';
import { queryClient } from '../../../data/queryClient';
import { api, inWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { useWorkspace } from '../../shell/workspaceContext';
import { useFileUrl, written } from '../admin/parts';

export const workspaceDetailQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: [...keys.workspace(ws.id), 'detail'] as const,
    queryFn: () => api.workspace.get.query(undefined, inWorkspace(ws)) as Promise<WorkspaceDetail>,
  });

export function useWorkspaceDetail(ws: WorkspaceRef) {
  return useQuery(workspaceDetailQuery(ws));
}

function remember(ws: WorkspaceRef, workspace: WorkspaceDetail) {
  queryClient.setQueryData(workspaceDetailQuery(ws).queryKey, workspace);
}

export async function updateWorkspaceGeneral(
  ws: WorkspaceRef,
  input: UpdateWorkspaceGeneralInput,
): Promise<WorkspaceDetail> {
  const { workspace } = await written(ws, api.workspace.update.mutate(input, inWorkspace(ws)));
  remember(ws, workspace);
  // Picker, switcher and sidebar read the workspace list: refetch it now (a new slug must resolve before navigating).
  await queryClient.refetchQueries({ queryKey: keys.workspaces() });
  return workspace;
}

export async function updateWorkspaceSettings(
  ws: WorkspaceRef,
  input: UpdateWorkspaceSettingsInput,
): Promise<WorkspaceDetail> {
  const { workspace } = await written(ws, api.workspace.settings.update.mutate(input, inWorkspace(ws)));
  remember(ws, workspace);
  return workspace;
}

export function useSlugCheck(ws: WorkspaceRef, slug: string, enabled: boolean) {
  return useQuery({
    queryKey: [...keys.workspace(ws.id), 'slug-check', slug] as const,
    queryFn: () => api.workspace.checkSlug.query({ slug }, inWorkspace(ws)) as Promise<CheckWorkspaceSlugOutput>,
    enabled: enabled && slug.length > 0,
    staleTime: 10_000,
    retry: false,
  });
}

/** Message under the slug field for a check result (null = available). */
export function slugProblem(check: CheckWorkspaceSlugOutput | undefined): string | null {
  if (!check || check.available) return null;
  switch (check.reason) {
    case 'invalid':
      return 'Use lower-case letters, digits and single hyphens';
    case 'reserved':
      return 'This slug is reserved';
    case 'taken':
      return 'This slug is already in use by another workspace';
    default:
      return 'This slug is not available';
  }
}

/** The workspace logo for the sidebar: an uploaded image (signed URL) wins over a logo URL. */
export function useWorkspaceLogo(): string | null {
  const { workspace } = useWorkspace();
  const detail = useWorkspaceDetail(workspace);
  const uploaded = useFileUrl(detail.data?.logoFileId);
  return uploaded ?? workspace.logoUrl;
}
