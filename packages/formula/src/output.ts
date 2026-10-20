// Output types (formulas.md §3.4). "Auto" infers the attribute type from the checked result: select / status
// results become text, email / domain / name values become text; arrays (other than select / status lists, joined as
// text) and interactions cannot be a formula's final output. An override (8 kinds) converts the result explicitly.
import {
  convertToCheckbox,
  convertToCurrency,
  convertToDate,
  convertToNumber,
  convertToPhones,
  convertToRating,
  convertToText,
  convertToTimestamp,
  displayText,
} from './coerce.ts';
import { type FType, type Kind, typeLabel, unwrapAttr } from './types.ts';
import type { RV } from './values.ts';

/** Attribute types a formula can produce. */
export const OUTPUT_KINDS = [
  'text',
  'number',
  'checkbox',
  'currency',
  'date',
  'timestamp',
  'rating',
  'entity-reference',
  'actor-reference',
  'location',
  'phone-number',
] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** The "Output" menu overrides (besides Auto). */
export const OUTPUT_OVERRIDES = [
  'text',
  'number',
  'checkbox',
  'date',
  'timestamp',
  'rating',
  'currency',
  'phone-number',
] as const;
export type OutputOverride = (typeof OUTPUT_OVERRIDES)[number];

const TEXT_LIKE: ReadonlySet<Kind> = new Set(['pipeline', 'select', 'email-address', 'domain', 'personal-name']);

/** Auto output kind of a result type; null type → null ("none", stored as text); undefined = not allowed. */
export function inferOutputKind(type: FType): OutputKind | null | undefined {
  const t = unwrapAttr(type);
  if (t.t === 'null') return null;
  if (t.t === 'array') {
    const el = unwrapAttr(t.element);
    if (el.t === 'value' && (el.kind === 'select' || el.kind === 'pipeline')) return 'text';
    if (el.t === 'null') return null;
    return undefined;
  }
  if (t.t !== 'value') return undefined;
  if (TEXT_LIKE.has(t.kind)) return 'text';
  if (t.kind === 'interaction') return undefined;
  return t.kind as OutputKind;
}

/** Whether a result of `type` can be converted to the override kind. */
export function overrideAllowed(type: FType, override: OutputOverride): boolean {
  const t = unwrapAttr(type);
  if (t.t === 'null') return true;
  const scalar = t.t === 'array' ? unwrapAttr(t.element) : t;
  if (override === 'text' || override === 'checkbox') return true;
  if (override === 'phone-number') {
    return scalar.t === 'value' && (scalar.kind === 'text' || scalar.kind === 'phone-number');
  }
  if (t.t !== 'value') return false;
  const allowed: Record<Exclude<OutputOverride, 'text' | 'checkbox' | 'phone-number'>, Kind[]> = {
    number: ['text', 'number', 'date', 'timestamp', 'currency', 'rating', 'checkbox'],
    currency: ['text', 'number', 'currency', 'rating', 'checkbox'],
    rating: ['text', 'number', 'rating', 'currency'],
    date: ['date', 'timestamp', 'text', 'number'],
    timestamp: ['text', 'number', 'timestamp', 'date'],
  };
  return allowed[override].includes(t.kind);
}

export interface OutputCheck {
  /** "Auto" type shown next to Auto in the selector. */
  inferred: OutputKind | null;
  /** Stored attribute type: override ?? inferred ?? text. */
  attributeType: OutputKind;
  /** The result cannot be a formula's output: UNSUPPORTED_OUTPUT_TYPE with this received type label. */
  unsupported: string | null;
}

export function checkOutput(type: FType, override: OutputOverride | null): OutputCheck {
  const inferred = inferOutputKind(type);
  if (override) {
    return {
      inferred: inferred ?? null,
      attributeType: override,
      unsupported: overrideAllowed(type, override) ? null : typeLabel(type),
    };
  }
  if (inferred === undefined) return { inferred: null, attributeType: 'text', unsupported: typeLabel(type) };
  return { inferred, attributeType: inferred ?? 'text', unsupported: null };
}

const scalarKind = (type: FType): Kind => {
  const t = unwrapAttr(type);
  if (t.t === 'value') return t.kind;
  if (t.t === 'array' && t.element.t === 'value') return t.element.kind;
  return 'text';
};

/** Converts an evaluated result to the stored output kind (runtime errors propagate). */
export function toOutputValue(value: RV, type: FType, kind: OutputKind): RV {
  if (value === null) return null;
  const t = unwrapAttr(type);
  const src = scalarKind(type);
  switch (kind) {
    case 'text': {
      if (t.t === 'value' && src === 'text') return value;
      const s = convertToText(value, type);
      return s === '' ? null : s;
    }
    case 'number':
      return src === 'number' ? value : convertToNumber(value, src);
    case 'currency':
      return convertToCurrency(value, src);
    case 'checkbox':
      return convertToCheckbox(value, type);
    case 'rating':
      return convertToRating(value, src === 'text' ? 'text' : 'number');
    case 'date':
      return convertToDate(value, src);
    case 'timestamp':
      return convertToTimestamp(value, src);
    case 'phone-number': {
      const phones = convertToPhones(value, type);
      return phones && phones.length > 0 ? (phones[0] as RV) : null;
    }
    default:
      return value;
  }
}

/** Preview text of a result (§4.6). */
export function previewText(value: RV, type: FType): string | null {
  return displayText(value, type);
}
