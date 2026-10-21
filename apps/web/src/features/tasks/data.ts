// Tasks on the client (BACKLOG 3.15; b). List queries live under ['ws', ws, 'task-list',
// params], single tasks under ['ws', ws, 'task', id] (realtime: one prefix per resource). Completion is optimistic in
// every cached list and reverts on error ("Failed to mark task as done"); deadline groups are recomputed on the
// client from the list's bounds, so a completed row moves to "Completed" at once.
import {
  type CreateTaskInput,
  type ListTasksInput,
  type ListTasksOutput,
  type TaskBucket,
  taskBucketOf,
  type UpdateTaskInput,
} from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../data/keys';
import { markCovered } from '../../data/realtime/invalidation';
import {
  api,
  errorEnvelopeOf,
  inWorkspace,
  noteAcceptAfter,
  type RouterOutputs,
  type WorkspaceRef,
} from '../../data/trpc';
import { newId } from '../../lib/ids';
import { useWorkspaceRef } from '../notes/data';

export type Task = RouterOutputs['tasks']['get'];
export type TaskList = ListTasksOutput;

export const taskKeys = {
  task: (ws: string, id: string) => [...keys.resource(ws, 'task'), id] as const,
  list: (ws: string, params: ListTasksInput) => [...keys.resource(ws, 'task-list'), params] as const,
  lists: (ws: string) => keys.resource(ws, 'task-list'),
};

export function useTaskList(params: ListTasksInput, enabled = true) {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: taskKeys.list(ws.id, params),
    queryFn: () => api.tasks.list.query(params, inWorkspace(ws)),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export const taskQuery = (ws: WorkspaceRef, taskId: string) =>
  queryOptions({
    queryKey: taskKeys.task(ws.id, taskId),
    queryFn: () => api.tasks.get.query({ taskId }, inWorkspace(ws)),
    retry: (count, error) => count < 2 && !/not found|404/i.test(String((error as Error)?.message)),
  });

export function useTask(taskId: string | null) {
  const ws = useWorkspaceRef();
  return useQuery({ ...taskQuery(ws, taskId ?? ''), enabled: Boolean(taskId) });
}

/** Sidebar badge: my incomplete tasks due by the end of today. */
export function useDueTaskCount(timeZone: string) {
  const ws = useWorkspaceRef();
  return useQuery({
    queryKey: [...keys.resource(ws.id, 'task-list'), 'count-due', timeZone],
    queryFn: () => api.tasks.countDue.query({ timeZone }, inWorkspace(ws)),
  });
}

// ---- grouping ---------------------------------------------------------------------------------------------------

/** Overdue tasks appear in the "Today" due-date group. */
export type DeadlineGroupKey = 'today' | 'this-week' | 'later' | 'no-date' | 'completed';

export const DEADLINE_GROUP_LABEL: Record<DeadlineGroupKey, string> = {
  today: 'Today',
  'this-week': 'This week',
  later: 'Upcoming',
  'no-date': 'No due date',
  completed: 'Completed',
};

const DEADLINE_ORDER: DeadlineGroupKey[] = ['today', 'this-week', 'later', 'no-date', 'completed'];

const groupOfBucket = (bucket: TaskBucket): DeadlineGroupKey => (bucket === 'overdue' ? 'today' : bucket);

const byDeadline = (a: Task, b: Task) =>
  (a.deadlineAt ?? '9999') < (b.deadlineAt ?? '9999')
    ? -1
    : (a.deadlineAt ?? '9999') > (b.deadlineAt ?? '9999')
      ? 1
      : 0;

/** Regroups a list's tasks by deadline with the server's bounds (after optimistic changes). */
export function deadlineGroups(list: TaskList): { key: DeadlineGroupKey; tasks: Task[] }[] {
  const seen = new Set<string>();
  const all: Task[] = [];
  for (const g of list.groups) {
    for (const t of g.tasks) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      all.push(t);
    }
  }
  const groups = new Map<DeadlineGroupKey, Task[]>();
  for (const t of all) {
    const key = groupOfBucket(taskBucketOf(t, list.bounds));
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return DEADLINE_ORDER.filter((k) => groups.has(k)).map((key) => ({
    key,
    // Each bucket by deadline ascending; within Today the overdue ones come first naturally.
    tasks: [...(groups.get(key) ?? [])].sort(byDeadline),
  }));
}

// ---- writes -------------------------------------------------------------------------------------------------------

function patchTaskEverywhere(client: QueryClient, ws: string, taskId: string, patch: (t: Task) => Task | null) {
  client.setQueriesData<TaskList>({ queryKey: taskKeys.lists(ws) }, (prev) => {
    if (!prev || !('groups' in prev)) return prev;
    let changed = false;
    const groups = prev.groups.map((g) => {
      const tasks: Task[] = [];
      for (const t of g.tasks) {
        if (t.id !== taskId) {
          tasks.push(t);
          continue;
        }
        changed = true;
        const next = patch(t);
        if (next) tasks.push(next);
      }
      return { ...g, tasks };
    });
    return changed ? { ...prev, groups } : prev;
  });
  client.setQueryData<Task>(taskKeys.task(ws, taskId), (prev) => (prev ? (patch(prev) ?? undefined) : prev));
}

function settleTask(client: QueryClient, ws: WorkspaceRef, task: Task, seq: string | null) {
  noteAcceptAfter(ws.id, seq);
  patchTaskEverywhere(client, ws.id, task.id, () => task);
  const key = taskKeys.task(ws.id, task.id);
  client.setQueryData(key, task);
  markCovered(key, seq);
}

/** Checkbox: optimistic everywhere, canonical task on success, revert + toast on error. */
export async function setTaskCompleted(
  client: QueryClient,
  ws: WorkspaceRef,
  task: Task,
  completed: boolean,
  memberId: string | null,
): Promise<boolean> {
  await client.cancelQueries({ queryKey: keys.resource(ws.id, 'task-list') });
  const before = task;
  patchTaskEverywhere(client, ws.id, task.id, (t) => ({
    ...t,
    isCompleted: completed,
    completedAt: completed ? new Date().toISOString() : null,
    completedBy: completed && memberId ? { type: 'workspace-member', id: memberId } : null,
  }));
  try {
    const { task: saved, seq } = await api.tasks.setCompleted.mutate({ taskId: task.id, completed }, inWorkspace(ws));
    settleTask(client, ws, saved, seq);
    return true;
  } catch (error) {
    patchTaskEverywhere(client, ws.id, task.id, () => before);
    toast.error({
      title: completed ? 'Failed to mark task as done' : 'Failed to mark task as not done',
      description: errorEnvelopeOf(error).message,
    });
    return false;
  } finally {
    void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'task-list') });
  }
}

