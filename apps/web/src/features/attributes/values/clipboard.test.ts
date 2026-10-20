import { describe, expect, it } from 'vitest';
import type { FormatSettings } from '../format/locale';
import { attr, row } from '../test/fixtures';
import { copyTextOf, type PasteContext, pasteValueOf } from './clipboard';
import {
  parseBoolean,
  parseCurrencyAmount,
  parseDateText,
  parseNumber,
  parseRating,
  parseTimestampText,
  parseTimeText,
  splitName,
  zonedToInstant,
} from './parse';

const settings: FormatSettings = { locale: 'ru-RU', timeZone: 'Europe/Moscow', weekStartsOn: 1 };
const option = (id: string, title: string, isArchived = false) => ({
  id,
  workspaceId: 'w',
  entityDefinitionId: 'd',
  attributeDefinitionId: 'a',
  title,
  color: 'pastel_grey',
  sortOrder: 'm',
  isArchived,
  createdAt: '2026-01-01T00:00:00Z',
});
const ctx: PasteContext = {
  settings,
  today: '2026-10-10',
  options: [option('o-ai', 'AI'), option('o-crm', 'CRM'), option('o-old', 'Old', true)],
  stages: [
    { ...option('s-build', 'Build'), lifecyclePhase: 'ACTIVE', targetTimeInStatus: null, celebrationEnabled: false },
  ],
  members: [
    {
      id: 'm1',
      workspaceId: 'w',
      userId: 'u',
      accessLevel: 'admin',
      emailAddress: 'ilya@mymeet.ai',
      firstName: 'Ilya',
      lastName: 'Berdysh',
      suspendedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    },
  ],
};

