// Per-type parsing of raw CSV cells. Pure: no database.
import { describe, expect, it } from 'vitest';
import {
  detectDateFormat,
  detectDecimalSeparator,
  type ParseContext,
  parseCheckbox,
  parseCurrency,
  parseDate,
  parseLocation,
  parseNumber,
  parseRating,
  parseTimestamp,
  parseYearDate,
  resolutionTypeOf,
  resolveCell,
  splitFullName,
} from '../src/imports/parse.ts';

const ctx = (over: Partial<ParseContext>): ParseContext => ({
  type: 'text',
  multi: false,
  isId: false,
  yearOnly: false,
  field: null,
  dateFormat: 'iso',
  timestampFormat: 'iso',
  decimalSeparator: 'point',
  timeZone: 'UTC',
  currencyCode: 'USD',
  options: [],
  members: [],
  ...over,
});

describe('numbers and decimal separators', () => {
  it('parses point and comma separators with group separators', () => {
    expect(parseNumber('9', 'point')).toBe(9);
    expect(parseNumber('9.00', 'point')).toBe(9);
    expect(parseNumber('-1,234.5', 'point')).toBe(-1234.5);
    expect(parseNumber('1 234,5', 'comma')).toBe(1234.5);
    expect(parseNumber('1 200,50', 'comma')).toBe(1200.5);
    expect(parseNumber('1.000.000,25', 'comma')).toBe(1000000.25);
    expect(parseNumber('+42', 'point')).toBe(42);
  });

  it('reads "12500,50" as 1250050 with Point and 12500.5 with Comma (live observation)', () => {
    expect(parseNumber('12500,50', 'point')).toBe(1250050);
    expect(parseNumber('12500,50', 'comma')).toBe(12500.5);
  });

  it('keeps at most 4 decimals and rejects non-numbers and infinities', () => {
    expect(parseNumber('1312313123.12339', 'point')).toBe(1312313123.1233);
    expect(parseNumber('abc', 'point')).toBeNull();
    expect(parseNumber('Infinity', 'point')).toBeNull();
    expect(parseNumber('12%', 'point')).toBeNull();
    expect(parseNumber('1,2,3', 'comma')).toBeNull();
    expect(parseNumber('', 'point')).toBeNull();
  });

  it('detects the decimal separator from samples: Point unless a comma is unambiguously decimal', () => {
    // The Budget column ("12500,50", "8000") stays on Point and imports 1,250,050.
    expect(detectDecimalSeparator(['12500,50', '8000'])).toBe('point');
    expect(detectDecimalSeparator(['12,5', '7,25', '3'])).toBe('point');
    expect(detectDecimalSeparator(['12.5', '1,000.25'])).toBe('point');
    expect(detectDecimalSeparator(['1', '2'])).toBe('point');
    // Thousands groups before a decimal comma (our ru-RU exports), or values only the comma reading accepts.
    expect(detectDecimalSeparator(['1 234,50 €', '99,50 €'])).toBe('comma');
    expect(detectDecimalSeparator(['250 000,00'])).toBe('comma');
    expect(detectDecimalSeparator(['1.000.000,25', '12,5'])).toBe('comma');
    expect(detectDecimalSeparator(['1.234.567'])).toBe('comma');
    expect(detectDecimalSeparator(['1,234,567.5', '1.234,5'])).toBe('point');
  });

  it('parses currency amounts with the attribute currency only', () => {
    expect(parseCurrency('40.99', 'USD')).toEqual({ value: 40.99 });
    expect(parseCurrency('$1,200.50', 'USD')).toEqual({ value: 1200.5 });
    expect(parseCurrency('250 000,00 €', 'EUR', 'comma')).toEqual({ value: 250000 });
    expect(parseCurrency('100 EUR', 'EUR')).toEqual({ value: 100 });
    expect(parseCurrency('100 EUR', 'USD')).toEqual({ error: 'Invalid currency' });
    expect(parseCurrency('lots', 'USD')).toEqual({ error: 'Invalid number' });
  });
});

describe('checkbox and rating', () => {
  it('accepts checkbox spellings and rejects others', () => {
    for (const t of ['1', 'true', 'TRUE', '#t']) expect(parseCheckbox(t)).toBe(true);
    for (const f of ['0', 'false', 'FALSE', '#f']) expect(parseCheckbox(f)).toBe(false);
    expect(parseCheckbox('')).toBeNull();
    expect(parseCheckbox('no')).toBe('invalid');
  });

  it('maps 1–5 to stars, 0 to no value, and rejects out-of-range ratings', () => {
    expect(parseRating('4')).toBe(4);
    expect(parseRating('0')).toBeNull();
    expect(parseRating('9')).toBe('invalid');
    expect(parseRating('2.5')).toBe('invalid');
  });
});

