import type { InvalidationMessage } from '@agentic-crm/realtime';
import { describe, expect, it } from 'vitest';
import { invalidationFilters } from './invalidation';

const msg = (
  resource: InvalidationMessage['resource'],
  resourceId: string | null,
  scope = {},
): InvalidationMessage => ({
  type: 'invalidate',
  seq: '1',
  workspaceId: 'w',
  resource,
  resourceId,
  scope,
});

const keysOf = (m: InvalidationMessage) => invalidationFilters(m).map((f) => f.queryKey);

describe('slice 3 invalidations', () => {
  it('notes, tasks and comments refresh every query of their resource', () => {
    expect(keysOf(msg('note', 'n1'))).toEqual([['ws', 'w', 'note']]);
    expect(keysOf(msg('task-list', null))).toEqual([['ws', 'w', 'task-list']]);
    expect(keysOf(msg('comment-thread', 't1'))).toEqual([['ws', 'w', 'comment-thread']]);
  });

  it('favourites also refresh note, template and dashboard reads (they carry favoriteId)', () => {
    expect(keysOf(msg('favorite-list', 'm1'))).toEqual([
      ['ws', 'w', 'favorite-list'],
      ['ws', 'w', 'note'],
      ['ws', 'w', 'note-list'],
      ['ws', 'w', 'note-template'],
      ['ws', 'w', 'note-template-list'],
      ['ws', 'w', 'reporting-dashboard'],
      ['ws', 'w', 'reporting-dashboard-list'],
    ]);
  });

  it('a stored note body refreshes its projection, the note and note lists', () => {
    expect(keysOf(msg('document', 'd1', { docType: 'note', parentRef: 'n1' }))).toEqual([
      ['ws', 'w', 'document', 'd1'],
      ['ws', 'w', 'note-list'],
      ['ws', 'w', 'note', 'n1'],
    ]);
    expect(keysOf(msg('document', 'd2', { docType: 'note-template', parentRef: 't1' }))).toEqual([
      ['ws', 'w', 'document', 'd2'],
      ['ws', 'w', 'note-template-list'],
      ['ws', 'w', 'note-template', 't1'],
    ]);
  });
});
