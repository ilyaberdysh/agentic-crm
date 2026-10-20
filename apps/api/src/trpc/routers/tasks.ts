// Tasks (BACKLOG 3.15; E README §2.6–2.7b, §3.3). Thin adapters over domain.tasks. Completion answers the canonical
// task so the client's optimistic checkbox can reconcile (and revert on error).
import {
  batchGetTasksInputSchema,
  bulkSetTasksCompletedInputSchema,
  countDueTasksInputSchema,
  createTaskInputSchema,
  listTasksInputSchema,
  setTaskCompletedInputSchema,
  taskIdInputSchema,
  taskIdsInputSchema,
  updateTaskInputSchema,
  uuidSchema,
} from '@agentic-crm/contracts';
import { z } from 'zod';
import { withSeq } from '../mutation';
import { router, workspaceProcedure } from '../trpc';

export const tasksRouter = router({
  /** PUT create with a client UUID: content (text + mentions), deadline (X-09), assignees, linked records. */
  create: workspaceProcedure.input(createTaskInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.tasks.create(svc, input));
    return { task: result, seq };
  }),

  /** Edit dialog save: every given field replaces the stored one. */
  update: workspaceProcedure.input(updateTaskInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.tasks.update(svc, input));
    return { task: result, seq };
  }),

  /** Checkbox: `{taskId, completed}` → the canonical task. */
  setCompleted: workspaceProcedure.input(setTaskCompletedInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.tasks.setCompleted(svc, input));
    return { task: result, seq };
  }),

  bulkSetCompleted: workspaceProcedure.input(bulkSetTasksCompletedInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.tasks.bulkSetCompleted(svc, input));
    return { ...result, seq };
  }),

  delete: workspaceProcedure.input(z.object({ taskId: uuidSchema })).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.tasks.delete(svc, [input.taskId]));
    return { ...result, seq };
  }),

  /** "Delete # tasks" from the bulk toolbar. */
  bulkDelete: workspaceProcedure.input(taskIdsInputSchema).mutation(async ({ ctx, input }) => {
    const { result, seq } = await withSeq(ctx.service, (svc) => ctx.domain.tasks.delete(svc, input.taskIds));
    return { ...result, seq };
  }),

  get: workspaceProcedure
    .input(taskIdInputSchema)
    .query(({ ctx, input }) => ctx.domain.tasks.get(ctx.service, input.taskId)),

  batchGet: workspaceProcedure
    .input(batchGetTasksInputSchema)
    .query(({ ctx, input }) => ctx.domain.tasks.batchGet(ctx.service, input.taskIds)),

  /**
   * Tasks page / record Tasks tab: groups (deadline buckets overdue|today|this-week|later|no-date|completed in the
   * viewer's `timeZone` and week start, or by assignee / creation date / creator), sort and filters.
   */
  list: workspaceProcedure
    .input(listTasksInputSchema)
    .query(({ ctx, input }) => ctx.domain.tasks.list(ctx.service, input)),

  /** Sidebar badge: my incomplete tasks due by the end of today. */
  countDue: workspaceProcedure
    .input(countDueTasksInputSchema)
    .query(({ ctx, input }) => ctx.domain.tasks.countDue(ctx.service, input)),
});
