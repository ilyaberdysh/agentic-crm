// Tasks (E README §6; data-model-documented §5.2): list (sort, linked record, assignee, completion filters), create,
// get, update (deadline, completion, linked records, assignees — content is not updatable), delete.
import type { RecordRef, Task } from '@agentic-crm/contracts';
import {
  createTaskBody,
  getTaskPathParams,
  listTasksQuery,
  updateTaskBody,
  v2Operations,
} from '@agentic-crm/contracts/v2';
import { newId } from '@agentic-crm/domain';
import { taskToPublic } from '../collab-mappers';
import type { V2Context } from '../context';
import { PublicApiError, publicErrors, withHints } from '../errors';
import { params, parseInput, type RouteSpec } from '../route';

const DEFAULT_LIMIT = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const taskNotFound = (id: string) => publicErrors.notFound(`Task with ID "${id}" not found.`);

function taskId(raw: Record<string, string>): string {
  const parsed = getTaskPathParams.safeParse(raw);
  if (!parsed.success) throw taskNotFound(raw.task_id ?? '');
  return parsed.data.task_id.toLowerCase();
}

async function getTask(v2: V2Context, id: string): Promise<Task> {
  try {
    return await v2.domain.tasks.get(v2.ctx, id);
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) throw taskNotFound(id);
    throw err;
  }
}

/** One record by a unique attribute value (`findByUniqueValues`), or 404. */
async function recordByUnique(v2: V2Context, object: string, attribute: string, value: unknown): Promise<RecordRef> {
  const def = await v2.object(object);
  const { entityInstanceIds } = await withHints({ object }, () =>
    v2.domain.records.findByUniqueValues(v2.ctx, {
      entityDefinitionId: def.id,
      attributeDefinitionId: attribute,
      values: [{ value }],
    }),
  );
  const id = entityInstanceIds[0];
  if (!id) throw publicErrors.notFound(`No ${def.singularNoun.toLowerCase()} record matches "${String(value)}".`);
  return { entityDefinitionId: def.id, entityInstanceId: id };
}

/**
 * `linked_records` forms (create-a-task): email addresses (people) and domains (companies) as strings,
 * `{target_object, target_record_id}`, or `{target_object, <unique attribute>: [values]}`.
 */
async function linkedRecords(v2: V2Context, items: unknown[]): Promise<RecordRef[]> {
  const out: RecordRef[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      out.push(
        item.includes('@')
          ? await recordByUnique(v2, 'people', 'email_addresses', item)
          : await recordByUnique(v2, 'companies', 'domains', item),
      );
      continue;
    }
    const o = (item ?? {}) as Record<string, unknown>;
    if (typeof o.target_object !== 'string')
      throw publicErrors.validation('linked_records items need a target_object.');
    const def = await v2.object(o.target_object);
    if (typeof o.target_record_id === 'string') {
      if (!UUID.test(o.target_record_id)) throw publicErrors.recordNotFound(o.target_record_id);
      out.push({ entityDefinitionId: def.id, entityInstanceId: o.target_record_id.toLowerCase() });
      continue;
    }
    const [attribute, values] = Object.entries(o).find(([k]) => k !== 'target_object') ?? [];
    if (!attribute || !Array.isArray(values) || values.length === 0) {
      throw publicErrors.validation('linked_records items need target_record_id or a matching attribute.');
    }
    const attr = await v2.attribute(def, attribute);
    const first = values[0] as Record<string, unknown>;
    const value = first.email_address ?? first.domain ?? first.original_phone_number ?? first.value ?? first;
    out.push(await recordByUnique(v2, def.apiSlug, attr.id, value));
  }
  return out;
}

/**
 * `linked_records` as sent: the generated schema validates them, but its all-optional value objects would strip the
 * matching values (`{email_address}` parses as the `{domain?}` alternative), so the raw items are resolved.
 */
function rawLinkedRecords(body: unknown): unknown[] {
  const items = (body as { data?: { linked_records?: unknown } } | null)?.data?.linked_records;
  return Array.isArray(items) ? items : [];
}

async function assigneeIds(v2: V2Context, items: unknown[]): Promise<string[]> {
  const members = await v2.workspaceMembers();
  return items.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    if (typeof o.workspace_member_email_address === 'string') {
      const email = o.workspace_member_email_address.toLowerCase();
      const member = members.find((m) => m.emailAddress.toLowerCase() === email);
      if (!member) throw publicErrors.notFound(`Workspace member with email "${email}" not found.`);
      return member.id;
    }
    if (o.referenced_actor_type !== 'workspace-member' || typeof o.referenced_actor_id !== 'string') {
      throw publicErrors.validation('Only workspace members can be assigned to tasks.');
    }
    const member = members.find((m) => m.id === String(o.referenced_actor_id).toLowerCase());
    if (!member) throw publicErrors.memberNotFound(String(o.referenced_actor_id));
    return member.id;
  });
}

function deadline(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw publicErrors.validation('deadline_at must be an ISO 8601 timestamp or null.');
  return { kind: 'datetime' as const, at: new Date(t).toISOString() };
}

/** Linking something that is not a record (e.g. a task or member) is the public API's 400 limit_reached. */
async function assertRecordObjects(v2: V2Context, refs: RecordRef[]): Promise<void> {
  for (const ref of refs) {
    const def = await v2.definitionById(ref.entityDefinitionId);
    if (!def || !['person-record', 'company-record', 'standard-object', 'custom-record'].includes(def.entityType)) {
      throw new PublicApiError(
        400,
        'invalid_request_error',
        'limit_reached',
        'Only standard or custom object records can be linked to.',
      );
    }
  }
}

