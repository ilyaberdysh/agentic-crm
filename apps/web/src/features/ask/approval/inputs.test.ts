import { describe, expect, it } from 'vitest';
import {
  dueDateOf,
  editedValue,
  noteDraftFrom,
  noteInputFrom,
  recordInputFrom,
  taskDraftFrom,
  taskInputFrom,
  valueRowsOf,
  valueText,
} from './inputs';

const DEF = '11111111-1111-4111-8111-111111111111';
const REC = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';

describe('task approval input', () => {
  const call = {
    body: '[seed] AI follow-up call',
    due_date: '2026-10-10',
    assignee_member_ids: [MEMBER],
    linked_records: [{ entity_definition_id: DEF, entity_instance_id: REC }],
  };

  it('parses the model call into an editable draft', () => {
    expect(taskDraftFrom(call)).toEqual({
      body: '[seed] AI follow-up call',
      due: '2026-10-10',
      assignees: [MEMBER],
      linked: [{ entityDefinitionId: DEF, entityInstanceId: REC }],
    });
  });

  it('writes the edits back and carries over everything else', () => {
    const draft = { ...taskDraftFrom(call), body: '  Edited title ', due: null, linked: [] };
    expect(taskInputFrom({ ...call, task_id: 't1' }, draft)).toEqual({
      task_id: 't1',
      body: 'Edited title',
      due_date: null,
      assignee_member_ids: [MEMBER],
      linked_records: [],
    });
  });

  it('reads an ISO timestamp as a date in the given zone', () => {
    expect(dueDateOf('2026-10-10T23:30:00Z', 'Europe/Moscow')).toBe('2026-10-11');
    expect(dueDateOf('2026-10-10T23:30:00Z', 'America/New_York')).toBe('2026-10-10');
    expect(dueDateOf('not a date')).toBeNull();
    expect(dueDateOf(null)).toBeNull();
  });

  it('survives an empty or malformed input', () => {
    expect(taskDraftFrom(null)).toEqual({ body: '', due: null, assignees: [], linked: [] });
    expect(taskDraftFrom({ linked_records: [{ entity_definition_id: 1 }] }).linked).toEqual([]);
  });
});

describe('record approval input', () => {
  const call = {
    object: 'companies',
    values: {
      name: 'Acme',
      employees: 12,
      categories: ['SaaS', 'B2B'],
      owner: { entity_definition_id: DEF, entity_instance_id: REC },
    },
  };

  it('lists the proposed attributes; only text and numbers are editable', () => {
    expect(valueRowsOf(call).map((r) => [r.key, r.editable])).toEqual([
      ['name', true],
      ['employees', true],
      ['categories', false],
      ['owner', false],
    ]);
  });

  it('keeps only the rows left in the card, with edited values', () => {
    const rows = valueRowsOf(call).filter((r) => r.key !== 'categories');
    const edited = rows.map((r) => (r.key === 'name' ? { ...r, value: 'Acme Inc' } : r));
    expect(recordInputFrom(call, edited)).toEqual({
      object: 'companies',
      values: { name: 'Acme Inc', employees: 12, owner: call.values.owner },
    });
  });

  it('formats values for one line and keeps numbers numeric when edited', () => {
    expect(valueText(['a', 'b'])).toBe('a, b');
    expect(valueText(null)).toBe('Empty');
    expect(valueText(call.values.owner)).toBe('Linked record');
    expect(editedValue(12, '15')).toBe(15);
    expect(editedValue(12, 'abc')).toBe('abc');
    expect(editedValue('x', '15')).toBe('15');
  });
});

describe('note approval input', () => {
  it('edits the title and the content, not the parent record', () => {
    const call = {
      parent_record: { entity_definition_id: DEF, entity_instance_id: REC },
      title: 'Call notes',
      content: '- a',
    };
    const draft = noteDraftFrom(call);
    expect(draft.parent).toEqual({ entityDefinitionId: DEF, entityInstanceId: REC });
    expect(noteInputFrom(call, { ...draft, title: 'Renamed' })).toEqual({ ...call, title: 'Renamed' });
  });
});
