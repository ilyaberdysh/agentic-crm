// Sub-fields of attribute values (formulas.md §3.3): allowed fields per attribute kind and the kind they yield.
// Identity fields (`value`, `raw_value`, `pipeline_stage_id`, `select_option_id`) keep the attribute's kind.
import type { Kind } from './types.ts';

export const FIELDS: Record<Kind, Record<string, Kind>> = {
  text: { value: 'text' },
  number: { value: 'number' },
  checkbox: { value: 'checkbox' },
  date: { value: 'date' },
  timestamp: { value: 'timestamp' },
  rating: { value: 'rating' },
  currency: { raw_value: 'currency' },
  pipeline: { pipeline_stage_id: 'pipeline' },
  select: { select_option_id: 'select' },
  domain: { normalized_domain: 'text' },
  'entity-reference': {},
  'actor-reference': { text: 'text', email_address: 'text' },
  location: {
    line_1: 'text',
    line_2: 'text',
    line_3: 'text',
    line_4: 'text',
    locality: 'text',
    region: 'text',
    postcode: 'text',
    country_code: 'text',
  },
  'email-address': { normalized_email_address: 'text', email_domain: 'text' },
  'phone-number': { normalized_phone_number: 'text' },
  'personal-name': { full_name: 'text', first_name: 'text', last_name: 'text' },
  interaction: { interacted_with: 'actor-reference', interacted_at: 'timestamp' },
};

export const IDENTITY_FIELDS = new Set(['value', 'raw_value', 'pipeline_stage_id', 'select_option_id']);

/** Kinds whose values allow `.key` member syntax in the formula text (§3.3). */
export const MEMBER_ACCESS_KINDS: ReadonlySet<Kind> = new Set([
  'location',
  'email-address',
  'phone-number',
  'personal-name',
  'actor-reference',
]);

export function fieldKind(kind: Kind, field: string): Kind | null {
  return FIELDS[kind][field] ?? null;
}