export async function bulkSetCompleted(client: QueryClient, ws: WorkspaceRef, taskIds: string[], completed: boolean) {
  const snapshot = client.getQueriesData<TaskList>({ queryKey: taskKeys.lists(ws.id) });
  for (const id of taskIds) {
    patchTaskEverywhere(client, ws.id, id, (t) => ({
      ...t,
      isCompleted: completed,
      completedAt: completed ? (t.completedAt ?? new Date().toISOString()) : null,
    }));
  }
  try {
    const out = await api.tasks.bulkSetCompleted.mutate({ taskIds, completed }, inWorkspace(ws));
    noteAcceptAfter(ws.id, out.seq);
  } catch (error) {
    for (const [key, data] of snapshot) client.setQueryData(key, data);
    toast.error({ title: 'Failed to update the tasks', description: errorEnvelopeOf(error).message });
  } finally {
    void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'task-list') });
  }
}

export async function createTask(
  client: QueryClient,
  ws: WorkspaceRef,
  input: Omit<CreateTaskInput, 'id'> & { id?: string },
): Promise<Task> {
  const { task, seq } = await api.tasks.create.mutate({ id: input.id ?? newId(), ...input }, inWorkspace(ws));
  noteAcceptAfter(ws.id, seq);
  client.setQueryData(taskKeys.task(ws.id, task.id), task);
  void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'task-list') });
  return task;
}

export async function updateTask(client: QueryClient, ws: WorkspaceRef, input: UpdateTaskInput): Promise<Task> {
  const { task, seq } = await api.tasks.update.mutate(input, inWorkspace(ws));
  settleTask(client, ws, task, seq);
  void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'task-list') });
  return task;
}

export async function deleteTasks(client: QueryClient, ws: WorkspaceRef, taskIds: string[]): Promise<void> {
  const out =
    taskIds.length === 1
      ? await api.tasks.delete.mutate({ taskId: taskIds[0] as string }, inWorkspace(ws))
      : await api.tasks.bulkDelete.mutate({ taskIds }, inWorkspace(ws));
  noteAcceptAfter(ws.id, out.seq);
  for (const id of taskIds) {
    patchTaskEverywhere(client, ws.id, id, () => null);
    client.removeQueries({ queryKey: taskKeys.task(ws.id, id) });
  }
  void client.invalidateQueries({ queryKey: keys.resource(ws.id, 'task-list') });
}
