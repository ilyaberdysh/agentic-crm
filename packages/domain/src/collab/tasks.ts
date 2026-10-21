// Tasks (BACKLOG 3.15; E README §2.6–2.7b, §3.3, §4.3; decisions X-09 deadlines, X-10 week start).
// A task is visible to every member; linked records must be readable to be
// linked, and a task linked only to records the caller cannot read is hidden from them.
import {
  type BulkSetTasksCompletedInput,
  bulkSetTasksCompletedInputSchema,
  type CountDueTasksInput,
  type CreateTaskInput,
  countDueTasksInputSchema,
  createdBucketOf,
  createdBucketRanges,
  createTaskInputSchema,
  type DeadlineInput,
  endOfLocalDay,
  isTimeZone,
  type ListTasksInput,
  type ListTasksOutput,
  listTasksInputSchema,
  type Mention,
  type PlainTextContent,
  type RecordRef,
  type SetTaskCompletedInput,
  setTaskCompletedInputSchema,
  type Task,
  type TaskGroup,
  taskBucketBounds,
  taskBucketOf,
  taskBuckets,
  type UpdateTaskInput,
  updateTaskInputSchema,
  type WeekDay,
  weekStartForLocale,
} from '@agentic-crm/contracts';
import { jsonb, type Selectable, sql, type TasksTable } from '@agentic-crm/db';
import { badRequest, conflict, notFound, valueError } from '../errors.ts';
import { notifyTaskAssigned } from '../notifications/producers.ts';
import type { Tx } from '../tx.ts';
import { taskEvent } from '../webhooks/events.ts';
import {
  actorJson,
  type CollabDeps,
  positioned,
  readableDefinitions,
  resolveRecordRefs,
  toActor,
  toActorOrNull,
} from './common.ts';
import { emitTimelines } from './notes.ts';

type TaskRow = Selectable<TasksTable>;

const taskNotFound = (taskId: string) => notFound('Task not found', { task_id: taskId });

/** X-09: a date without a time is the end of that day in the given zone; a typed time is kept. */
export function resolveDeadline(input: DeadlineInput | undefined): { at: string | null; hasTime: boolean } | undefined {
  if (input === undefined) return undefined;
  if (input === null) return { at: null, hasTime: false };
  if (input.kind === 'datetime') return { at: new Date(input.at).toISOString(), hasTime: true };
  if (!isTimeZone(input.timeZone)) {
    throw badRequest('VALIDATION_ERROR', `Unknown time zone "${input.timeZone}"`, { field: 'deadline.timeZone' });
  }
  return { at: endOfLocalDay(input.date, input.timeZone), hasTime: false };
}

async function linksOf(tx: Tx, taskIds: string[]) {
  const records = new Map<string, RecordRef[]>(taskIds.map((id) => [id, []]));
  const assignees = new Map<string, string[]>(taskIds.map((id) => [id, []]));
  if (taskIds.length === 0) return { records, assignees };
  const recordRows = await tx.db
    .selectFrom('task_records')
    .select(['task_id', 'entity_definition_id', 'entity_instance_id'])
    .where('task_id', 'in', taskIds)
    .orderBy('task_id')
    .orderBy('position')
    .execute();
  for (const r of recordRows) {
    records
      .get(r.task_id)
      ?.push({ entityDefinitionId: r.entity_definition_id, entityInstanceId: r.entity_instance_id });
  }
  const assigneeRows = await tx.db
    .selectFrom('task_assignees')
    .select(['task_id', 'member_id'])
    .where('task_id', 'in', taskIds)
    .orderBy('task_id')
    .orderBy('position')
    .execute();
  for (const a of assigneeRows) assignees.get(a.task_id)?.push(a.member_id);
  return { records, assignees };
}

