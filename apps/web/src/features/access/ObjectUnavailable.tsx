// An object URL whose object is not in the member's readable list (the sidebar hides objects with No access): ask the
// server why. 403 → the object exists but the member may not open it (no-access page); an admin can read any
// definition, so a definition answered to an admin is an object without data access ("Add yourself"); 404 or an
// archived object → the workspace root like any unknown path (B README §2.6).
import { useQuery } from '@tanstack/react-query';
import { Navigate } from '@tanstack/react-router';
import { keys } from '../../data/keys';
import { api, httpStatusOf, inWorkspace } from '../../data/trpc';
import { putPermission } from '../settings/permissions/data';
import { ContentSpinner } from '../shell/AppShell';
import { useWorkspace } from '../shell/workspaceContext';
import { NoAccessState } from './NoAccessState';

export function ObjectUnavailable({ apiSlug }: { apiSlug: string }) {
  const { workspace, href } = useWorkspace();
  const probe = useQuery({
    queryKey: [...keys.objects(workspace.id), 'probe', apiSlug] as const,
    queryFn: async () => {
      try {
        const def = await api.schema.objects.get.query({ entityDefinitionId: apiSlug }, inWorkspace(workspace));
        return { state: 'found' as const, id: def.id, archived: def.isArchived };
      } catch (error) {
        return { state: httpStatusOf(error) === 403 ? ('forbidden' as const) : ('missing' as const) };
      }
    },
    retry: false,
  });
  if (probe.isPending) return <ContentSpinner />;
  const result = probe.data;
  if (result?.state === 'forbidden') return <NoAccessState kind="object" canGrant={false} />;
  if (result?.state === 'found' && !result.archived) {
    const id = result.id;
    return (
      <NoAccessState
        kind="object"
        canGrant
        onAddYourself={() =>
          putPermission(workspace, 'object', id, { type: 'member', id: workspace.membership.id }, 'full-access')
        }
      />
    );
  }
  return <Navigate to={href('home')} replace />;
}
