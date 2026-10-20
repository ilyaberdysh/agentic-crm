import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attr, row } from '../test/fixtures';
import type { ValueLookup } from '../types';
import {
  formatAggregate,
  formatAggregateResult,
  formatCurrency,
  formatDateAbsolute,
  formatDateRelative,
  formatHistoryTimestamp,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTimestampAbsolute,
  formatValue,
  ordinal,
} from './formatValue';
import { getFormatSettings, setFormatSettings, weekStartForLocale } from './locale';

// Intl output uses narrow / no-break spaces; compare with plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, ' ');

const RU = { locale: 'ru-RU', timeZone: 'Europe/Moscow', weekStartsOn: 1 };
const US = { locale: 'en-US', timeZone: 'America/New_York', weekStartsOn: 0 };

beforeEach(() => setFormatSettings(RU));
afterEach(() => setFormatSettings(null));

describe('numbers and currency (X-11: one locale)', () => {
  it('formats numbers in the user locale with column overrides', () => {
    expect(plain(formatNumber(1200.5))).toBe('1 200,5');
    expect(plain(formatNumber(1200.5, { grouping: 'no-groups' }))).toBe('1200,5');
    expect(plain(formatNumber(6, { decimals: 2 }))).toBe('6,00');
    expect(formatNumber(1200.5, {}, { ...US })).toBe('1,200.5');
  });

  it('formats currency like the curated screenshots (ru-RU)', () => {
    expect(plain(formatCurrency(250000, 'EUR'))).toBe('250 000,00 €');
    expect(plain(formatCurrency(250000, 'EUR', { display: 'code' }))).toBe('250 000,00 EUR');
    expect(plain(formatCurrency(45000, 'USD'))).toBe('45 000,00 $');
    expect(plain(formatCurrency(9000, 'EUR', { decimals: 'no-decimals' }))).toBe('9 000 €');
    expect(formatCurrency(734000, 'EUR', {}, US)).toBe('€734,000.00');
  });

  it('formats percentages with at most two decimals', () => {
    expect(plain(formatPercent(41.6666))).toBe('41,67 %');
    expect(formatPercent(0, US)).toBe('0%');
  });

  it('formats cells and footer calculations with the same locale', () => {
    const budget = attr('currency', { config: { currencyConfiguration: currencyConfig('EUR') } });
    const cell = plain(formatValue(budget, [row(budget, { currencyValue: 734000, currencyCode: null })]));
    const sum = formatAggregate('sum', 734000, budget);
    expect(plain(sum.value)).toBe(cell);
    expect(sum.suffix).toBe('sum');
    const headcount = attr('number');
    expect(plain(formatAggregate('mean', 6, headcount).value)).toBe('6,00');
    expect(formatAggregate('mean', 6, headcount).suffix).toBe('avg');
    expect(formatAggregate('count_not_empty', 12, headcount)).toEqual({ value: '12', suffix: 'filled' });
    expect(plain(formatAggregate('percent_not_empty', 41.6666, attr('checkbox')).value)).toBe('41,67 %');
    expect(formatAggregate('percent_not_empty', 0, attr('checkbox')).suffix).toBe('checked');
  });
});

describe('snapshots.aggregate results', () => {
  it('formats every kind with the cell rules (valueText dates, currency code, checkbox kinds)', () => {
    const start = attr('date');
    expect(
      formatAggregateResult(
        { aggregation: 'earliest', value: null, valueText: '2026-03-01', currencyCode: null },
        start,
      ),
    ).toEqual({
      value: 'Mar 1, 2026',
      suffix: 'earliest',
    });
    const kickoff = attr('timestamp');
    expect(
      formatAggregateResult(
        { aggregation: 'max', value: null, valueText: '2026-03-01T09:30:00Z', currencyCode: null },
        kickoff,
      ).value,
    ).toBe('Mar 1st 2026, 12:30pm');
    const value = attr('currency', { config: { currencyConfiguration: currencyConfig('USD') } });
    expect(
      plain(
        formatAggregateResult({ aggregation: 'sum', value: 45000, valueText: null, currencyCode: 'USD' }, value).value,
      ),
    ).toBe('45 000,00 $');
    const done = attr('checkbox');
    expect(
      formatAggregateResult({ aggregation: 'count_checked', value: 4, valueText: null, currencyCode: null }, done),
    ).toEqual({
      value: '4',
      suffix: 'checked',
    });
    expect(
      formatAggregateResult(
        { aggregation: 'count_unique', value: 3, valueText: null, currencyCode: null },
        attr('select'),
      ).suffix,
    ).toBe('unique');
    expect(
      formatAggregateResult({ aggregation: 'median', value: null, valueText: null, currencyCode: null }, attr('number'))
        .value,
    ).toBe('–');
  });
});

