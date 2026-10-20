import { describe, expect, it } from 'vitest';
import { creatableAttributes, defaultInputs } from './NewRecordDialog';
import { attr } from './test/fixtures';

describe('NewRecordDialog fields', () => {
  it('offers writable attributes only (no read-only system, computed, archived or hidden ones)', () => {
    const list = [
      attr('text', { apiSlug: 'name' }),
      attr('text', { apiSlug: 'record_id', isSystem: true, isReadOnly: true, systemAttributeType: 'id' }),
      attr('timestamp', { apiSlug: 'created_at', isReadOnly: true }),
      attr('interaction', { apiSlug: 'last_interaction' }),
      attr('select', { apiSlug: 'old', isArchived: true }),
      attr('entity-reference', { apiSlug: 'list_entries', isHidden: true }),
      attr('pipeline', { apiSlug: 'stage', isRequired: true }),
    ];
    expect(creatableAttributes(list).map((a) => a.apiSlug)).toEqual(['name', 'stage']);
  });

  it('prefills defaults: static value arrays, dynamic dates and the current user', () => {
    const now = new Date('2026-10-09T14:20:00Z');
    const status = attr('pipeline', {
      defaultValue: { type: 'static', identifier: JSON.stringify([{ pipelineStageId: 'lead' }]) },
    });
    expect(defaultInputs(status, null, now)).toEqual([{ value: { pipelineStageId: 'lead' } }]);
    const owner = attr('actor-reference', { defaultValue: { type: 'dynamic', identifier: 'current-user' } });
    expect(defaultInputs(owner, 'm1', now)).toEqual([
      { value: { referencedActorType: 'workspace-member', referencedActorId: 'm1' } },
    ]);
    const due = attr('timestamp', { defaultValue: { type: 'dynamic', identifier: 'PT0S' } });
    expect(defaultInputs(due, null, now)).toEqual([{ value: '2026-10-09T14:20:00.000Z' }]);
    expect(defaultInputs(attr('text'), null, now)).toEqual([]);
  });
});