export const taskRoutes: RouteSpec[] = [
  {
    method: 'GET',
    url: '/tasks',
    operationId: 'listTasks',
    scopes: v2Operations.listTasks.scopes,
    async handler(v2, request) {
      const query = parseInput(listTasksQuery, request.query, 'query parameters');
      if ((query.linked_object === undefined) !== (query.linked_record_id === undefined)) {
        throw publicErrors.validation('linked_object and linked_record_id must be provided together.');
      }
      const filter: Record<string, unknown> = {};
      if (query.linked_object && query.linked_record_id) {
        const def = await v2.object(query.linked_object);
        filter.records = {
          operator: 'is',
          records: [{ entityDefinitionId: def.id, entityInstanceId: query.linked_record_id }],
        };
      }
      const rawAssignee = (request.query as Record<string, unknown>).assignee;
      if (rawAssignee !== undefined) {
        if (rawAssignee === '' || rawAssignee === 'null' || query.assignee === null) {
          filter.unassigned = true;
        } else {
          const members = await v2.workspaceMembers();
          const key = String(query.assignee).toLowerCase();
          const member = members.find((m) => m.id === key || m.emailAddress.toLowerCase() === key);
          if (!member) return { data: [] };
          filter.assignees = { operator: 'is', memberIds: [member.id] };
        }
      }
      if (query.is_completed !== undefined) filter.isCompleted = query.is_completed;
      const result = await withHints({}, () => v2.domain.tasks.list(v2.ctx, { groupBy: 'none', filter, limit: 5000 }));
      const tasks = result.groups.flatMap((g) => g.tasks);
      const sort = query.sort ?? 'created_at:asc';
      const by = (a: string | null, b: string | null) =>
        a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
      tasks.sort((a, b) => {
        switch (sort) {
          case 'created_at:desc':
            return by(b.createdAt, a.createdAt);
          case 'completed_at:asc':
            // Incomplete first, then completed oldest first.
            return a.isCompleted !== b.isCompleted
              ? a.isCompleted
                ? 1
                : -1
              : by(a.completedAt, b.completedAt) || by(a.createdAt, b.createdAt);
          case 'completed_at:desc':
            // Completed newest first, then incomplete.
            return a.isCompleted !== b.isCompleted
              ? a.isCompleted
                ? -1
                : 1
              : by(b.completedAt, a.completedAt) || by(a.createdAt, b.createdAt);
          default:
            return by(a.createdAt, b.createdAt);
        }
      });
      const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
      const limit = Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 0);
      return { data: tasks.slice(offset, offset + limit).map(taskToPublic) };
    },
  },
  {
    method: 'POST',
    url: '/tasks',
    operationId: 'createTask',
    scopes: v2Operations.createTask.scopes,
    async handler(v2, request) {
      const { data } = parseInput(createTaskBody, request.body, 'request body');
      if (data.content.trim() === '') throw publicErrors.validation('content must not be empty.');
      const records = await linkedRecords(v2, rawLinkedRecords(request.body));
      await assertRecordObjects(v2, records);
      const assignees = await assigneeIds(v2, data.assignees);
      const task = await withHints({}, () =>
        v2.domain.tasks.create(v2.ctx, {
          id: newId(),
          content: { text: data.content, mentions: [] },
          deadline: deadline(data.deadline_at) ?? null,
          isCompleted: data.is_completed,
          linkedRecords: records,
          assigneeMemberIds: assignees,
        }),
      );
      return { data: taskToPublic(task) };
    },
  },
  {
    method: 'GET',
    url: '/tasks/:task_id',
    operationId: 'getTask',
    scopes: v2Operations.getTask.scopes,
    async handler(v2, request) {
      return { data: taskToPublic(await getTask(v2, taskId(params(request)))) };
    },
  },
  {
    method: 'PATCH',
    url: '/tasks/:task_id',
    operationId: 'updateTask',
    scopes: v2Operations.updateTask.scopes,
    async handler(v2, request) {
      const id = taskId(params(request));
      const { data } = parseInput(updateTaskBody, request.body, 'request body');
      await getTask(v2, id);
      const records =
        data.linked_records !== undefined ? await linkedRecords(v2, rawLinkedRecords(request.body)) : undefined;
      if (records) await assertRecordObjects(v2, records);
      const assignees = data.assignees !== undefined ? await assigneeIds(v2, data.assignees) : undefined;
      const due = deadline(data.deadline_at);
      const task = await withHints({}, () =>
        v2.domain.tasks.update(v2.ctx, {
          taskId: id,
          ...(due !== undefined ? { deadline: due } : {}),
          ...(data.is_completed !== undefined ? { isCompleted: data.is_completed } : {}),
          ...(records ? { linkedRecords: records } : {}),
          ...(assignees ? { assigneeMemberIds: assignees } : {}),
        }),
      );
      return { data: taskToPublic(task) };
    },
  },
  {
    method: 'DELETE',
    url: '/tasks/:task_id',
    operationId: 'deleteTask',
    scopes: v2Operations.deleteTask.scopes,
    async handler(v2, request) {
      const id = taskId(params(request));
      await getTask(v2, id);
      await withHints({}, () => v2.domain.tasks.delete(v2.ctx, [id]));
      return {};
    },
  },
];
