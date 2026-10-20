// Record activity timeline (contract E2; D README §3.8, A README §4.14, CROSS-DOMAIN B.26). Events are derived on read
// from the stored history — nothing is written for the timeline itself:
//   updates   record created (or merged into existence), attribute changes (one event per transaction and actor, with
//             the values that became active and the values retired, I6)
//   lists     entries of the record (collection-entry instances whose parent_record points at it): added, removed,
//             entry attribute changes
//   notes     notes linked to the record · tasks: added / completed / overdue (past) and upcoming (forwards)
//   comments  comments on the record · files: files added to the record
// Past events page backwards from a cursor (default 100); upcoming events page forwards (default 3).
import {
  type Actor,
  type AttributeChange,
  type AttributeValue,
  EVENT_CATEGORY,
  type EventCategory,
  eventCategories,
  type ListTimelineInput,
  type ListTimelineOutput,
  listTimelineInputSchema,
  type TimelineEvent,
  type TimelineItem,
} from '@agentic-crm/contracts';
import { type AttributeValuesTable, type Selectable, sql } from '@agentic-crm/db';
import { decodeActor } from '../actors.ts';
import { badRequest, notFound } from '../errors.ts';
import { meetingEvents } from '../meetings/timeline.ts';
import { toAttributeValue } from '../records/engine.ts';
import { type AttrDef, type DefInfo, loadDefinition, loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { type CollabDeps, toActor, toActorOrNull } from './common.ts';

type ValueRow = Selectable<AttributeValuesTable>;

/** System-maintained attributes whose changes are not activity (record id, created_*, list entries, next due task). */
const HIDDEN_SYSTEM_TYPES = new Set([
  'id',
  'created-at',
  'created-by',
  'list-entries',
  'next-due-task',
  'entry-parent-record',
]);
const PAST_LIMIT = 100;
const UPCOMING_LIMIT = 3;
/** Consecutive changes by the same member within this window read as one event ("changed 3 attributes"). */
const MERGE_WINDOW_MS = 15 * 60 * 1000;

interface Cursor {
  t: string;
  key: string;
}

/** Any ISO instant → the database's format ('…T12:00:00.123456Z'), so instants also compare as strings. */
export function normIso(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (m) return `${m[1]}.${(m[2] ?? '').padEnd(6, '0').slice(0, 6)}Z`;
  return new Date(value).toISOString().replace('Z', '000Z');
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.t, c.key])).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const [t, key] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as [unknown, unknown];
    if (typeof t === 'string' && typeof key === 'string' && !Number.isNaN(Date.parse(t))) return { t: normIso(t), key };
  } catch {
    // fall through
  }
  throw badRequest('VALIDATION_ERROR', 'Invalid timeline cursor', { field: 'cursor' });
}

/** (t, key) ordering: later instants first; ties by key (descending in past mode). */
function compare(a: Cursor, b: Cursor): number {
  const ta = Date.parse(a.t);
  const tb = Date.parse(b.t);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.t !== b.t) return a.t < b.t ? -1 : 1; // microsecond precision
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

const cursorOf = (e: TimelineEvent): Cursor => ({ t: e.occurredAt, key: e.id });

function base(id: string, occurredAt: string, actor: Actor | null, eventType: TimelineEvent['eventType']) {
  return {
    id,
    category: EVENT_CATEGORY[eventType],
    occurredAt,
    actor,
    isBackground: actor === null || actor.type !== 'workspace-member',
  };
}

function visibleAttrs(def: DefInfo): AttrDef[] {
  return def.attrs.filter(
    (a) => !a.isHidden && a.type !== 'interaction' && !HIDDEN_SYSTEM_TYPES.has(a.systemAttributeType ?? ''),
  );
}

interface ChangeGroup {
  instanceId: string;
  t: string;
  actor: Actor | null;
  changes: AttributeChange[];
}

/**
 * Attribute changes of instances after their creation, grouped per (instance, instant, actor): newest `limit` groups
 * at or before `upTo`.
 */
