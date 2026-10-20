import type { NotificationGroup } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { actorsEyebrow, shortAgo, snippetOf, targetOf, titleParts } from './copy';

const base = {
  id: 'g1',
  type: 'comment-mentioned',
  topic: 'mentions',
  preferenceGroup: 'mentions',
  isRead: false,
  isArchived: false,
  isResolved: true,
  actionable: false,
  firstAt: '2026-10-14T10:00:00.000Z',
  latestAt: '2026-10-14T10:00:00.000Z',
  entryCount: 1,
  unreadCount: 1,
  actors: [],
  actorCount: 1,
  entries: [],
} as const;

const comment = (over: Record<string, unknown> = {}): NotificationGroup =>
  ({
    ...base,
    subject: {
      kind: 'comment',
      commentId: 'c1',
      threadId: 't1',
      text: 'Can you review this, @Ada?',
      record: {
        entityDefinitionId: 'd',
        entityInstanceId: 'r',
        title: '[seed] Northwind Robotics',
        isUnavailable: false,
      },
      listId: null,
      entryId: null,
      isUnavailable: false,
      ...over,
    },
  }) as unknown as NotificationGroup;

describe('inbox row copy', () => {
  it('fills the registry title with the record in bold', () => {
    expect(titleParts(comment())).toEqual([
      { text: 'Mentioned you in a comment on ' },
      { text: '[seed] Northwind Robotics', strong: true },
    ]);
  });

  it('names the actors: one, two, or the first and a count', () => {
    expect(actorsEyebrow(['Grace'], 1)).toBe('Grace');
    expect(actorsEyebrow(['Grace', 'Alan'], 2)).toBe('Grace and Alan');
    expect(actorsEyebrow(['Grace', 'Alan', 'Ada'], 4)).toBe('Grace and 3 more');
  });

  it('a click on a comment opens the comment link; deleted subjects open nothing and say why', () => {
    expect(targetOf(comment())).toEqual({ kind: 'comment', commentId: 'c1' });
    const gone = comment({ isUnavailable: true });
    expect(targetOf(gone)).toBeNull();
    expect(snippetOf(gone)).toEqual({
      text: "The comment has been deleted or you don't have access to it anymore.",
      muted: true,
    });
    expect(snippetOf(comment())).toEqual({ text: 'Can you review this, @Ada?', muted: false });
  });

  it('compact times', () => {
    const now = Date.parse('2026-10-14T12:00:00.000Z');
    expect(shortAgo('2026-10-14T11:59:50.000Z', now)).toBe('now');
    expect(shortAgo('2026-10-14T11:55:00.000Z', now)).toBe('5m');
    expect(shortAgo('2026-10-14T09:00:00.000Z', now)).toBe('3h');
    expect(shortAgo('2026-10-12T12:00:00.000Z', now)).toBe('2d');
  });
  it('workflow run failures name the workflow, quote the error and open the run', () => {
    const failed = {
      ...base,
      type: 'workflow-run-failed',
      subject: null,
      entries: [
        {
          id: 'e1',
          type: 'workflow-run-failed',
          actor: { type: 'workflow', id: 'w1' },
          payload: {
            workflowId: 'w1',
            workflowTitle: 'Deal follow-up',
            workflowVersionId: 'v1',
            workflowRunId: 'r1',
            failureReason: 'execution-error',
            errorMessage: 'Request failed: connection refused',
          },
          createdAt: '2026-10-14T10:00:00.000Z',
          readAt: null,
          resolvedAt: null,
        },
      ],
    } as unknown as NotificationGroup;
    expect(titleParts(failed)).toEqual([
      { text: 'The ' },
      { text: 'Deal follow-up', strong: true },
      { text: ' workflow failed' },
    ]);
    expect(snippetOf(failed)).toEqual({ text: 'Request failed: connection refused', muted: false });
    expect(targetOf(failed)).toEqual({ kind: 'workflow-run', workflowId: 'w1', versionId: 'v1', runId: 'r1' });
  });
});