describe('parsing typed text', () => {
  it('parses numbers in both separator conventions', () => {
    expect(parseNumber('1 200,5', 'ru-RU')).toBe(1200.5);
    expect(parseNumber('1,200.5')).toBe(1200.5);
    expect(parseNumber('1,200')).toBe(1200);
    expect(parseNumber('1,200', 'ru-RU')).toBe(1.2);
    expect(parseNumber('1.200.000')).toBe(1200000);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('(42)')).toBe(-42);
    expect(parseNumber('12%')).toBe(12);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('parses currency amounts with symbols and codes', () => {
    expect(parseCurrencyAmount('250 000,00 €', 'ru-RU')).toBe(250000);
    expect(parseCurrencyAmount('$1,200')).toBe(1200);
    expect(parseCurrencyAmount('EUR 15000')).toBe(15000);
  });

  it('parses booleans, ratings and names', () => {
    expect(parseBoolean('Yes')).toBe(true);
    expect(parseBoolean('✓')).toBe(true);
    expect(parseBoolean('false')).toBe(false);
    expect(parseBoolean('maybe')).toBeNull();
    expect(parseRating('★★★☆☆')).toBe(3);
    expect(parseRating('4/5')).toBe(4);
    expect(parseRating('7')).toBeNull();
    expect(splitName('  Jane   van Cooper ')).toEqual({
      firstName: 'Jane',
      lastName: 'van Cooper',
      fullName: 'Jane van Cooper',
    });
    expect(splitName('Plato')).toEqual({ firstName: 'Plato', lastName: '', fullName: 'Plato' });
  });

  it('parses dates in the picker order and common forms', () => {
    expect(parseDateText('10/09/2026', '2026-10-10')).toBe('2026-10-09');
    expect(parseDateText('2026-03-01', '2026-10-10')).toBe('2026-03-01');
    expect(parseDateText('Mar 1st, 2026', '2026-10-10')).toBe('2026-03-01');
    expect(parseDateText('1 March 2026', '2026-10-10')).toBe('2026-03-01');
    expect(parseDateText('09.10.2026', '2026-10-10')).toBe('2026-10-09');
    expect(parseDateText('tomorrow', '2026-10-10')).toBe('2026-10-11');
    expect(parseDateText('02/30/2026', '2026-10-10')).toBeNull();
  });

  it('parses times and zoned timestamps', () => {
    expect(parseTimeText('12:30pm')).toBe(750);
    expect(parseTimeText('12:05 AM')).toBe(5);
    expect(parseTimeText('9am')).toBe(540);
    expect(parseTimeText('14:05')).toBe(845);
    expect(parseTimeText('13pm')).toBeNull();
    expect(zonedToInstant('2026-03-01', 750, 'Europe/Moscow')).toBe('2026-03-01T09:30:00.000Z');
    expect(zonedToInstant('2026-07-01', 600, 'Europe/London')).toBe('2026-07-01T09:00:00.000Z');
    expect(parseTimestampText('Mar 1, 2026 12:30pm', '2026-10-10', 'Europe/Moscow')).toBe('2026-03-01T09:30:00.000Z');
  });
});

describe('copy', () => {
  it('copies the displayed text; numbers raw', () => {
    const n = attr('number');
    expect(copyTextOf(n, [row(n, 1200.5)], undefined)).toBe('1200.5');
    const d = attr('date');
    expect(copyTextOf(d, [row(d, '2026-03-01')], undefined)).toBe('Mar 1, 2026');
    const e = attr('email-address', { isMultiselect: true });
    expect(
      copyTextOf(e, [row(e, 'a@x.com', { sortOrder: 'a' }), row(e, 'b@y.com', { sortOrder: 'b' })], undefined),
    ).toBe('a@x.com, b@y.com');
  });
});

describe('single-cell paste', () => {
  it('parses each type or rejects with null', () => {
    expect(pasteValueOf(attr('text'), 'hello\n', ctx)).toEqual([{ value: 'hello' }]);
    expect(pasteValueOf(attr('number'), '1 200,5', ctx)).toEqual([{ value: 1200.5 }]);
    expect(pasteValueOf(attr('number'), 'x', ctx)).toBeNull();
    const budget = attr('currency', {
      config: {
        currencyConfiguration: {
          defaultCurrencyCode: 'EUR',
          defaultDisplayType: 'symbol',
          defaultDecimalPlaces: 'two-decimals',
          defaultGroups: 'default',
        },
      },
    });
    expect(pasteValueOf(budget, '250 000,00 €', ctx)).toEqual([
      { value: { currencyValue: 250000, currencyCode: 'EUR' } },
    ]);
    expect(pasteValueOf(attr('checkbox'), 'yes', ctx)).toEqual([{ value: true }]);
    expect(pasteValueOf(attr('rating'), '0', ctx)).toEqual([]);
    expect(pasteValueOf(attr('date'), 'Mar 1, 2026', ctx)).toEqual([{ value: '2026-03-01' }]);
    expect(pasteValueOf(attr('pipeline'), 'build', ctx)).toEqual([{ value: { pipelineStageId: 's-build' } }]);
    expect(pasteValueOf(attr('select'), 'crm', ctx)).toEqual([{ value: { selectOptionId: 'o-crm' } }]);
    expect(pasteValueOf(attr('select'), 'Old', ctx)).toBeNull(); // archived options are not pasteable
    expect(pasteValueOf(attr('select', { isMultiselect: true }), 'AI, CRM, Nope', ctx)).toEqual([
      { value: { selectOptionId: 'o-ai' } },
      { value: { selectOptionId: 'o-crm' } },
    ]);
    expect(pasteValueOf(attr('actor-reference'), 'ilya@mymeet.ai', ctx)).toEqual([
      { value: { referencedActorType: 'workspace-member', referencedActorId: 'm1' } },
    ]);
    expect(pasteValueOf(attr('email-address', { isMultiselect: true }), 'a@x.com, nope, b@y.com', ctx)).toEqual([
      { value: 'a@x.com' },
      { value: 'b@y.com' },
    ]);
    expect(pasteValueOf(attr('email-address'), 'nope', ctx)).toBeNull();
    expect(pasteValueOf(attr('domain'), 'https://www.Example.com/x', ctx)).toEqual([
      { value: 'https://www.Example.com/x' },
    ]);
    expect(pasteValueOf(attr('phone-number'), '+44 20 7123 4567', ctx)).toEqual([
      { value: { originalPhoneNumber: '+44 20 7123 4567', countryCode: null } },
    ]);
    expect(pasteValueOf(attr('interaction'), 'x', ctx)).toBeNull();
    expect(pasteValueOf(attr('personal-name'), 'Jane Cooper', ctx)).toEqual([
      { value: { firstName: 'Jane', lastName: 'Cooper', fullName: 'Jane Cooper' } },
    ]);
    expect(pasteValueOf(attr('text'), '   ', ctx)).toEqual([]);
  });
});