async function changeGroups(
  tx: Tx,
  defs: Map<string, DefInfo>,
  instances: { id: string; entityDefinitionId: string; createdAt: string }[],
  upTo: string,
  limit: number,
): Promise<ChangeGroup[]> {
  if (instances.length === 0) return [];
  const attrIds = [
    ...new Set(instances.flatMap((i) => visibleAttrs(defs.get(i.entityDefinitionId) as DefInfo).map((a) => a.id))),
  ];
  if (attrIds.length === 0) return [];
  const ids = instances.map((i) => i.id);
  const { rows: groups } = await sql<{
    instance_id: string;
    t: string;
    actor_type: number | null;
    actor_id: string | null;
  }>`
    SELECT DISTINCT g.instance_id, g.t, g.actor_type, g.actor_id FROM (
      SELECT v.instance_id, v.active_from AS t, v.created_by_type AS actor_type, v.created_by_id AS actor_id
      FROM attribute_values v JOIN entity_instances i ON i.id = v.instance_id
      WHERE v.instance_id = ANY(${ids}::uuid[]) AND v.attribute_id = ANY(${attrIds}::uuid[])
        AND v.active_from > i.created_at AND v.active_from <= ${upTo}::timestamptz
      UNION
      SELECT v.instance_id, v.active_until, v.deactivated_by_type, v.deactivated_by_id
      FROM attribute_values v
      WHERE v.instance_id = ANY(${ids}::uuid[]) AND v.attribute_id = ANY(${attrIds}::uuid[])
        AND v.active_until IS NOT NULL AND v.active_until <= ${upTo}::timestamptz
    ) g
    ORDER BY g.t DESC, g.instance_id DESC
    LIMIT ${limit}`.execute(tx.db);
  if (groups.length === 0) return [];
  const ts = [...new Set(groups.map((g) => g.t))];
  const rows = await tx.db
    .selectFrom('attribute_values')
    .selectAll()
    .where('instance_id', 'in', ids)
    .where('attribute_id', 'in', attrIds)
    .where((eb) => eb.or([eb('active_from', 'in', ts), eb('active_until', 'in', ts)]))
    .orderBy('sort_order')
    .orderBy('active_from')
    .orderBy('id')
    .execute();
  const instanceDef = new Map(instances.map((i) => [i.id, i.entityDefinitionId]));
  const toValue = (row: ValueRow): AttributeValue | null => {
    const attr = defs.get(instanceDef.get(row.instance_id) as string)?.byId.get(row.attribute_id);
    return attr ? toAttributeValue(attr, row) : null;
  };
  return groups.map((g) => {
    const actor = decodeActor(g.actor_type, g.actor_id);
    const byAttr = new Map<string, AttributeChange>();
    const slot = (attrId: string) => {
      let change = byAttr.get(attrId);
      if (!change) {
        change = { attributeDefinitionId: attrId, added: [], removed: [] };
        byAttr.set(attrId, change);
      }
      return change;
    };
    for (const row of rows) {
      if (row.instance_id !== g.instance_id) continue;
      const value = toValue(row);
      if (!value) continue;
      if (row.active_from === g.t && row.created_by_type === g.actor_type && row.created_by_id === g.actor_id) {
        slot(row.attribute_id).added.push(value);
      }
      if (
        row.active_until === g.t &&
        row.deactivated_by_type === g.actor_type &&
        row.deactivated_by_id === g.actor_id
      ) {
        slot(row.attribute_id).removed.push(value);
      }
    }
    // Attribute order of the object (UI order).
    const order = new Map(
      (defs.get(instanceDef.get(g.instance_id) as string)?.attrs ?? []).map((a, i) => [a.id, i] as const),
    );
    const changes = [...byAttr.values()].sort(
      (a, b) => (order.get(a.attributeDefinitionId) ?? 0) - (order.get(b.attributeDefinitionId) ?? 0),
    );
    return { instanceId: g.instance_id, t: g.t, actor, changes };
  });
}

interface RecordInfo {
  id: string;
  def: DefInfo;
  createdAt: string;
  createdBy: Actor | null;
}