/** Live linked records only (links to deleted / merged-away records stay stored but are not shown). */
async function liveRecordIds(tx: Tx, refs: RecordRef[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const rows = await tx.db
    .selectFrom('entity_instances')
    .select('id')
    .where(
      'id',
      'in',
      refs.map((r) => r.entityInstanceId),
    )
    .where('archived_at', 'is', null)
    .where('merged_at', 'is', null)
    .execute();
  return new Set(rows.map((r) => r.id));
}

async function hydrate(tx: Tx, deps: CollabDeps, rows: TaskRow[]): Promise<Task[]> {
  const { records, assignees } = await linksOf(
    tx,
    rows.map((r) => r.id),
  );
  const allRefs = [...records.values()].flat();
  const live = await liveRecordIds(tx, allRefs);
  const readable = await readableDefinitions(
    tx,
    deps,
    allRefs.map((r) => r.entityDefinitionId),
  );
  const out: Task[] = [];
  for (const r of rows) {
    const links = (records.get(r.id) ?? []).filter((l) => live.has(l.entityInstanceId));
    // Hidden when every live linked record is unreadable (a task without links is visible to everyone).
    if (links.length > 0 && !links.some((l) => readable.has(l.entityDefinitionId))) continue;
    out.push({
      id: r.id,
      workspaceId: r.workspace_id,
      content: { text: r.content, mentions: (r.mentions ?? []) as Mention[] },
      deadlineAt: r.deadline_at,
      deadlineHasTime: r.deadline_has_time,
      isCompleted: r.completed_at !== null,
      completedAt: r.completed_at,
      completedBy: toActorOrNull(r.completed_by),
      assigneeMemberIds: assignees.get(r.id) ?? [],
      linkedRecords: links.filter((l) => readable.has(l.entityDefinitionId)),
      createdBy: toActor(r.created_by),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  }
  return out;
}

async function requireRow(tx: Tx, taskId: string): Promise<TaskRow> {
  const row = await tx.db
    .selectFrom('tasks')
    .selectAll()
    .where('id', '=', taskId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw taskNotFound(taskId);
  return row;
}

async function oneTask(tx: Tx, deps: CollabDeps, taskId: string): Promise<Task> {
  const [task] = await hydrate(tx, deps, [await requireRow(tx, taskId)]);
  if (!task) throw taskNotFound(taskId);
  return task;
}

/** Members must exist in the workspace (suspended members can still hold tasks). */
async function verifyMembers(tx: Tx, memberIds: string[]): Promise<string[]> {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return unique;
  const rows = await tx.db.selectFrom('workspace_members').select('id').where('id', 'in', unique).execute();
  const found = new Set(rows.map((r) => r.id));
  const missing = unique.find((m) => !found.has(m));
  if (missing) throw valueError('assignees', 'unknown-member', `Workspace member ${missing} does not exist`);
  return unique;
}

function mentionedMembers(content: PlainTextContent): string[] {
  return [...new Set(content.mentions.flatMap((m) => (m.kind === 'workspace-member' ? [m.memberId] : [])))];
}

function mentionedRecords(content: PlainTextContent) {
  return content.mentions.flatMap((m) =>
    m.kind === 'record' ? [{ entityDefinitionId: m.entityDefinitionId, entityInstanceId: m.entityInstanceId }] : [],
  );
}

async function writeLinks(tx: Tx, taskId: string, records: RecordRef[] | undefined, assignees: string[] | undefined) {
  if (records !== undefined) {
    await tx.db.deleteFrom('task_records').where('task_id', '=', taskId).execute();
    if (records.length > 0) {
      await tx.db
        .insertInto('task_records')
        .values(
          positioned(records).map((r) => ({
            task_id: taskId,
            workspace_id: tx.workspaceId,
            entity_definition_id: r.entityDefinitionId,
            entity_instance_id: r.entityInstanceId,
            position: r.position,
          })),
        )
        .execute();
    }
  }
  if (assignees !== undefined) {
    await tx.db.deleteFrom('task_assignees').where('task_id', '=', taskId).execute();
    if (assignees.length > 0) {
      await tx.db
        .insertInto('task_assignees')
        .values(
          assignees.map((memberId, position) => ({
            task_id: taskId,
            workspace_id: tx.workspaceId,
            member_id: memberId,
            position,
          })),
        )
        .execute();
    }
  }
}

/** Invalidations: the task, task queries (linked records, assignees) and the linked records' timelines. */
function emitTask(tx: Tx, taskId: string, records: RecordRef[], memberIds: string[]): void {
  tx.emit('task', taskId, { taskId });
  tx.emit('task-list', null, {
    entityInstanceIds: records.map((r) => r.entityInstanceId),
    memberIds,
  });
  emitTimelines(tx, records);
}

async function currentLinks(tx: Tx, taskId: string) {
  const { records, assignees } = await linksOf(tx, [taskId]);
  return { records: records.get(taskId) ?? [], assignees: assignees.get(taskId) ?? [] };
}

function completionColumns(tx: Tx, completed: boolean) {
  return completed ? { completed_at: tx.now, completed_by: actorJson(tx) } : { completed_at: null, completed_by: null };
}

async function setCompleted(tx: Tx, taskIds: string[], completed: boolean): Promise<string[]> {
  if (taskIds.length === 0) return [];
  // Only rows whose state changes: re-completing keeps the original completion time and actor.
  const changed = await tx.db
    .updateTable('tasks')
    .set({ ...completionColumns(tx, completed), updated_at: tx.now })
    .where('id', 'in', taskIds)
    .where('deleted_at', 'is', null)
    .where('completed_at', completed ? 'is' : 'is not', null)
    .returning('id')
    .execute();
  return changed.map((c) => c.id);
}

async function memberWeekStart(tx: Tx, explicit: number | undefined): Promise<WeekDay> {
  if (explicit !== undefined) return explicit as WeekDay;
  const memberId = tx.ctx.actor.type === 'workspace-member' ? tx.ctx.actor.id : null;
  if (!memberId) return 1;
  const prefs = await tx.db
    .selectFrom('member_preferences')
    .select(['week_start_day', 'locale'])
    .where('member_id', '=', memberId)
    .executeTakeFirst();
  if (prefs?.week_start_day !== null && prefs?.week_start_day !== undefined) return prefs.week_start_day as WeekDay;
  return weekStartForLocale(prefs?.locale ?? null);
}

const byDeadline = (dir: 1 | -1) => (a: Task, b: Task) => {
  if (a.deadlineAt === b.deadlineAt) return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  if (a.deadlineAt === null) return 1; // no deadline last
  if (b.deadlineAt === null) return -1;
  return a.deadlineAt < b.deadlineAt ? -dir : dir;
};

export const taskOps = {
  async create(
    tx: Tx,
    deps: CollabDeps,
    input: CreateTaskInput,
    options: { createdAt?: string; requireNew?: boolean } = {},
  ): Promise<Task> {
    const data = createTaskInputSchema.parse(input);
    const existing = await tx.db
      .selectFrom('tasks')
      .select(['id', 'deleted_at'])
      .where('id', '=', data.id)
      .executeTakeFirst();
    if (existing) {
      if (options.requireNew) throw conflict('ID_CONFLICT', 'Task create execution cannot reuse an existing task');
      if (existing.deleted_at !== null) throw conflict('ID_CONFLICT', 'This task id belonged to a deleted task');
      return oneTask(tx, deps, data.id);
    }
    const records = await resolveRecordRefs(tx, deps, [...data.linkedRecords, ...mentionedRecords(data.content)], {
      what: 'linked_record',
    });
    const assignees = await verifyMembers(tx, data.assigneeMemberIds);
    const deadline = resolveDeadline(data.deadline) as { at: string | null; hasTime: boolean };
    await tx.db
      .insertInto('tasks')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        content: data.content.text,
        mentions: jsonb(data.content.mentions),
        mentioned_member_ids: mentionedMembers(data.content),
        deadline_at: deadline.at,
        deadline_has_time: deadline.hasTime,
        ...completionColumns(tx, data.isCompleted),
        created_by: actorJson(tx),
        created_at: options.createdAt ?? tx.now,
        updated_at: tx.now,
      })
      .execute();
    await writeLinks(tx, data.id, records, assignees);
    emitTask(tx, data.id, records, assignees);
    taskEvent(tx, 'created', data.id);
    await notifyTaskAssigned(tx, deps.policies, data.id, assignees, records);
    return oneTask(tx, deps, data.id);
  },

  /** Edit dialog save: every given field replaces the stored one (E README §3.3). */
  async update(tx: Tx, deps: CollabDeps, input: UpdateTaskInput): Promise<Task> {
    const data = updateTaskInputSchema.parse(input);
    const row = await requireRow(tx, data.taskId);
    const before = await currentLinks(tx, row.id);
    let records: RecordRef[] | undefined;
    if (data.linkedRecords !== undefined || data.content !== undefined) {
      const content = data.content;
      const base = data.linkedRecords ?? before.records;
      const fresh = await resolveRecordRefs(
        tx,
        deps,
        [...(data.linkedRecords ?? []), ...(content ? mentionedRecords(content) : [])],
        { what: 'linked_record' },
      );
      // Kept links that were not re-sent (only when linkedRecords is omitted) need no re-validation.
      records =
        data.linkedRecords !== undefined
          ? fresh
          : [...base, ...fresh.filter((f) => !base.some((b) => b.entityInstanceId === f.entityInstanceId))];
    }
    const assignees =
      data.assigneeMemberIds !== undefined ? await verifyMembers(tx, data.assigneeMemberIds) : undefined;
    const deadline = resolveDeadline(data.deadline);
    await tx.db
      .updateTable('tasks')
      .set({
        ...(data.content
          ? {
              content: data.content.text,
              mentions: jsonb(data.content.mentions),
              mentioned_member_ids: mentionedMembers(data.content),
            }
          : {}),
        ...(deadline ? { deadline_at: deadline.at, deadline_has_time: deadline.hasTime } : {}),
        updated_at: tx.now,
      })
      .where('id', '=', row.id)
      .execute();
    if (data.isCompleted !== undefined) await setCompleted(tx, [row.id], data.isCompleted);
    await writeLinks(tx, row.id, records, assignees);
    emitTask(tx, row.id, [...before.records, ...(records ?? [])], [...before.assignees, ...(assignees ?? [])]);
    taskEvent(tx, 'updated', row.id);
    if (assignees !== undefined) {
      const added = assignees.filter((m) => !before.assignees.includes(m));
      await notifyTaskAssigned(tx, deps.policies, row.id, added, records ?? before.records);
    }
    return oneTask(tx, deps, row.id);
  },

  /** Checkbox click (optimistic on the client): returns the canonical task. */
  async setCompleted(tx: Tx, deps: CollabDeps, input: SetTaskCompletedInput): Promise<Task> {
    const data = setTaskCompletedInputSchema.parse(input);
    await requireRow(tx, data.taskId);
    const changed = await setCompleted(tx, [data.taskId], data.completed);
    if (changed.length > 0) {
      const links = await currentLinks(tx, data.taskId);
      emitTask(tx, data.taskId, links.records, links.assignees);
      taskEvent(tx, 'updated', data.taskId);
    }
    return oneTask(tx, deps, data.taskId);
  },

  /** `tasks/v2/batch/completion` (E README §3.3). Unknown ids are ignored. */
  async bulkSetCompleted(tx: Tx, deps: CollabDeps, input: BulkSetTasksCompletedInput): Promise<{ tasks: Task[] }> {
    const data = bulkSetTasksCompletedInputSchema.parse(input);
    const changed = await setCompleted(tx, data.taskIds, data.completed);
    const { records, assignees } = await linksOf(tx, changed);
    for (const id of changed) {
      emitTask(tx, id, records.get(id) ?? [], assignees.get(id) ?? []);
      taskEvent(tx, 'updated', id);
    }
    const rows = await tx.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', 'in', data.taskIds)
      .where('deleted_at', 'is', null)
      .execute();
    return { tasks: await hydrate(tx, deps, rows) };
  },

  async delete(tx: Tx, taskIds: string[]): Promise<{ deletedIds: string[] }> {
    if (taskIds.length === 0) return { deletedIds: [] };
    const deleted = await tx.db
      .updateTable('tasks')
      .set({ deleted_at: tx.now, deleted_by: actorJson(tx) })
      .where('id', 'in', taskIds)
      .where('deleted_at', 'is', null)
      .returning('id')
      .execute();
    const ids = deleted.map((d) => d.id);
    const { records, assignees } = await linksOf(tx, ids);
    for (const id of ids) {
      emitTask(tx, id, records.get(id) ?? [], assignees.get(id) ?? []);
      taskEvent(tx, 'deleted', id);
    }
    return { deletedIds: ids };
  },

  async get(tx: Tx, deps: CollabDeps, taskId: string): Promise<Task> {
    return oneTask(tx, deps, taskId);
  },

  async batchGet(tx: Tx, deps: CollabDeps, taskIds: string[]): Promise<{ tasks: Task[] }> {
    const rows = await tx.db
      .selectFrom('tasks')
      .selectAll()
      .where('id', 'in', taskIds)
      .where('deleted_at', 'is', null)
      .execute();
    const order = new Map(taskIds.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return { tasks: await hydrate(tx, deps, rows) };
  },

  /** Tasks page / record Tasks tab with groups computed in the viewer's zone (E README §2.6, X-09, X-10). */
  async list(tx: Tx, deps: CollabDeps, input: ListTasksInput): Promise<ListTasksOutput> {
    const data = listTasksInputSchema.parse(input);
    if (!isTimeZone(data.timeZone)) {
      throw badRequest('VALIDATION_ERROR', `Unknown time zone "${data.timeZone}"`, { field: 'timeZone' });
    }
    const weekStart = await memberWeekStart(tx, data.weekStartDay);
    const now = data.now ?? tx.now;
    const bounds = taskBucketBounds(now, data.timeZone, weekStart);
    const filter = data.filter;
    const records = filter.records ? await resolveRecordRefs(tx, deps, filter.records.records) : [];
    let query = tx.db.selectFrom('tasks as t').selectAll('t').where('t.deleted_at', 'is', null);
    if (!data.showCompleted || filter.isCompleted === false) query = query.where('t.completed_at', 'is', null);
    if (filter.isCompleted === true) query = query.where('t.completed_at', 'is not', null);
    if (filter.createdByMemberIds) {
      query = query.where(sql<boolean>`t.created_by ->> 'id' = ANY(${filter.createdByMemberIds}::text[])`);
    }
    if (filter.assignees) {
      const has = sql<boolean>`EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id
        AND a.member_id = ANY(${filter.assignees.memberIds}::uuid[]))`;
      query = query.where(filter.assignees.operator === 'is' ? has : sql<boolean>`NOT ${has}`);
    }
    if (filter.unassigned) {
      query = query.where(sql<boolean>`NOT EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id)`);
    }
    if (filter.records && records.length > 0) {
      const ids = records.map((r) => r.entityInstanceId);
      const has = sql<boolean>`EXISTS (SELECT 1 FROM task_records r WHERE r.task_id = t.id
        AND r.entity_instance_id = ANY(${ids}::uuid[]))`;
      query = query.where(filter.records.operator === 'is' ? has : sql<boolean>`NOT ${has}`);
    }
    const rows = await query.orderBy('t.created_at').orderBy('t.id').limit(data.limit).execute();
    const tasks = await hydrate(tx, deps, rows);

    const dir = data.sort.direction === 'asc' ? 1 : -1;
    const sorted = [...tasks];
    if (data.sort.field === 'deadline') sorted.sort(byDeadline(dir));
    else if (data.sort.field === 'created-at')
      sorted.sort((a, b) => (a.createdAt < b.createdAt ? -dir : a.createdAt > b.createdAt ? dir : 0));
    else
      sorted.sort((a, b) =>
        (a.assigneeMemberIds[0] ?? '') < (b.assigneeMemberIds[0] ?? '')
          ? -dir
          : (a.assigneeMemberIds[0] ?? '') > (b.assigneeMemberIds[0] ?? '')
            ? dir
            : 0,
      );

    const groups: TaskGroup[] = [];
    const push = (key: string, memberId: string | null, items: Task[]) => {
      if (items.length > 0) groups.push({ key, memberId, tasks: items });
    };
    if (data.groupBy === 'deadline') {
      for (const bucket of taskBuckets) {
        // Buckets are sorted by deadline ascending.
        const items = sorted.filter((t) => taskBucketOf(t, bounds) === bucket);
        push(bucket, null, data.sort.field === 'deadline' ? items : items.sort(byDeadline(1)));
      }
    } else if (data.groupBy === 'assignee') {
      // One group per assignee (a task with several assignees appears in each); completed tasks stay inline.
      const keys = [...new Set(sorted.flatMap((t) => (t.assigneeMemberIds.length ? t.assigneeMemberIds : ['none'])))];
      for (const key of keys) {
        const items = sorted.filter((t) =>
          key === 'none' ? t.assigneeMemberIds.length === 0 : t.assigneeMemberIds.includes(key),
        );
        // Within a group: no-deadline tasks first, then by deadline ascending (E README §2.6).
        items.sort((a, b) => (a.deadlineAt === null ? -1 : b.deadlineAt === null ? 1 : byDeadline(1)(a, b)));
        push(key, key === 'none' ? null : key, items);
      }
    } else if (data.groupBy === 'created-by') {
      const keyOf = (t: Task) => (t.createdBy.type === 'workspace-member' && t.createdBy.id ? t.createdBy.id : 'none');
      for (const key of [...new Set(sorted.map(keyOf))])
        push(
          key,
          key === 'none' ? null : key,
          sorted.filter((t) => keyOf(t) === key),
        );
    } else if (data.groupBy === 'created-at') {
      const ranges = createdBucketRanges(now, data.timeZone, weekStart);
      for (const range of ranges)
        push(
          range.key,
          null,
          sorted.filter((t) => createdBucketOf(t.createdAt, ranges) === range.key),
        );
    } else {
      push('all', null, sorted);
    }
    return { groups, total: tasks.length, bounds };
  },

  /** Sidebar badge (E README §2.6): my incomplete tasks due by the end of today. */
  async countDue(tx: Tx, deps: CollabDeps, input: CountDueTasksInput): Promise<{ count: number }> {
    const data = countDueTasksInputSchema.parse(input);
    if (!isTimeZone(data.timeZone)) {
      throw badRequest('VALIDATION_ERROR', `Unknown time zone "${data.timeZone}"`, { field: 'timeZone' });
    }
    const memberId = data.memberId ?? (tx.ctx.actor.type === 'workspace-member' ? tx.ctx.actor.id : null);
    if (!memberId) return { count: 0 };
    const bounds = taskBucketBounds(data.now ?? tx.now, data.timeZone, 1);
    const rows = await tx.db
      .selectFrom('tasks as t')
      .innerJoin('task_assignees as a', 'a.task_id', 't.id')
      .selectAll('t')
      .where('a.member_id', '=', memberId)
      .where('t.deleted_at', 'is', null)
      .where('t.completed_at', 'is', null)
      .where('t.deadline_at', '<=', bounds.endOfToday)
      .execute();
    return { count: (await hydrate(tx, deps, rows)).length };
  },
};