function currencyConfig(code: 'EUR' | 'USD') {
  return {
    defaultCurrencyCode: code,
    defaultDisplayType: 'symbol' as const,
    defaultDecimalPlaces: 'two-decimals' as const,
    defaultGroups: 'default' as const,
  };
}

describe('dates and times (English patterns, user time zone)', () => {
  it('formats absolute dates and timestamps like Attio cells', () => {
    expect(formatDateAbsolute('2026-03-01')).toBe('Mar 1, 2026');
    // The research seed stores 09:30Z; the reference browser (Europe/Moscow) shows 12:30pm.
    expect(formatTimestampAbsolute('2026-03-01T09:30:00.000000Z')).toBe('Mar 1st 2026, 12:30pm');
    expect(formatTimestampAbsolute('2026-10-22T21:05:00Z', US)).toBe('Oct 22nd 2026, 5:05pm');
    expect(formatHistoryTimestamp('2026-10-09T14:06:00Z')).toBe('9 Oct 2026 5:06 PM');
  });

  it('uses ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
    ]);
  });

  it('formats relative dates and times', () => {
    const now = new Date('2026-10-10T09:00:00Z');
    expect(formatDateRelative('2026-10-10', now)).toBe('today');
    expect(formatDateRelative('2026-10-11', now)).toBe('tomorrow');
    expect(formatDateRelative('2026-10-06', now)).toBe('4 days ago');
    expect(formatDateRelative('2026-10-13', now)).toBe('in 3 days');
    expect(formatRelativeTime('2026-10-10T08:47:00Z', now)).toBe('13 minutes ago');
    expect(formatRelativeTime('2026-10-10T08:59:40Z', now)).toBe('now');
    expect(formatRelativeTime('2026-10-10T03:00:00Z', now)).toBe('6 hours ago');
    expect(formatRelativeTime('2025-10-12T09:00:00Z', now)).toBe('12 months ago');
    expect(formatRelativeTime('2024-09-01T09:00:00Z', now)).toBe('2 years ago');
    expect(formatRelativeTime('2026-10-12T09:00:00Z', now)).toBe('in 2 days');
  });

  it('derives the week start from the locale', () => {
    expect(weekStartForLocale('ru-RU')).toBe(1);
    expect(weekStartForLocale('en-US')).toBe(0);
    expect(getFormatSettings().weekStartsOn).toBe(1);
  });
});

