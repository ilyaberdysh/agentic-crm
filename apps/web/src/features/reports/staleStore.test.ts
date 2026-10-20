import type { InvalidationMessage } from '@agentic-crm/realtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { recordStale, resetStale, staleSeqFor } from './staleStore';

const freshness = { seq: '100', entityDefinitionIds: ['def-a'], attributeDefinitionIds: ['attr-1', 'attr-2'] };

const stale = (seq: string, def: string, attrs: string[] | null, workspaceId = 'ws'): InvalidationMessage => ({
  type: 'invalidate',
  seq,
  workspaceId,
  resource: 'report-stale',
  resourceId: def,
  scope: { entityDefinitionId: def, attributeDefinitionIds: attrs },
});

// staleSeqFor reads the module's own store; the helpers below feed it through recordStale.
describe('report-stale rule (slice9-server.md "New data rule")', () => {
  beforeEach(() => resetStale());

  it('is fresh without messages', () => {
    expect(staleSeqFor('ws', freshness)).toBeNull();
  });

  it('a newer message for a dependency definition and attribute makes the dataset stale', () => {
    recordStale(stale('101', 'def-a', ['attr-2']));
    expect(staleSeqFor('ws', freshness)).toBe('101');
  });

  it('null attributes (records added or removed) match every dataset over the definition', () => {
    recordStale(stale('105', 'def-a', null));
    expect(staleSeqFor('ws', freshness)).toBe('105');
  });

  it('ignores messages at or before the dataset seq, other definitions, other attributes and other workspaces', () => {
    recordStale(stale('100', 'def-a', null));
    recordStale(stale('120', 'def-b', null));
    recordStale(stale('121', 'def-a', ['attr-9']));
    recordStale(stale('122', 'def-a', null, 'other-ws'));
    expect(staleSeqFor('ws', freshness)).toBeNull();
  });

  it('answers the newest matching seq (compared as numbers, not strings)', () => {
    recordStale(stale('9', 'def-a', null));
    recordStale(stale('1000', 'def-a', ['attr-1']));
    recordStale(stale('101', 'def-a', null));
    expect(staleSeqFor('ws', { ...freshness, seq: '8' })).toBe('1000');
    expect(staleSeqFor('ws', { ...freshness, seq: '1000' })).toBeNull();
  });

  it('a refreshed dataset (newer freshness seq) is fresh again', () => {
    recordStale(stale('101', 'def-a', null));
    expect(staleSeqFor('ws', { ...freshness, seq: '101' })).toBeNull();
  });

  it('ignores other resources', () => {
    recordStale({ ...stale('150', 'def-a', null), resource: 'entity-instance' });
    expect(staleSeqFor('ws', freshness)).toBeNull();
  });
});
