// Record activity timeline (contract E2; D §3.8, A §4.14).
import type { TimelineEvent, TimelineItem } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { systemContext } from '../src/index.ts';
import { collabFixture, createList, createRecord } from './collab-fixtures.ts';
import { domain, newId } from './support/harness.ts';

const flat = (items: TimelineItem[]): TimelineEvent[] =>
  items.flatMap((i) => (i.kind === 'single' ? [i.event] : i.events));
const types = (items: TimelineItem[]) => flat(items).map((e) => e.eventType);

describe('timeline', () => {
  it('derives creation and attribute changes with actor and old/new values', async () => {
    const f = await collabFixture();
    const ref = f.record;
    await domain.records.update(f.ctx, { ...ref, values: { description: [{ value: 'First' }] } });
    await domain.records.update(f.ctx, { ...ref, values: { description: [{ value: 'Second' }] } });
    const { events, nextBefore } = await domain.timeline.list(f.ctx, { ...ref, disableGrouping: true });
    expect(nextBefore).toBeNull();
    expect(types(events)).toEqual(['attribute-values-updated', 'attribute-values-updated', 'entity-instance-created']);
    const [latest, first, created] = flat(events);
    if (latest?.eventType !== 'attribute-values-updated' || first?.eventType !== 'attribute-values-updated')
      throw new Error('shape');
    expect(latest.actor).toEqual({ type: 'workspace-member', id: f.memberId });
    expect(latest.isBackground).toBe(false);
    expect(latest.changes).toHaveLength(1);
    expect(latest.changes[0]?.added.map((v) => v.value)).toEqual(['Second']);
    expect(latest.changes[0]?.removed.map((v) => v.value)).toEqual(['First']);
    expect(first.changes[0]?.removed).toEqual([]);
    expect(created).toMatchObject({ category: 'updates', actor: { type: 'workspace-member', id: f.memberId } });
    // The name given at creation is part of the creation, not a change.
    expect(flat(events).filter((e) => e.eventType === 'attribute-values-updated')).toHaveLength(2);
  });

  it('merges consecutive changes by one member and groups automation runs (D §3.8)', async () => {
    const f = await collabFixture();
    const ref = f.record;
    const sys = systemContext(f.workspaceId, 'enrichment');
    await domain.records.update(sys, { ...ref, values: { description: [{ value: 'enriched' }] } });
    await domain.records.update(sys, { ...ref, values: { categories: [], description: [{ value: 'enriched 2' }] } });
    await domain.records.update(f.ctx, { ...ref, values: { description: [{ value: 'mine 1' }] } });
    const linkedin = (await domain.schema.listAttributes(f.ctx, { entityDefinitionId: 'companies' })).find(
      (a) => a.apiSlug === 'linkedin',
    );
    await domain.records.update(f.ctx, { ...ref, values: { [linkedin?.id as string]: [{ value: 'acme' }] } });
    const { events } = await domain.timeline.list(f.ctx, ref);
    expect(events.map((i) => i.kind)).toEqual(['single', 'group', 'single']);
    const merged = events[0];
    if (merged?.kind !== 'single' || merged.event.eventType !== 'attribute-values-updated') throw new Error('shape');
    expect(merged.event.changes.map((c) => c.attributeDefinitionId)).toHaveLength(2);
    const description = merged.event.changes.find((c) => c.added[0]?.value === 'mine 1');
    expect(description?.removed.map((v) => v.value)).toEqual(['enriched 2']);
    const group = events[1];
    if (group?.kind !== 'group') throw new Error('shape');
    expect(group.events).toHaveLength(2);
    expect(group.events.every((e) => e.isBackground && e.actor?.type === 'system')).toBe(true);
    expect(group.startedAt <= group.endedAt).toBe(true);
  });

  it('includes notes, tasks, comments and files; filters by category', async () => {
    const f = await collabFixture();
    const ref = f.record;
    const note = await domain.notes.create(f.ctx, { id: newId(), parentRecords: [ref] });
    const task = await domain.tasks.create(f.ctx, {
      id: newId(),
      content: { text: 'Call', mentions: [] },
      linkedRecords: [ref],
    });
    await domain.tasks.setCompleted(f.ctx, { taskId: task.id, completed: true });
    const overdue = await domain.tasks.create(f.ctx, {
      id: newId(),
      content: { text: 'Late', mentions: [] },
      linkedRecords: [ref],
      deadline: { kind: 'datetime', at: '2026-01-01T09:00:00Z' },
    });
    const comment = await domain.comments.create(f.ctx, {
      id: newId(),
      target: { kind: 'record', ...ref },
      content: { text: 'hi', mentions: [], styles: [] },
    });
    const folder = await domain.files.createFolder(f.ctx, { id: newId(), ...ref, name: 'Docs' });
    const all = flat((await domain.timeline.list(f.ctx, ref)).events);
    expect(all.find((e) => e.eventType === 'note-added')).toMatchObject({ noteId: note.id, category: 'notes' });
    expect(all.find((e) => e.eventType === 'task-completed')).toMatchObject({
      taskId: task.id,
      actor: { id: f.memberId },
    });
    expect(all.find((e) => e.eventType === 'task-overdue')).toMatchObject({
      taskId: overdue.id,
      occurredAt: '2026-01-01T09:00:00.000000Z',
    });
    expect(all.find((e) => e.eventType === 'comment-added')).toMatchObject({
      commentId: comment.id,
      threadId: comment.id,
    });
    expect(all.some((e) => e.eventType === 'file-added')).toBe(false); // folders are not files
    expect(folder.entryType).toBe('folder');
    const onlyNotes = await domain.timeline.list(f.ctx, { ...ref, filters: ['notes'] });
    expect(types(onlyNotes.events)).toEqual(['note-added']);
    expect((await domain.timeline.list(f.ctx, { ...ref, filters: [] })).events).toEqual([]);
  });

  it('pages backwards with a cursor and upcoming tasks forwards', async () => {
    const f = await collabFixture();
    const ref = f.record;
    for (let i = 0; i < 5; i++) {
      await domain.notes.create(f.ctx, { id: newId(), title: `n${i}`, parentRecords: [ref] });
    }
    const seen: string[] = [];
    let before: string | undefined;
    for (let page = 0; page < 10; page++) {
      const out = await domain.timeline.list(f.ctx, { ...ref, limit: 2, ...(before ? { before } : {}) });
      seen.push(...flat(out.events).map((e) => e.id));
      if (!out.nextBefore) break;
      before = out.nextBefore;
    }
    expect(seen).toHaveLength(6); // 5 notes + created
    expect(new Set(seen).size).toBe(6);

    const now = '2026-10-14T09:00:00Z';
    const ids: string[] = [];
    for (const at of ['2026-10-20T09:00:00Z', '2026-10-15T09:00:00Z', '2026-10-30T09:00:00Z', '2026-10-01T09:00:00Z']) {
      const t = await domain.tasks.create(f.ctx, {
        id: newId(),
        content: { text: at, mentions: [] },
        linkedRecords: [ref],
        deadline: { kind: 'datetime', at },
      });
      ids.push(t.id);
    }
    const first = await domain.timeline.list(f.ctx, { ...ref, mode: 'upcoming', limit: 2, now });
    expect(flat(first.events).map((e) => e.occurredAt)).toEqual([
      '2026-10-15T09:00:00.000000Z',
      '2026-10-20T09:00:00.000000Z',
    ]);
    expect(first.nextAfter).not.toBeNull();
    // An `after` cursor alone pages upcoming events (contract E2).
    const second = await domain.timeline.list(f.ctx, {
      ...ref,
      limit: 2,
      now,
      after: first.nextAfter as string,
    });
    expect(flat(second.events).map((e) => e.eventType)).toEqual(['task-upcoming']);
    expect(second.nextAfter).toBeNull();
  });

  it('shows list entry events and merged records', async () => {
    const f = await collabFixture();
    const list = await createList(f, f.companies);
    const entry = await list.addEntry(f.company);
    await domain.records.update(f.ctx, {
      entityDefinitionId: list.listId,
      entityInstanceId: entry,
      values: { stage_note: [{ value: 'hot' }] },
    });
    await domain.records.delete(f.ctx, { entityDefinitionId: list.listId, entityInstanceId: entry });
    const listEvents = flat(
      (await domain.timeline.list(f.ctx, { ...f.record, filters: ['lists'], disableGrouping: true })).events,
    );
    expect(listEvents.map((e) => e.eventType)).toEqual([
      'list-entry-deleted',
      'list-attribute-values-updated',
      'list-entry-created',
    ]);
    expect(listEvents[0]).toMatchObject({ list: { listId: list.listId, entryId: entry } });

    const other = await createRecord(f, 'companies', { name: [{ value: 'Acme dup' }] });
    const merged = await domain.records.merge(f.ctx, {
      entityDefinitionId: 'companies',
      baseEntityInstanceId: f.company,
      targetEntityInstanceId: other,
    });
    const mergedEvents = flat(
      (
        await domain.timeline.list(f.ctx, {
          entityDefinitionId: f.companies,
          entityInstanceId: merged.record.entityInstanceId,
        })
      ).events,
    );
    // The merged record starts with a "merged" event; carried-over list entries keep their own history.
    expect(mergedEvents.find((e) => e.eventType === 'merged')).toMatchObject({
      mergedFromIds: [f.company, other].sort(),
    });
    expect(mergedEvents.some((e) => e.eventType === 'entity-instance-created')).toBe(false);
  });
});
