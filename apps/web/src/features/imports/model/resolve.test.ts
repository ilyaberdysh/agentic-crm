import type { AttributeDefinition, PipelineStage, SelectOption, WorkspaceMember } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  detectDateFormat,
  EMPTY_CONFIG,
  effectiveValues,
  missingOptionsOf,
  needsReview,
  parseDateWith,
  parseNumberWith,
  parseTimestampWith,
  resolveRaw,
} from './resolve';

const attr = (over: Partial<AttributeDefinition>): AttributeDefinition =>
  ({
    id: 'a1',
    workspaceId: 'w',
    entityDefinitionId: 'd',
    apiSlug: 'x',
    title: 'X',
    description: '',
    type: 'text',
    isMultiselect: false,
    isUnique: false,
    isRequired: false,
    isHistoric: false,
    isArchived: false,
    isSystem: false,
    systemAttributeType: null,
    isReadOnly: false,
    isHidden: false,
    config: {},
    defaultValue: null,
    relationship: null,
    interfaceAttributeId: null,
    sortOrder: 'm',
    createdBy: { type: 'system', id: null },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as AttributeDefinition;

const opt = (id: string, title: string): SelectOption => ({
  id,
  title,
  workspaceId: 'w',
  entityDefinitionId: 'd',
  attributeDefinitionId: 'a1',
  color: 'pastel_blue',
  sortOrder: 'a',
  isArchived: false,
  createdAt: '',
});

const ctx = (over: Partial<Parameters<typeof resolveRaw>[2]> = {}) => ({ config: EMPTY_CONFIG, field: null, ...over });

describe('numbers', () => {
  it('reads "12500,50" by the decimal separator (Attio: Point → 1,250,050; Comma → 12 500,50)', () => {
    expect(parseNumberWith('12500,50', 'point')).toBe(1250050);
    expect(parseNumberWith('12500,50', 'comma')).toBe(12500.5);
    expect(parseNumberWith('1.200,5', 'comma')).toBe(1200.5);
    expect(parseNumberWith('two', 'point')).toBeNull();
  });

  it('marks invalid numbers', () => {
    expect(resolveRaw(attr({ type: 'number' }), 'two', ctx())).toEqual([{ type: 'error', message: 'Invalid number' }]);
    expect(resolveRaw(attr({ type: 'number' }), '4', ctx())).toEqual([{ type: 'value', value: 4 }]);
  });

  it('parses currencies with symbols and codes', () => {
    expect(resolveRaw(attr({ type: 'currency' }), '€8,000', ctx())).toEqual([
      { type: 'value', value: { currencyValue: 8000, currencyCode: 'EUR' } },
    ]);
  });
});

describe('dates', () => {
  it('parses per format and detects European dates', () => {
    expect(parseDateWith('14/07/2026', 'uk')).toBe('2026-07-14');
    expect(parseDateWith('14/07/2026', 'us')).toBeNull();
    expect(parseDateWith('07/14/2026', 'us')).toBe('2026-07-14');
    expect(parseDateWith('15 May 2024', 'uk')).toBe('2024-05-15');
    expect(parseDateWith('May 15th 2024', 'us')).toBe('2024-05-15');
    expect(parseDateWith('2024-05-15', 'uk')).toBe('2024-05-15');
    expect(detectDateFormat(['14/07/2026', '31/12/2026', ''])).toBe('uk');
    expect(detectDateFormat(['2026-07-14'])).toBe('iso');
  });

  it('parses timestamps as UTC when no zone is given', () => {
    expect(parseTimestampWith('2026-07-14T09:30:00Z', 'iso')).toBe('2026-07-14T09:30:00.000Z');
    expect(parseTimestampWith('2026-12-31', 'iso')).toBe('2026-12-31T00:00:00.000Z');
    expect(parseTimestampWith('31/12/2026 3:00 pm', 'uk')).toBe('2026-12-31T15:00:00.000Z');
  });
});

describe('choices and references', () => {
  const tags = attr({ type: 'select', isMultiselect: true });
  const options = [opt('o1', 'AI'), opt('o2', 'Data')];

  it('splits multi-selects and flags unknown options', () => {
    const parts = resolveRaw(tags, 'AI, Imported', ctx({ options }));
    expect(parts).toEqual([
      { type: 'value', value: { selectOptionId: 'o1' } },
      { type: 'missing-option', title: 'Imported' },
    ]);
    const v = { resolved: parts, override: null };
    expect(needsReview(v)).toBe(true);
    expect(effectiveValues(v)).toEqual([{ selectOptionId: 'o1' }]);
    expect(missingOptionsOf([v])).toEqual(['Imported']);
  });

  it('matches statuses case-insensitively', () => {
    const stages = [{ ...opt('s1', 'Discovery'), lifecyclePhase: 'ACTIVE' } as PipelineStage];
    expect(resolveRaw(attr({ type: 'pipeline' }), 'discovery', ctx({ stages }))).toEqual([
      { type: 'value', value: { pipelineStageId: 's1' } },
    ]);
    expect(resolveRaw(attr({ type: 'pipeline' }), 'Unknown phase', ctx({ stages }))[0]?.type).toBe('missing-option');
  });

  it('resolves members by id, email or name', () => {
    const members = [
      {
        id: '5e42ee98-da7c-49f4-a2da-5947fa5da7f1',
        emailAddress: 'ada@x.io',
        firstName: 'Ada',
        lastName: 'Tester',
        suspendedAt: null,
      } as WorkspaceMember,
    ];
    const owner = attr({ type: 'actor-reference' });
    expect(resolveRaw(owner, '5e42ee98-da7c-49f4-a2da-5947fa5da7f1', ctx({ members }))[0]?.type).toBe('value');
    expect(resolveRaw(owner, 'ada tester', ctx({ members }))[0]?.type).toBe('value');
    expect(resolveRaw(owner, 'Nobody Seed', ctx({ members }))).toEqual([{ type: 'error', message: 'Invalid actor' }]);
  });

  it('checkbox takes true/false only and ratings 0–5', () => {
    expect(resolveRaw(attr({ type: 'checkbox' }), 'no', ctx())[0]?.type).toBe('error');
    expect(resolveRaw(attr({ type: 'checkbox' }), 'TRUE', ctx())).toEqual([{ type: 'value', value: true }]);
    expect(resolveRaw(attr({ type: 'rating' }), '9', ctx())).toEqual([{ type: 'error', message: 'Invalid rating' }]);
  });

  it('skips empty cells and honours overrides', () => {
    expect(resolveRaw(attr({ type: 'number' }), '  ', ctx())).toEqual([]);
    const bad = { resolved: [{ type: 'error' as const, message: 'Invalid number' }], override: { values: [2] } };
    expect(needsReview(bad)).toBe(false);
    expect(effectiveValues(bad)).toEqual([2]);
    expect(effectiveValues({ ...bad, override: { skip: true } })).toEqual([]);
  });

  it('splits names for the full-name part', () => {
    expect(resolveRaw(attr({ type: 'personal-name' }), 'Ada Lovelace', ctx({ field: 'full_name' }))).toEqual([
      { type: 'value', value: { firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' } },
    ]);
  });
});
