// Canonical identity of a stored value, computed from its typed columns. Must agree with `canonical` produced by
// parseValue() in codecs.ts for the same value (used when uniqueness is switched on and when merging records).
import type { AttributeType } from '@agentic-crm/contracts';
import type { ValueRowLike } from './codecs.ts';

const LOCATION_KEYS = [
  'line1',
  'line2',
  'line3',
  'line4',
  'locality',
  'region',
  'postcode',
  'countryCode',
  'latitude',
  'longitude',
];

export function canonicalFromRow(type: AttributeType, row: ValueRowLike): string {
  const json = (row.v_json ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'text':
    case 'domain':
    case 'email-address':
    case 'phone-number':
      return row.v_text ?? '';
    case 'number':
    case 'rating':
      return String(Number(row.v_num));
    case 'checkbox':
      return String(row.v_bool);
    case 'currency':
      return `${row.v_text ?? ''}:${Number(row.v_num)}`;
    case 'date':
      return row.v_date ?? '';
    case 'timestamp':
      return row.v_ts ?? '';
    case 'pipeline':
    case 'select':
    case 'entity-reference':
      return row.v_ref ?? '';
    case 'actor-reference':
      return `${row.v_text}:${row.v_ref}`;
    case 'location':
      return JSON.stringify(Object.fromEntries(LOCATION_KEYS.map((k) => [k, (json[k] as string | null) ?? null])));
    case 'interaction':
      return `${row.v_text}:${row.v_ts}:${(json.interactionHeaderId as string | null) ?? ''}`;
    case 'personal-name':
      return JSON.stringify([json.firstName ?? '', json.lastName ?? '', row.v_text ?? '']);
  }
}