/** Every past event source, each limited to the newest `limit` events at or before `upTo`. */
async function pastEvents(
  tx: Tx,
  record: RecordInfo,
  categories: Set<EventCategory>,
  upTo: string,
  now: string,
  limit: number,
): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];
  const R = record.id;

  if (categories.has('updates')) {
    if (record.createdAt <= upTo) {
      const sources = await tx.db
        .selectFrom('entity_instances')
        .select('id')
        .where('merged_into_id', '=', R)
        .orderBy('id')
        .execute();
      events.push(
        sources.length > 0
          ? {
              ...base(`merged:${R}`, record.createdAt, record.createdBy, 'merged'),
              eventType: 'merged',
              mergedFromIds: sources.map((s) => s.id),
            }
          : {
              ...base(`created:${R}`, record.createdAt, record.createdBy, 'entity-instance-created'),
              eventType: 'entity-instance-created',
            },
      );
    }
    const groups = await changeGroups(
      tx,
      new Map([[record.def.id, record.def]]),
      [{ id: R, entityDefinitionId: record.def.id, createdAt: record.createdAt }],
      upTo,
      limit,
    );
    for (const g of groups) {
      if (g.changes.length === 0) continue;
      events.push({
        ...base(`change:${g.t}:${g.actor?.type ?? ''}:${g.actor?.id ?? ''}`, g.t, g.actor, 'attribute-values-updated'),
        eventType: 'attribute-values-updated',
        changes: g.changes,
      });
    }
  }

  if (categories.has('lists')) {
    const { rows: entries } = await sql<{
      id: string;
      entity_definition_id: string;
      created_at: string;
      created_by_type: number;
      created_by_id: string | null;
      archived_at: string | null;
      archived_by_type: number | null;
      archived_by_id: string | null;
    }>`
      SELECT DISTINCT e.id, e.entity_definition_id, e.created_at, e.created_by_type, e.created_by_id, e.archived_at,
             e.archived_by_type, e.archived_by_id
      FROM attribute_values v
      JOIN attribute_definitions a ON a.id = v.attribute_id AND a.system_attribute_type = 'entry-parent-record'
      JOIN entity_instances e ON e.id = v.instance_id
      WHERE v.v_ref = ${R}::uuid AND e.merged_at IS NULL`.execute(tx.db);
    for (const e of entries) {
      const list = { listId: e.entity_definition_id, entryId: e.id };
      if (e.created_at <= upTo) {
        const actor = decodeActor(e.created_by_type, e.created_by_id);
        events.push({
          ...base(`entry:${e.id}`, e.created_at, actor, 'list-entry-created'),
          eventType: 'list-entry-created',
          list,
        });
      }
      if (e.archived_at && e.archived_at <= upTo) {
        const actor = decodeActor(e.archived_by_type, e.archived_by_id);
        events.push({
          ...base(`entry-deleted:${e.id}`, e.archived_at, actor, 'list-entry-deleted'),
          eventType: 'list-entry-deleted',
          list,
        });
      }
    }
    const defs = await loadDefinitionsByIds(
      tx,
      entries.map((e) => e.entity_definition_id),
    );
    const groups = await changeGroups(
      tx,
      defs,
      entries.map((e) => ({ id: e.id, entityDefinitionId: e.entity_definition_id, createdAt: e.created_at })),
      upTo,
      limit,
    );
    const listOf = new Map(entries.map((e) => [e.id, e.entity_definition_id]));
    for (const g of groups) {
      if (g.changes.length === 0) continue;
      events.push({
        ...base(
          `entry-change:${g.instanceId}:${g.t}:${g.actor?.type ?? ''}:${g.actor?.id ?? ''}`,
          g.t,
          g.actor,
          'list-attribute-values-updated',
        ),
        eventType: 'list-attribute-values-updated',
        list: { listId: listOf.get(g.instanceId) as string, entryId: g.instanceId },
        changes: g.changes,
      });
    }
  }

  if (categories.has('notes')) {
    const notes = await tx.db
      .selectFrom('notes as n')
      .innerJoin('note_records as nr', 'nr.note_id', 'n.id')
      .select(['n.id', 'n.created_at', 'n.created_by'])
      .where('nr.entity_instance_id', '=', R)
      .where('n.deleted_at', 'is', null)
      .where('n.created_at', '<=', upTo)
      .orderBy('n.created_at', 'desc')
      .limit(limit)
      .execute();
    for (const n of notes) {
      events.push({
        ...base(`note:${n.id}`, n.created_at, toActor(n.created_by), 'note-added'),
        eventType: 'note-added',
        noteId: n.id,
      });
    }
  }

  if (categories.has('tasks')) {
    const tasks = await tx.db
      .selectFrom('tasks as t')
      .innerJoin('task_records as tr', 'tr.task_id', 't.id')
      .select(['t.id', 't.created_at', 't.created_by', 't.completed_at', 't.completed_by', 't.deadline_at'])
      .where('tr.entity_instance_id', '=', R)
      .where('t.deleted_at', 'is', null)
      .execute();
    for (const t of tasks) {
      if (t.created_at <= upTo) {
        events.push({
          ...base(`task-added:${t.id}`, t.created_at, toActor(t.created_by), 'task-added'),
          eventType: 'task-added',
          taskId: t.id,
        });
      }
      if (t.completed_at && t.completed_at <= upTo) {
        events.push({
          ...base(`task-completed:${t.id}`, t.completed_at, toActorOrNull(t.completed_by), 'task-completed'),
          eventType: 'task-completed',
          taskId: t.id,
        });
      }
      if (!t.completed_at && t.deadline_at && Date.parse(t.deadline_at) <= Date.parse(now) && t.deadline_at <= upTo) {
        events.push({
          ...base(`task-overdue:${t.id}`, t.deadline_at, null, 'task-overdue'),
          isBackground: false,
          eventType: 'task-overdue',
          taskId: t.id,
        });
      }
    }
  }

  if (categories.has('comments')) {
    const comments = await tx.db
      .selectFrom('comments')
      .select(['id', 'thread_id', 'created_at', 'author'])
      .where('entity_instance_id', '=', R)
      .where('deleted_at', 'is', null)
      .where('created_at', '<=', upTo)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    for (const c of comments) {
      events.push({
        ...base(`comment:${c.id}`, c.created_at, toActor(c.author), 'comment-added'),
        eventType: 'comment-added',
        commentId: c.id,
        threadId: c.thread_id,
      });
    }
  }

  if (categories.has('calendar')) {
    events.push(...(await meetingEvents(tx, R, { mode: 'past', upTo, now, limit })));
  }

  if (categories.has('files')) {
    const files = await tx.db
      .selectFrom('storage_entries')
      .select(['id', 'created_at', 'created_by'])
      .where('entity_instance_id', '=', R)
      .where('entry_type', '=', 'file')
      .where('deleted_at', 'is', null)
      .where('created_at', '<=', upTo)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    for (const f of files) {
      events.push({
        ...base(`file:${f.id}`, f.created_at, toActor(f.created_by), 'file-added'),
        eventType: 'file-added',
        fileId: f.id,
      });
    }
  }
  return events;
}

