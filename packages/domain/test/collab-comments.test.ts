// Comments, threads, reactions (BACKLOG 3.16; E README §2.8, §3.5, §4.4).
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { addMember, changeRows, collabFixture, createList, lastChangeId } from './collab-fixtures.ts';
import { domain, expectCode, newId } from './support/harness.ts';

const body = (text: string) => ({ text, mentions: [], styles: [] });

describe('comments', () => {
  it('starts a thread on a record, replies, and reads summaries and the thread', async () => {
    const f = await collabFixture();
    const grace = await addMember(f);
    const target = { kind: 'record' as const, ...f.record };
    const rootId = newId();
    const before = await lastChangeId(f.workspaceId);
    const root = await domain.comments.create(f.ctx, {
      id: rootId,
      target,
      content: {
        text: 'Hey @Grace, **look**',
        mentions: [{ kind: 'workspace-member', start: 4, length: 6, memberId: grace.memberId }],
        styles: [{ start: 12, length: 8, style: 'bold' }],
      },
    });
    expect(root).toMatchObject({
      id: rootId,
      threadId: rootId,
      isThreadRoot: true,
      target,
      viaApi: false,
      resolvedAt: null,
    });
    expect((await changeRows(f.workspaceId, before)).map((r) => r.resource)).toEqual(
      expect.arrayContaining(['comment-thread', 'comment-thread-list', 'record-timeline']),
    );
    const reply1 = await domain.comments.create(grace.ctx, { id: newId(), threadId: rootId, content: body('Seen') });
    const reply2 = await domain.comments.create(f.ctx, { id: newId(), threadId: rootId, content: body('Thanks') });
    expect(reply1).toMatchObject({ threadId: rootId, isThreadRoot: false, target });
    // Replies to replies are refused (one level deep).
    await expectCode(
      domain.comments.create(f.ctx, { id: newId(), threadId: reply1.id, content: body('x') }),
      'VALIDATION_ERROR',
    );
    const { threads, total } = await domain.comments.listThreads(f.ctx, { target });
    expect(total).toBe(1);
    expect(threads[0]).toMatchObject({
      threadId: rootId,
      replyCount: 2,
      replierMemberIds: [f.memberId, grace.memberId],
    });
    const thread = await domain.comments.getThread(f.ctx, rootId);
    expect(thread.replies.map((r) => r.id)).toEqual([reply1.id, reply2.id]);
    // Replay of a create returns the stored comment.
    expect((await domain.comments.create(f.ctx, { id: rootId, target, content: body('other') })).content.text).toBe(
      'Hey @Grace, **look**',
    );
  });

  it.each([
    ['an empty comment', { text: '  ', mentions: [], styles: [] }],
    ['a link style without href', { text: 'abc', mentions: [], styles: [{ start: 0, length: 3, style: 'link' }] }],
    ['a style outside the text', { text: 'abc', mentions: [], styles: [{ start: 2, length: 5, style: 'bold' }] }],
  ])('rejects %s', async (_label, content) => {
    const f = await collabFixture();
    await expect(
      domain.comments.create(f.ctx, { id: newId(), target: { kind: 'record', ...f.record }, content } as never),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it('resolves and re-opens thread roots only; filters resolved threads and my threads', async () => {
    const f = await collabFixture();
    const grace = await addMember(f);
    const target = { kind: 'record' as const, ...f.record };
    const mine = await domain.comments.create(f.ctx, { id: newId(), target, content: body('mine') });
    const theirs = await domain.comments.create(grace.ctx, { id: newId(), target, content: body('theirs') });
    const reply = await domain.comments.create(f.ctx, { id: newId(), threadId: mine.id, content: body('r') });
    await expectCode(domain.comments.resolve(f.ctx, { commentId: reply.id, resolved: true }), 'VALIDATION_ERROR');
    const resolved = await domain.comments.resolve(f.ctx, { commentId: theirs.id, resolved: true });
    expect(resolved).toMatchObject({ resolvedBy: { type: 'workspace-member', id: f.memberId } });
    expect((await domain.comments.listThreads(f.ctx, { target })).threads.map((t) => t.threadId)).toEqual([mine.id]);
    expect((await domain.comments.listThreads(f.ctx, { target, includeResolved: true })).total).toBe(2);
    expect(
      (await domain.comments.listThreads(grace.ctx, { target, includeResolved: true, onlyMine: true })).threads.map(
        (t) => t.threadId,
      ),
    ).toEqual([theirs.id]);
    expect(await domain.comments.locate(f.ctx, reply.id)).toMatchObject({
      threadId: mine.id,
      target,
      isResolved: false,
      parentRecord: null,
    });
    const reopened = await domain.comments.resolve(f.ctx, { commentId: theirs.id, resolved: false });
    expect(reopened.resolvedAt).toBeNull();
  });

  it('only the author deletes; deleting a root deletes the thread', async () => {
    const f = await collabFixture();
    const grace = await addMember(f);
    const target = { kind: 'record' as const, ...f.record };
    const root = await domain.comments.create(f.ctx, { id: newId(), target, content: body('root') });
    const reply = await domain.comments.create(grace.ctx, { id: newId(), threadId: root.id, content: body('reply') });
    await expectCode(domain.comments.delete(f.ctx, reply.id), 'FORBIDDEN', 403);
    expect((await domain.comments.delete(grace.ctx, reply.id)).deletedIds).toEqual([reply.id]);
    const again = await domain.comments.create(grace.ctx, { id: newId(), threadId: root.id, content: body('again') });
    expect((await domain.comments.delete(f.ctx, root.id)).deletedIds.sort()).toEqual([root.id, again.id].sort());
    await expectCode(domain.comments.getThread(f.ctx, root.id), 'NOT_FOUND', 404);
    await expectCode(domain.comments.locate(f.ctx, again.id), 'NOT_FOUND');
  });

  it('adds and removes reactions per member (idempotent), grouped by emoji', async () => {
    const f = await collabFixture();
    const grace = await addMember(f);
    const root = await domain.comments.create(f.ctx, {
      id: newId(),
      target: { kind: 'record', ...f.record },
      content: body('x'),
    });
    const myReaction = newId();
    await domain.comments.addReaction(f.ctx, { commentId: root.id, reactionId: myReaction, emoji: '👍' });
    await domain.comments.addReaction(f.ctx, { commentId: root.id, reactionId: myReaction, emoji: '👍' });
    await domain.comments.addReaction(f.ctx, { commentId: root.id, reactionId: newId(), emoji: '👍' }); // same emoji, no-op
    const withGrace = await domain.comments.addReaction(grace.ctx, {
      commentId: root.id,
      reactionId: newId(),
      emoji: '👍',
    });
    await domain.comments.addReaction(grace.ctx, { commentId: root.id, reactionId: newId(), emoji: '👨‍👩‍👧' });
    expect(withGrace.reactions).toEqual([
      { emoji: '👍', count: 2, memberIds: [f.memberId, grace.memberId], myReactionId: expect.any(String) },
    ]);
    const mineView = await domain.comments.get(f.ctx, root.id);
    expect(mineView.reactions.map((r) => [r.emoji, r.count, r.myReactionId])).toEqual([
      ['👍', 2, myReaction],
      ['👨‍👩‍👧', 1, null],
    ]);
    await expect(
      domain.comments.addReaction(f.ctx, { commentId: root.id, reactionId: newId(), emoji: 'abc' }),
    ).rejects.toBeInstanceOf(ZodError);
    const removed = await domain.comments.removeReaction(f.ctx, { commentId: root.id, reactionId: myReaction });
    expect(removed.reactions[0]).toMatchObject({ emoji: '👍', count: 1, myReactionId: null });
    await domain.comments.removeReaction(f.ctx, { commentId: root.id, reactionId: myReaction });
  });

  it('comments on list entries locate the entry and its parent record; counts per record', async () => {
    const f = await collabFixture();
    const list = await createList(f, f.companies);
    const entry = await list.addEntry(f.company);
    const target = { kind: 'list-entry' as const, entityDefinitionId: list.listId, entityInstanceId: entry };
    const c = await domain.comments.create(f.ctx, { id: newId(), target, content: body('on the entry') });
    expect(await domain.comments.locate(f.ctx, c.id)).toMatchObject({ target, parentRecord: f.record });
    await expectCode(
      domain.comments.create(f.ctx, {
        id: newId(),
        target: { kind: 'record', entityDefinitionId: list.listId, entityInstanceId: entry },
        content: body('x'),
      }),
      'VALIDATION_ERROR',
    );
    const onRecord = await domain.comments.create(f.ctx, {
      id: newId(),
      target: { kind: 'record', ...f.record },
      content: body('a'),
    });
    await domain.comments.create(f.ctx, { id: newId(), threadId: onRecord.id, content: body('b') });
    const { counts } = await domain.comments.counts(f.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceIds: [f.company, f.person],
    });
    expect(counts[f.company]).toEqual({ threads: 1, unresolvedThreads: 1, comments: 2 });
    expect(counts[f.person]).toEqual({ threads: 0, unresolvedThreads: 0, comments: 0 });
    const objectLevel = await domain.comments.listThreads(f.ctx, { entityDefinitionId: 'companies' });
    expect(objectLevel.threads.map((t) => t.threadId)).toEqual([onRecord.id]);
  });

  it('API tokens write on behalf of a member ("via API") and may delete any comment', async () => {
    const f = await collabFixture();
    const token = await domain.apiTokens.create(f.ctx, { name: 't', scopes: ['comment:read-write'] });
    const api = { workspaceId: f.workspaceId, actor: { type: 'api-token' as const, id: token.id } };
    const c = await domain.comments.create(
      api,
      { id: newId(), target: { kind: 'record', ...f.record }, content: body('hi') },
      { authorMemberId: f.memberId },
    );
    expect(c).toMatchObject({
      author: { type: 'workspace-member', id: f.memberId },
      createdBy: { type: 'api-token' },
      viaApi: true,
    });
    expect((await domain.comments.delete(api, c.id)).deletedIds).toEqual([c.id]);
  });
});
