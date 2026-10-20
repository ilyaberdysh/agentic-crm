// Home summary (BACKLOG 5.07; B-shell/home.md §2): greeting by local time of day, the Tasks block (my open tasks:
// counts per bucket, items ordered today → tomorrow → overdue → later → no due date) and recently updated records.
import { beforeAll, describe, expect, it } from 'vitest';
import { partOfDay } from '../src/home/service.ts';
import { addMember, type CollabFixture, collabFixture, createRecord } from './collab-fixtures.ts';
import { domain, expectCode, newId } from './support/harness.ts';

const NOW = '2026-10-14T10:00:00.000Z'; // 12:00 in Berlin
const TZ = 'Europe/Berlin';
let f: CollabFixture;

const due = (date: string) => ({ kind: 'date' as const, date, timeZone: TZ });

beforeAll(async () => {
  f = await collabFixture();
});

describe('home.summary', () => {
  it('greets by local time of day', async () => {
    expect(partOfDay('2026-10-14T07:00:00Z', 'Europe/Berlin')).toBe('morning'); // 09:00
    expect(partOfDay('2026-10-14T10:00:00Z', 'Europe/Berlin')).toBe('afternoon'); // 12:00
    expect(partOfDay('2026-10-14T09:59:00Z', 'Europe/Berlin')).toBe('morning'); // 11:59
    expect(partOfDay('2026-10-14T16:00:00Z', 'Europe/Berlin')).toBe('evening'); // 18:00
    expect(partOfDay('2026-10-14T16:00:00Z', 'America/New_York')).toBe('afternoon'); // 12:00
    const summary = await domain.home.summary(f.ctx, { timeZone: TZ, now: NOW });
    expect(summary.greeting).toEqual({ partOfDay: 'afternoon', firstName: 'Ada', text: 'Good afternoon, Ada.' });
    expect(summary.localDate).toBe('2026-10-14');
    await expectCode(domain.home.summary(f.ctx, { timeZone: 'Mars/Olympus' }), 'VALIDATION_ERROR', 400);
  });

  it('summarises my open tasks in bucket order', async () => {
    const other = await addMember(f, 'Bob');
    const make = async (text: string, deadline: ReturnType<typeof due> | null, extra: Record<string, unknown> = {}) => {
      const id = newId();
      await domain.tasks.create(f.ctx, {
        id,
        content: { text },
        deadline,
        assigneeMemberIds: [f.memberId],
        ...extra,
      });
      return id;
    };
    const later = await make('In five days', due('2026-10-19'));
    const none = await make('Someday', null);
    const overdue = await make('Yesterday', due('2026-10-13'));
    const tomorrow = await make('Tomorrow', due('2026-10-15'));
    const today = await make('Today', due('2026-10-14'));
    await make('Done already', due('2026-10-14'), { isCompleted: true });
    await make('Not mine', due('2026-10-14'), { assigneeMemberIds: [other.memberId] });

    const summary = await domain.home.summary(f.ctx, { timeZone: TZ, now: NOW });
    expect(summary.tasks).toMatchObject({ total: 5, today: 1, tomorrow: 1, overdue: 1, later: 1, noDueDate: 1 });
    expect(summary.tasks.items.map((i) => [i.bucket, i.task.id])).toEqual([
      ['today', today],
      ['tomorrow', tomorrow],
      ['overdue', overdue],
      ['later', later],
      ['no-date', none],
    ]);
    const top = await domain.home.summary(f.ctx, { timeZone: TZ, now: NOW, taskLimit: 2 });
    expect(top.tasks.items).toHaveLength(2);
    expect(top.tasks.total).toBe(5);
    // Bob sees only his task.
    expect((await domain.home.summary(other.ctx, { timeZone: TZ, now: NOW })).tasks.total).toBe(1);
  });

  it('lists recently updated records', async () => {
    const globex = await createRecord(f, 'companies', { name: [{ value: 'Globex' }] });
    const first = await domain.home.summary(f.ctx, { timeZone: TZ, recentLimit: 3 });
    expect(first.recentRecords[0]).toMatchObject({ entityInstanceId: globex, title: 'Globex' });
    await domain.records.update(f.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: f.company,
      values: { description: [{ value: 'Touched' }] },
    });
    const second = await domain.home.summary(f.ctx, { timeZone: TZ, recentLimit: 3 });
    expect(second.recentRecords.map((r) => r.entityInstanceId).slice(0, 2)).toEqual([f.company, globex]);
    expect((await domain.home.summary(f.ctx, { timeZone: TZ, recentLimit: 0 })).recentRecords).toEqual([]);
  });
});