describe('formatValue per type', () => {
  const lookup: ValueLookup = {
    option: (_a, id) => (id === 'o1' ? optionFixture('o1', 'High') : undefined),
    stage: (_a, id) =>
      id === 's1'
        ? {
            ...optionFixture('s1', 'Build'),
            lifecyclePhase: 'ACTIVE',
            targetTimeInStatus: null,
            celebrationEnabled: false,
          }
        : undefined,
    member: (id) =>
      id === 'm1'
        ? {
            id: 'm1',
            workspaceId: 'w',
            userId: 'u',
            accessLevel: 'admin',
            emailAddress: 'ilya@mymeet.ai',
            firstName: 'Ilya',
            lastName: 'Berdysh',
            suspendedAt: null,
            createdAt: '2026-01-01T00:00:00Z',
          }
        : undefined,
    recordTitle: (_d, id) => (id === 'r1' ? '[seed] Northwind Robotics' : undefined),
  };

  it('renders every type as text', () => {
    const cases: Array<[ReturnType<typeof attr>, unknown, string, string?]> = [
      [attr('text'), 'Route optimisation v2', 'Route optimisation v2'],
      [attr('number'), 20, '20'],
      [attr('checkbox'), true, 'true'],
      [attr('date'), '2026-03-01', 'Mar 1, 2026'],
      [attr('timestamp'), '2026-03-01T09:30:00Z', 'Mar 1st 2026, 12:30pm'],
      [attr('rating'), 4, '4'],
      [attr('pipeline'), { pipelineStageId: 's1' }, 'Build'],
      [attr('select'), { selectOptionId: 'o1' }, 'High'],
      [attr('entity-reference'), { entityDefinitionId: 'd', entityInstanceId: 'r1' }, '[seed] Northwind Robotics'],
      [attr('actor-reference'), { referencedActorType: 'workspace-member', referencedActorId: 'm1' }, 'Ilya Berdysh'],
      [attr('actor-reference'), { referencedActorType: 'api-token', referencedActorId: 't1' }, 'API token'],
      [
        attr('domain'),
        { normalizedDomain: 'northwind.example.com', rootDomain: 'example.com' },
        'northwind.example.com',
      ],
      [
        attr('email-address'),
        {
          originalEmailAddress: 'Jane.Cooper@northwind.example.com',
          normalizedEmailAddress: 'jane.cooper@northwind.example.com',
          emailDomain: 'northwind.example.com',
          emailRootDomain: 'example.com',
          emailLocalSpecifier: '',
        },
        'Jane.Cooper@northwind.example.com',
      ],
      [
        attr('phone-number'),
        { originalPhoneNumber: '+442071234567', countryCode: 'GB', normalizedPhoneNumber: '+442071234567' },
        '+442071234567',
      ],
      [attr('personal-name'), { firstName: 'Jane', lastName: 'Cooper', fullName: 'Jane Cooper' }, 'Jane Cooper'],
    ];
    for (const [a, value, expected] of cases) expect(formatValue(a, [row(a, value)], { lookup })).toBe(expected);
  });

  it('renders sub-fields and joins multiple values', () => {
    const office = attr('location');
    const loc = { line1: '1 Main St', locality: 'London', region: null, postcode: 'SW1', countryCode: 'GB' };
    expect(formatValue(office, [row(office, loc)], { field: 'locality' })).toBe('London');
    expect(formatValue(office, [row(office, loc)], { field: 'country_code' })).toBe('United Kingdom');
    expect(formatValue(office, [row(office, loc)])).toBe('1 Main St, London, SW1, United Kingdom');
    const name = attr('personal-name');
    const n = { firstName: 'Jane', lastName: 'Cooper', fullName: 'Jane Cooper' };
    expect(formatValue(name, [row(name, n)], { field: 'last_name' })).toBe('Cooper');
    const tags = attr('select', { isMultiselect: true });
    expect(
      formatValue(
        tags,
        [
          row(tags, { selectOptionId: 'o1' }, { sortOrder: 'b' }),
          row(tags, { selectOptionId: 'o1' }, { sortOrder: 'a' }),
        ],
        { lookup },
      ),
    ).toBe('High, High');
    // Retired rows never show.
    expect(formatValue(attr('text'), [row(attr('text'), 'old', { activeUntil: '2026-10-09T13:00:00Z' })])).toBe('');
  });

  it('honours column formatting overrides', () => {
    const budget = attr('currency', { config: { currencyConfiguration: currencyConfig('EUR') } });
    const v = [row(budget, { currencyValue: 250000, currencyCode: null })];
    expect(plain(formatValue(budget, v, { format: { currencyConfiguration: { displayType: 'code' } } }))).toBe(
      '250 000,00 EUR',
    );
    expect(plain(formatValue(budget, v, { format: { currencyConfiguration: { decimalPlaces: 'no-decimals' } } }))).toBe(
      '250 000 €',
    );
    const n = attr('number');
    expect(
      plain(
        formatValue(n, [row(n, 1200.5)], {
          format: { numberConfiguration: { decimalPlaces: 2, groups: 'no-groups' } },
        }),
      ),
    ).toBe('1200,50');
    const d = attr('date');
    expect(
      formatValue(d, [row(d, '2026-10-06')], {
        format: { datetimeConfiguration: { displayType: 'relative' } },
        now: new Date('2026-10-10T09:00:00Z'),
      }),
    ).toBe('4 days ago');
  });
});

function optionFixture(id: string, title: string) {
  return {
    id,
    workspaceId: 'w',
    entityDefinitionId: 'd',
    attributeDefinitionId: 'a',
    title,
    color: 'pastel_grey',
    sortOrder: 'm',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
  };
}