/** Folds consecutive change events of the same member (newest first) into one, within MERGE_WINDOW_MS. */
function mergeConsecutiveChanges(events: TimelineEvent[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const event of events) {
    const prev = out.at(-1);
    if (
      prev &&
      prev.eventType === 'attribute-values-updated' &&
      event.eventType === 'attribute-values-updated' &&
      !event.isBackground &&
      prev.actor?.type === event.actor?.type &&
      prev.actor?.id === event.actor?.id &&
      Date.parse(prev.occurredAt) - Date.parse(event.occurredAt) <= MERGE_WINDOW_MS
    ) {
      // prev is newer: its added values win; the older event's removed values are the original state.
      const byAttr = new Map(prev.changes.map((c) => [c.attributeDefinitionId, { ...c }]));
      for (const c of event.changes) {
        const existing = byAttr.get(c.attributeDefinitionId);
        if (existing) existing.removed = c.removed;
        else byAttr.set(c.attributeDefinitionId, { ...c });
      }
      out[out.length - 1] = { ...prev, changes: [...byAttr.values()] };
      continue;
    }
    out.push(event);
  }
  return out;
}

/** Runs of ≥ 2 consecutive background events become one "{n} automation events" group (D §3.8). */
function groupBackground(events: TimelineEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let run: TimelineEvent[] = [];
  const flush = () => {
    if (run.length >= 2) {
      items.push({
        kind: 'group',
        groupType: 'automation',
        startedAt: (run.at(-1) as TimelineEvent).occurredAt,
        endedAt: (run[0] as TimelineEvent).occurredAt,
        events: run,
      });
    } else {
      for (const e of run) items.push({ kind: 'single', event: e });
    }
    run = [];
  };
  for (const e of events) {
    if (e.isBackground) {
      run.push(e);
      continue;
    }
    flush();
    items.push({ kind: 'single', event: e });
  }
  flush();
  return items;
}

