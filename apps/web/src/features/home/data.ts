// Home data (BACKLOG 5.07): one `home.summary` query for the greeting name, the Tasks block and recent records. The key
// lives under the task-list prefix, so every task change (create, complete, edit — mine or a teammate's) refetches it
// through the realtime vocabulary; recent records refresh when Home mounts.
import { useQuery } from '@tanstack/react-query';
import { keys } from '../../data/keys';
import { api, inWorkspace } from '../../data/trpc';
import { useWorkspace } from '../shell/workspaceContext';
import { useCalendar } from '../tasks/calendar';

export function useHomeSummary() {
  const { workspace } = useWorkspace();
  const { timeZone } = useCalendar();
  return useQuery({
    queryKey: [...keys.resource(workspace.id, 'task-list'), 'home-summary', timeZone],
    queryFn: () => api.home.summary.query({ timeZone }, inWorkspace({ id: workspace.id, slug: workspace.slug })),
    refetchOnMount: 'always',
  });
}