describe('dates per format', () => {
  it('ISO standard', () => {
    expect(parseDate('2024-07-14', 'iso')).toBe('2024-07-14');
    expect(parseDate('2024-07-14T23:30:00Z', 'iso')).toBe('2024-07-14');
    expect(parseDate('14/07/2024', 'iso')).toBeNull();
    expect(parseDate('2024-02-30', 'iso')).toBeNull();
  });

  it('European (uk) formats from the formatting guide', () => {
    for (const raw of [
      '14/07/2024',
      '14-07-2024',
      '14 07 2024',
      '14/7/2024',
      '14-7-2024',
      '14 7 2024',
      '14 Jul 2024',
      '14 Jul, 2024',
      '14 July 2024',
      '14 July, 2024',
      '14th July 2024',
      '14th July, 2024',
      '14.07.2024',
    ]) {
      expect(parseDate(raw, 'uk'), raw).toBe('2024-07-14');
    }
  });

  it('American (us) formats from the formatting guide', () => {
    for (const raw of [
      '07/14/2024',
      '07-14-2024',
      '07 14 2024',
      '7/14/2024',
      '7-14-2024',
      '7 14 2024',
      'Jul 14 2024',
      'Jul 14, 2024',
      'July 14 2024',
      'July 14, 2024',
      'July 14th 2024',
      'July 14th, 2024',
      'Mar 1, 2026',
    ]) {
      expect(parseDate(raw, 'us'), raw).toBe(raw === 'Mar 1, 2026' ? '2026-03-01' : '2024-07-14');
    }
    expect(parseDate('14/07/2024', 'us')).toBeNull();
  });

  it('foundation dates keep only the year', () => {
    expect(parseYearDate('1984', 'iso')).toBe('1984-01-01');
    expect(parseYearDate('1984-11-01', 'iso')).toBe('1984-01-01');
  });

  it('detects the date format of a column (14/07/2026 → uk, as observed)', () => {
    expect(detectDateFormat(['14/07/2026', '01/02/2026'], parseDate)).toBe('uk');
    expect(detectDateFormat(['07/14/2026'], parseDate)).toBe('us');
    expect(detectDateFormat(['2026-07-14'], parseDate)).toBe('iso');
  });
});

describe('timestamps per format and zone', () => {
  it('accepts any ISO prefix (no offset = UTC)', () => {
    expect(parseTimestamp('2024-11-01T01:02:03.456789234Z', 'iso')).toBe('2024-11-01T01:02:03.456789Z');
    expect(parseTimestamp('2024-11-01', 'iso')).toBe('2024-11-01T00:00:00.000000Z');
    expect(parseTimestamp('2024-11-01T10:00+03:00', 'iso')).toBe('2024-11-01T07:00:00.000000Z');
    expect(parseTimestamp('01:02:03 01 11 2024', 'iso')).toBeNull();
  });

  it('European and American time-first forms', () => {
    expect(parseTimestamp('01:02:03 01 11 2024', 'uk')).toBe('2024-11-01T01:02:03.000000Z');
    expect(parseTimestamp('01:02:03 1 Nov 2024', 'uk')).toBe('2024-11-01T01:02:03.000000Z');
    expect(parseTimestamp('01:02:03 11 01 2024', 'us')).toBe('2024-11-01T01:02:03.000000Z');
    expect(parseTimestamp('01:02 Nov 01 2024', 'us')).toBe('2024-11-01T01:02:00.000000Z');
  });

  it('reads our export format in the importer time zone', () => {
    expect(parseTimestamp('Mar 1st 2026, 12:30pm', 'us', 'Europe/Moscow')).toBe('2026-03-01T09:30:00.000000Z');
    expect(parseTimestamp('Mar 1st 2026, 12:30am', 'us', 'UTC')).toBe('2026-03-01T00:30:00.000000Z');
  });
});

describe('locations, names and splitting', () => {
  it('parses one-line addresses', () => {
    expect(parseLocation('1 Infinite Loop, Cupertino, CA, 95014, United States')).toMatchObject({
      line1: '1 Infinite Loop',
      locality: 'Cupertino',
      region: 'CA',
      postcode: '95014',
      countryCode: 'US',
    });
    expect(parseLocation('New York City, New York, United States')).toMatchObject({
      locality: 'New York City',
      region: 'New York',
      countryCode: 'US',
    });
    expect(parseLocation('London, United Kingdom')).toMatchObject({ locality: 'London', countryCode: 'GB' });
    expect(parseLocation('Germany')).toMatchObject({ locality: null, countryCode: 'DE' });
  });

  it('splits full names', () => {
    expect(splitFullName('Nicolas Sharp')).toEqual({
      firstName: 'Nicolas',
      lastName: 'Sharp',
      fullName: 'Nicolas Sharp',
    });
    expect(splitFullName('Cher')).toEqual({ firstName: 'Cher', lastName: '', fullName: 'Cher' });
  });
});