export const timelineOps = {
  async list(tx: Tx, deps: CollabDeps, input: ListTimelineInput): Promise<ListTimelineOutput> {
    const data = listTimelineInputSchema.parse(input);
    const def = await loadDefinition(tx, data.entityDefinitionId);
    await deps.policies.assertCan(tx, def.id, 'read_entity_instance');
    const instance = await tx.db
      .selectFrom('entity_instances')
      .selectAll()
      .where('id', '=', data.entityInstanceId)
      .executeTakeFirst();
    if (
      !instance ||
      instance.entity_definition_id !== def.id ||
      instance.archived_at !== null ||
      instance.merged_at !== null
    ) {
      throw notFound('The requested record could not be found', { entity_instance_id: data.entityInstanceId });
    }
    const categories = new Set<EventCategory>(data.filters ?? eventCategories);
    const now = normIso(data.now ?? tx.now);
    const record: RecordInfo = {
      id: instance.id,
      def,
      createdAt: instance.created_at,
      createdBy: decodeActor(instance.created_by_type, instance.created_by_id),
    };

    const mode = data.mode ?? (data.after !== undefined && data.before === undefined ? 'upcoming' : 'past');
    if (mode === 'upcoming') {
      const limit = data.limit ?? UPCOMING_LIMIT;
      if (!categories.has('tasks') && !categories.has('calendar'))
        return { events: [], nextBefore: null, nextAfter: null };
      const after = data.after ? decodeCursor(data.after) : { t: now, key: '' };
      const meetings = categories.has('calendar')
        ? await meetingEvents(tx, record.id, { mode: 'upcoming', after: after.t, now, limit })
        : [];
      const tasks = !categories.has('tasks')
        ? []
        : await tx.db
            .selectFrom('tasks as t')
            .innerJoin('task_records as tr', 'tr.task_id', 't.id')
            .select(['t.id', 't.deadline_at', 't.created_by'])
            .where('tr.entity_instance_id', '=', record.id)
            .where('t.deleted_at', 'is', null)
            .where('t.completed_at', 'is', null)
            .where('t.deadline_at', '>', now)
            .where('t.deadline_at', '>=', after.t)
            .orderBy('t.deadline_at')
            .orderBy('t.id')
            .limit(limit + 50)
            .execute();
      const events: TimelineEvent[] = [
        ...meetings,
        ...tasks.map((t) => ({
          ...base(`task-upcoming:${t.id}`, t.deadline_at as string, null, 'task-upcoming'),
          isBackground: false,
          eventType: 'task-upcoming' as const,
          taskId: t.id,
        })),
      ]
        .filter((e) => compare(cursorOf(e), after) > 0)
        .sort((a, b) => compare(cursorOf(a), cursorOf(b)));
      const page = events.slice(0, limit);
      const more = events.length > limit;
      return {
        events: page.map((event) => ({ kind: 'single', event })),
        nextBefore: null,
        nextAfter: more && page.length > 0 ? encodeCursor(cursorOf(page.at(-1) as TimelineEvent)) : null,
      };
    }

    const limit = data.limit ?? PAST_LIMIT;
    if (categories.size === 0) return { events: [], nextBefore: null, nextAfter: null };
    const before = data.before ? decodeCursor(data.before) : { t: now, key: '￿' };
    const candidates = (await pastEvents(tx, record, categories, before.t, now, limit + 1))
      .filter((e) => compare(cursorOf(e), before) < 0)
      .sort((a, b) => compare(cursorOf(b), cursorOf(a)));
    const page = candidates.slice(0, limit);
    const more = candidates.length > limit;
    const shown = data.disableGrouping ? page : mergeConsecutiveChanges(page);
    return {
      events: data.disableGrouping ? shown.map((event) => ({ kind: 'single', event })) : groupBackground(shown),
      nextBefore: more && page.length > 0 ? encodeCursor(cursorOf(page.at(-1) as TimelineEvent)) : null,
      nextAfter: null,
    };
  },
};
