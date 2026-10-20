// Home page summary (BACKLOG 5.07; B-shell/home.md §2): greeting by local time of day, the Tasks block (open tasks
// assigned to me: total, bucket counts, the first `taskLimit` ordered today → tomorrow → overdue → later → no due
// date, deadlines ascending inside a bucket — home §2.4) and recently updated records (search index recency) of
// objects I can read. Meetings (slice 7) and Ask Agentic (slice 10) are not part of it yet.
import {
  addDays,
  endOfLocalDay,
  type HomeSummary,
  type HomeSummaryInput,
  type HomeTaskBucket,
  homeSummaryInputSchema,
  homeTaskBuckets,
  isTimeZone,
  localDateOf,
  localDayRange,
  type PartOfDay,
  type Task,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { type CollabDeps, requireMember } from '../collab/common.ts';
import { taskOps } from '../collab/tasks.ts';
import { badRequest } from '../errors.ts';
import { loadDefinitionsByIds } from '../schema/model.ts';
import { SEARCHABLE_ENTITY_TYPE_LIST } from '../search/indexer.ts';
import type { Tx } from '../tx.ts';

const GREETING: Record<PartOfDay, string> = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
};

/** Morning before 12:00, afternoon before 18:00, evening otherwise (home §2.1). */
export function partOfDay(now: string, timeZone: string): PartOfDay {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)),
  );
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function homeOps(deps: CollabDeps) {
  return {
    async summary(tx: Tx, input: HomeSummaryInput): Promise<HomeSummary> {
      const data = homeSummaryInputSchema.parse(input);
      if (!isTimeZone(data.timeZone)) {
        throw badRequest('VALIDATION_ERROR', `Unknown time zone "${data.timeZone}"`, { field: 'timeZone' });
      }
      const memberId = requireMember(tx);
      const now = data.now ?? tx.now;
      // The member's profile copy (workspace_members mirrors the auth user's name).
      const member = await tx.db
        .selectFrom('workspace_members')
        .select(['first_name', 'last_name'])
        .where('id', '=', memberId)
        .executeTakeFirst();
      const firstName = member?.first_name.trim() || member?.last_name.trim() || '';
      const part = partOfDay(now, data.timeZone);

      // Tasks block.
      const today = localDateOf(now, data.timeZone);
      const startOfToday = Date.parse(localDayRange(today, data.timeZone).start);
      const endOfToday = Date.parse(endOfLocalDay(today, data.timeZone));
      const endOfTomorrow = Date.parse(endOfLocalDay(addDays(today, 1), data.timeZone));
      const open = await tx.db
        .selectFrom('tasks as t')
        .innerJoin('task_assignees as a', 'a.task_id', 't.id')
        .select('t.id')
        .where('a.member_id', '=', memberId)
        .where('t.deleted_at', 'is', null)
        .where('t.completed_at', 'is', null)
        .execute();
      // Same visibility as the Tasks page (tasks linked only to unreadable records are hidden).
      const { tasks } =
        open.length > 0
          ? await taskOps.batchGet(
              tx,
              deps,
              open.map((r) => r.id),
            )
          : { tasks: [] as Task[] };
      const bucketOf = (task: Task): HomeTaskBucket => {
        if (task.deadlineAt === null) return 'no-date';
        const at = Date.parse(task.deadlineAt);
        if (at < startOfToday) return 'overdue';
        if (at <= endOfToday) return 'today';
        if (at <= endOfTomorrow) return 'tomorrow';
        return 'later';
      };
      const counts: Record<HomeTaskBucket, number> = { today: 0, tomorrow: 0, overdue: 0, later: 0, 'no-date': 0 };
      const rank = new Map(homeTaskBuckets.map((b, i) => [b, i]));
      const items = tasks.map((task) => ({ bucket: bucketOf(task), task }));
      for (const item of items) counts[item.bucket]++;
      items.sort((a, b) => {
        const byBucket = (rank.get(a.bucket) ?? 0) - (rank.get(b.bucket) ?? 0);
        if (byBucket !== 0) return byBucket;
        const da = a.task.deadlineAt ?? '';
        const db = b.task.deadlineAt ?? '';
        if (da !== db) return da < db ? -1 : 1;
        return a.task.createdAt < b.task.createdAt ? -1 : a.task.createdAt > b.task.createdAt ? 1 : 0;
      });

      // Recently updated records of readable objects.
      let recentRecords: HomeSummary['recentRecords'] = [];
      if (data.recentLimit > 0) {
        const defRows = await tx.db
          .selectFrom('entity_definitions')
          .select('id')
          .where('entity_type', 'in', SEARCHABLE_ENTITY_TYPE_LIST)
          .where('is_archived', '=', false)
          .execute();
        const defs = [
          ...(
            await loadDefinitionsByIds(
              tx,
              defRows.map((d) => d.id),
            )
          ).values(),
        ];
        const readable = (await deps.policies.allowed(tx, defs, 'read_entity_instance')).map((d) => d.id);
        if (readable.length > 0) {
          const { rows } = await sql<{
            instance_id: string;
            entity_definition_id: string;
            title: string | null;
            subtitle: string | null;
            image: string | null;
            recency_at: string;
          }>`
            SELECT instance_id, entity_definition_id, title, subtitle, image, recency_at FROM search_index
            WHERE workspace_id = ${tx.workspaceId}::uuid AND entity_definition_id = ANY(${readable}::uuid[])
            ORDER BY recency_at DESC, instance_id DESC
            LIMIT ${data.recentLimit}`.execute(tx.db);
          recentRecords = rows.map((r) => ({
            entityDefinitionId: r.entity_definition_id,
            entityInstanceId: r.instance_id,
            title: r.title,
            subtitle: r.subtitle,
            avatar: r.image,
            updatedAt: r.recency_at,
          }));
        }
      }

      return {
        greeting: { partOfDay: part, firstName, text: `${GREETING[part]}${firstName ? `, ${firstName}` : ''}.` },
        tasks: {
          total: tasks.length,
          today: counts.today,
          tomorrow: counts.tomorrow,
          overdue: counts.overdue,
          later: counts.later,
          noDueDate: counts['no-date'],
          items: items.slice(0, data.taskLimit),
        },
        recentRecords,
        localDate: today,
        accurateAt: tx.now,
      };
    },
  };
}