describe('resolveCell', () => {
  const options = [
    { id: '0192a000-0000-7000-8000-000000000001', title: '3D Printing' },
    { id: '0192a000-0000-7000-8000-000000000002', title: 'Architecture' },
  ];

  it('matches select titles case-insensitively, by id, and reports missing titles', () => {
    const multi = ctx({ type: 'select', multi: true, options });
    expect(resolveCell(multi, '3d printing, Architecture, Imported')).toEqual({
      values: [{ selectOptionId: options[0]?.id }, { selectOptionId: options[1]?.id }],
      errors: [],
      missing: ['Imported'],
      empty: false,
    });
    expect(resolveCell(ctx({ type: 'pipeline', options }), options[1]?.id as string).values).toEqual([
      { pipelineStageId: options[1]?.id },
    ]);
  });

  it('matches members by id, email, full name and first name; ambiguity is invalid', () => {
    const members = [
      {
        id: '0192a000-0000-7000-8000-0000000000a1',
        emailAddress: 'nicolas@example.com',
        firstName: 'Nicolas',
        lastName: 'Sharp',
      },
      {
        id: '0192a000-0000-7000-8000-0000000000a2',
        emailAddress: 'ann@example.com',
        firstName: 'Ann',
        lastName: 'Lee',
      },
      {
        id: '0192a000-0000-7000-8000-0000000000a3',
        emailAddress: 'ann2@example.com',
        firstName: 'Ann',
        lastName: 'Ray',
      },
    ];
    const c = ctx({ type: 'actor-reference', members });
    const id = (raw: string) =>
      (resolveCell(c, raw).values[0] as { referencedActorId: string } | undefined)?.referencedActorId;
    expect(id('NICOLAS@example.com')).toBe(members[0]?.id);
    expect(id('Nicolas Sharp')).toBe(members[0]?.id);
    expect(id('nicolas')).toBe(members[0]?.id);
    expect(id('Ann Ray')).toBe(members[2]?.id);
    expect(resolveCell(c, 'Ann').errors).toEqual(['Invalid actor']);
    expect(resolveCell(c, 'Nobody').errors).toEqual(['Invalid actor']);
  });

  it('splits multi-value identity attributes and validates each value', () => {
    const domains = ctx({ type: 'domain', multi: true });
    expect(resolveCell(domains, 'https://www.Acme.com, acme.io').values).toEqual(['acme.com', 'acme.io']);
    expect(resolveCell(domains, 'not a domain').errors).toEqual(['Invalid domain']);
    expect(resolveCell(ctx({ type: 'email-address', multi: true }), 'a@x.com, bad').errors).toEqual([
      'Invalid email address',
    ]);
    expect(resolveCell(ctx({ type: 'phone-number' }), '+1 415-555-2671').values).toEqual(['+1 415-555-2671']);
    expect(resolveCell(ctx({ type: 'phone-number' }), '415 555').errors).toEqual(['Invalid phone number']);
  });

  it('handles ids, name parts, empties and dates with the property format', () => {
    expect(resolveCell(ctx({ isId: true }), 'nope').errors).toEqual(['Invalid ID']);
    expect(resolveCell(ctx({ type: 'personal-name', field: 'first-name' }), ' Ada ').values).toEqual(['Ada']);
    expect(resolveCell(ctx({ type: 'number' }), '   ').empty).toBe(true);
    expect(resolveCell(ctx({ type: 'date', dateFormat: 'uk' }), '14/07/2026').values).toEqual(['2026-07-14']);
    expect(
      resolveCell(ctx({ type: 'currency', currencyCode: 'EUR', decimalSeparator: 'comma' }), '12500,50').values,
    ).toEqual([{ currencyValue: 12500.5, currencyCode: 'EUR' }]);
    expect(resolveCell(ctx({ type: 'rating' }), '9').errors).toEqual(['Invalid rating']);
    expect(resolveCell(ctx({ type: 'checkbox' }), 'no').errors).toEqual(['Invalid checkbox']);
  });

  it('names particle resolution types', () => {
    expect(resolutionTypeOf('date', { isId: false, field: null, systemAttributeType: 'foundation-date' })).toBe(
      'date:foundation-date',
    );
    expect(resolutionTypeOf('text', { isId: true, field: null, systemAttributeType: 'id' })).toBe('text:uuid');
    expect(resolutionTypeOf('personal-name', { isId: false, field: 'last-name', systemAttributeType: null })).toBe(
      'personal-name:last-name',
    );
    expect(resolutionTypeOf('select', { isId: false, field: null, systemAttributeType: null })).toBe('select:value');
  });
});
