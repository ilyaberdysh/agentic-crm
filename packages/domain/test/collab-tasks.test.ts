// Tasks (BACKLOG 3.15; E README §2.6–2.7b, §3.3, §4.3; decisions X-09, X-10).
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { changeRows, collabFixture, createRecord, lastChangeId } from './collab-fixtures.ts';
import { domain, expectCode, newId } from './support/harness.ts';

const text = (t: string) => ({ text: t, mentions: [] });

describe('tasks', () => {
  it('creates with a date-only deadline at the end of the creator day (X-09) and replays', async () => {
    const f = await collabFixture();
    const id = newId();
    const task = await domain.tasks.create(f.ctx, {
      id,
      content: text('Send proposal'),
      deadline: { kind: 'date', date: '2026-10-16', timeZone: 'Europe/Moscow' },
      assigneeMemberIds: [f.memberId],
      linkedRecords: [f.record],
    });
    expect(task).toMatchObject({
      id,
      content: { text: 'Send proposal', mentions: [] },
      deadlineAt: '2026-10-16T20:59:59.999000Z',
      deadlineHasTime: false,
      isCompleted: false,
      completedAt: null,
      assigneeMemberIds: [f.memberId],
      linkedRecords: [f.record],
      createdBy: { type: 'workspace-member', id: f.memberId },
    });
    const timed = await domain.tasks.create(f.ctx, {
      id: newId(),
      content: text('Call at 3'),
      deadline: { kind: 'datetime', at: '2026-10-16T12:00:00Z' },
    });
    expect(timed).toMatchObject({ deadlineAt: '2026-10-16T12:00:00.000000Z', deadlineHasTime: true });
    expect((await domain.tasks.create(f.ctx, { id, content: text('changed') })).content.text).toBe('Send proposal');
  });

  it('links mentioned records automatically and stores member mentions', async () => {
    const f = await collabFixture();
    const content = {
      text: 'Ping @Acme with @Ada',
      mentions: [
        { kind: 'record' as const, start: 5, length: 5, entityDefinitionId: f.companies, entityInstanceId: f.company },
        { kind: 'workspace-member' as const, start: 16, length: 4, memberId: f.memberId },
      ],
    };
    const task = await domain.tasks.create(f.ctx, { id: newId(), content });
    expect(task.linkedRecords).toEqual([f.record]);
    expect(task.content.mentions).toHaveLength(2);
  });

  it.each([
    ['an empty title', { content: text('   ') }, 'ZOD'],
    [
      'a mention outside the text',
      { content: { text: 'ab', mentions: [{ kind: 'workspace-member', start: 1, length: 5, memberId: newId() }] } },
      'ZOD',
    ],
    ['an unknown assignee', { content: text('x'), assigneeMemberIds: [newId()] }, 'VALUE_VALIDATION_FAILED'],
    [
      'an unknown time zone',
      { content: text('x'), deadline: { kind: 'date', date: '2026-10-16', timeZone: 'Mars/Base' } },
      'VALIDATION_ERROR',
    ],
  ])('rejects %s', async (_label, input, code) => {
    const f = await collabFixture();
    const call = domain.tasks.create(f.ctx, { id: newId(), ...(input as object) } as never);
    // Schema violations surface as ZodError (transports answer 400 VALIDATION_ERROR).
    if (code === 'ZOD') await expect(call).rejects.toBeInstanceOf(ZodError);
    else await expectCode(call, code);
  });

  it('completes and un-completes (canonical response), keeping the first completion', async () => {
    const f = await collabFixture();
    const task = await domain.tasks.create(f.ctx, { id: newId(), content: text('Do it'), linkedRecords: [f.record] });
    const before = await lastChangeId(f.workspaceId);
    const done = await domain.tasks.setCompleted(f.ctx, { taskId: task.id, completed: true });
    expect(done).toMatchObject({ isCompleted: true, completedBy: { type: 'workspace-member', id: f.memberId } });
    expect((await changeRows(f.workspaceId, before)).map((r) => r.resource)).toEqual(
      expect.arrayContaining(['task', 'task-list', 'record-timeline']),
    );
    const again = await domain.tasks.setCompleted(f.ctx, { taskId: task.id, completed: true });
    expect(again.completedAt).toBe(done.completedAt);
    const undone = await domain.tasks.setCompleted(f.ctx, { taskId: task.id, completed: false });
    expect(undone).toMatchObject({ isCompleted: false, completedAt: null, completedBy: null });
    await expectCode(domain.tasks.setCompleted(f.ctx, { taskId: newId(), completed: true }), 'NOT_FOUND', 404);
  });

  it('bulk completes and bulk deletes', async () => {
    const f = await collabFixture();
    const ids = [newId(), newId(), newId()];
    for (const id of ids) await domain.tasks.create(f.ctx, { id, content: text(id) });
    const { tasks } = await domain.tasks.bulkSetCompleted(f.ctx, { taskIds: [...ids, newId()], completed: true });
    expect(tasks.map((t) => t.isCompleted)).toEqual([true, true, true]);
    expect((await domain.tasks.delete(f.ctx, [ids[0] as string, ids[1] as string])).deletedIds).toHaveLength(2);
    expect((await domain.tasks.batchGet(f.ctx, ids)).tasks.map((t) => t.id)).toEqual([ids[2]]);
    expect((await domain.tasks.delete(f.ctx, [ids[0] as string])).deletedIds).toEqual([]);
  });

  it('updates fields with full replacement', async () => {
    const f = await collabFixture();
    const person = { entityDefinitionId: f.people, entityInstanceId: f.person };
    const task = await domain.tasks.create(f.ctx, {
      id: newId(),
      content: text('a'),
      linkedRecords: [f.record],
      assigneeMemberIds: [f.memberId],
    });
    const updated = await domain.tasks.update(f.ctx, {
      taskId: task.id,
      content: text('b'),
      deadline: null,
      linkedRecords: [person],
      assigneeMemberIds: [],
      isCompleted: true,
    });
    expect(updated).toMatchObject({
      content: { text: 'b' },
      deadlineAt: null,
      linkedRecords: [person],
      assigneeMemberIds: [],
      isCompleted: true,
    });
  });

  it('groups by deadline in the viewer zone and week start (E README §2.6)', async () => {
    const f = await collabFixture();
    const now = '2026-10-14T09:00:00Z'; // Wednesday, 12:00 in Moscow
    const make = async (label: string, deadlineAt: string | null, completed = false) => {
      const t = await domain.tasks.create(f.ctx, {
        id: newId(),
        content: text(label),
        deadline: deadlineAt ? { kind: 'datetime', at: deadlineAt } : null,
        isCompleted: completed,
        assigneeMemberIds: [f.memberId],
      });
      return t.id;
    };
    const overdue = await make('overdue', '2026-10-12T09:00:00Z');
    const today = await make('today', '2026-10-14T18:00:00Z');
    const week = await make('week', '2026-10-17T09:00:00Z');
    const later = await make('later', '2026-10-30T09:00:00Z');
    const none = await make('none', null);
    const done = await make('done', '2026-10-01T09:00:00Z', true);
    const out = await domain.tasks.list(f.ctx, { timeZone: 'Europe/Moscow', weekStartDay: 1, now });
    expect(out.groups.map((g) => [g.key, g.tasks.map((t) => t.id)])).toEqual([
      ['overdue', [overdue]],
      ['today', [today]],
      ['this-week', [week]],
      ['later', [later]],
      ['no-date', [none]],
      ['completed', [done]],
    ]);
    // Sunday week start: the week ends Saturday 2026-10-17 23:59:59.999 local → 09:00Z Saturday is still this week.
    const sunday = await domain.tasks.list(f.ctx, {
      timeZone: 'Europe/Moscow',
      weekStartDay: 0,
      now,
      showCompleted: false,
    });
    expect(sunday.groups.map((g) => g.key)).toEqual(['overdue', 'today', 'this-week', 'later', 'no-date']);
    expect(await domain.tasks.countDue(f.ctx, { timeZone: 'Europe/Moscow', now })).toEqual({ count: 2 });
  });

  it('uses the member week start preference when none is given (X-10)', async () => {
    const f = await collabFixture();
    const now = '2026-10-17T09:00:00Z'; // Saturday
    const saturdayEvening = '2026-10-17T20:00:00Z';
    const sundayNoon = '2026-10-18T12:00:00Z';
    for (const at of [saturdayEvening, sundayNoon]) {
      await domain.tasks.create(f.ctx, { id: newId(), content: text(at), deadline: { kind: 'datetime', at } });
    }
    await domain.preferences.update(f.ctx, { locale: 'en-US' }); // Sunday weeks: Sunday is next week
    const us = await domain.tasks.list(f.ctx, { timeZone: 'UTC', now });
    expect(us.groups.map((g) => g.key)).toEqual(['today', 'later']);
    await domain.preferences.update(f.ctx, { weekStartDay: 1 });
    const eu = await domain.tasks.list(f.ctx, { timeZone: 'UTC', now });
    expect(eu.groups.map((g) => g.key)).toEqual(['today', 'this-week']);
    expect(await domain.preferences.get(f.ctx)).toMatchObject({
      locale: 'en-US',
      weekStartDay: 1,
      effectiveWeekStartDay: 1,
    });
  });

  it('filters by assignee, record, creator and completion; groups by assignee and creation date', async () => {
    const f = await collabFixture();
    const other = await createRecord(f, 'companies', { name: [{ value: 'Beta' }] });
    const otherRef = { entityDefinitionId: f.companies, entityInstanceId: other };
    const mine = await domain.tasks.create(f.ctx, {
      id: newId(),
      content: text('mine'),
      assigneeMemberIds: [f.memberId],
      linkedRecords: [f.record],
    });
    const unassigned = await domain.tasks.create(f.ctx, {
      id: newId(),
      content: text('nobody'),
      linkedRecords: [otherRef],
    });
    const ids = async (filter: object, groupBy?: 'none') =>
      (await domain.tasks.list(f.ctx, { filter, groupBy: groupBy ?? 'none' })).groups
        .flatMap((g) => g.tasks.map((t) => t.id))
        .sort();
    expect(await ids({ assignees: { operator: 'is', memberIds: [f.memberId] } })).toEqual([mine.id]);
    expect(await ids({ assignees: { operator: 'is-not', memberIds: [f.memberId] } })).toEqual([unassigned.id]);
    expect(await ids({ unassigned: true })).toEqual([unassigned.id]);
    expect(await ids({ records: { operator: 'is', records: [otherRef] } })).toEqual([unassigned.id]);
    expect(await ids({ records: { operator: 'is-not', records: [otherRef] } })).toEqual([mine.id]);
    expect(await ids({ createdByMemberIds: [f.memberId] })).toEqual([mine.id, unassigned.id].sort());
    expect(await ids({ isCompleted: true })).toEqual([]);
    const byAssignee = await domain.tasks.list(f.ctx, { groupBy: 'assignee' });
    expect(byAssignee.groups.map((g) => g.key).sort()).toEqual([f.memberId, 'none'].sort());
    const byCreated = await domain.tasks.list(f.ctx, { groupBy: 'created-at' });
    expect(byCreated.groups.map((g) => g.key)).toEqual(['today']);
    const byCreator = await domain.tasks.list(f.ctx, { groupBy: 'created-by' });
    expect(byCreator.groups.map((g) => g.memberId)).toEqual([f.memberId]);
  });

  it('tasks of a deleted record go with it (D §3.10a) unless linked elsewhere', async () => {
    const f = await collabFixture();
    const person = { entityDefinitionId: f.people, entityInstanceId: f.person };
    const only = await domain.tasks.create(f.ctx, { id: newId(), content: text('only'), linkedRecords: [f.record] });
    const both = await domain.tasks.create(f.ctx, {
      id: newId(),
      content: text('both'),
      linkedRecords: [f.record, person],
    });
    await domain.records.delete(f.ctx, f.record);
    await expectCode(domain.tasks.get(f.ctx, only.id), 'NOT_FOUND');
    expect((await domain.tasks.get(f.ctx, both.id)).linkedRecords).toEqual([person]);
  });
});
