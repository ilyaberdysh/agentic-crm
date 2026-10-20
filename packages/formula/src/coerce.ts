// Runtime coercion (implicit, §3.2) and explicit conversions (text(), number(), …), display text and identity keys.
import { dateToMs, msToDate, msToIso, parseDateText, parseTimestampText } from './dates.ts';
import { FormulaRuntimeError } from './diagnostics.ts';
import { type FType, type Kind, unwrapAttr } from './types.ts';
import type {
  ActorValue,
  EmailValue,
  InteractionValue,
  LocationValue,
  NameValue,
  OptionValue,
  PhoneValue,
  RecordValue,
  RV,
} from './values.ts';

/** Number → text without binary floating-point noise (0.1 + 0.2 → "0.3"). */
export function numberText(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return String(Number(n.toPrecision(15)));
}

export function locationText(l: LocationValue): string {
  return [l.line1, l.line2, l.line3, l.line4, l.locality, l.region, l.postcode, l.countryCode]
    .filter((x): x is string => typeof x === 'string' && x !== '')
    .join(', ');
}

/** Text form of a value of `kind` (text() and the implicit → text coercion). */
export function toText(value: RV, kind: Kind): string | null {
  if (value === null) return null;
  switch (kind) {
    case 'text':
    case 'domain':
      return value as string;
    case 'number':
    case 'currency':
    case 'rating':
      return numberText(value as number);
    case 'checkbox':
      return value ? 'true' : 'false';
    case 'date':
      return value as string;
    case 'timestamp':
      return msToIso(value as number);
    case 'pipeline':
    case 'select':
      return (value as OptionValue).title;
    case 'entity-reference':
      return (value as RecordValue).entityInstanceId;
    case 'actor-reference': {
      const a = value as ActorValue;
      return a.name ?? a.email ?? a.id;
    }
    case 'location':
      return locationText(value as LocationValue);
    case 'email-address':
      return (value as EmailValue).email;
    case 'phone-number':
      return (value as PhoneValue).normalized;
    case 'personal-name':
      return (value as NameValue).fullName;
    case 'interaction':
      return msToIso((value as InteractionValue).interactedAt);
  }
}

/** Text form of a value of any formula type (arrays joined with ", "). */
export function displayText(value: RV, type: FType): string | null {
  const t = unwrapAttr(type);
  if (value === null) return null;
  if (t.t === 'array') {
    const items = (value as RV[]).map((x) => displayText(x, t.element)).filter((x): x is string => x !== null);
    return items.join(', ');
  }
  if (t.t === 'value') return toText(value, t.kind);
  if (Array.isArray(value)) return value.map((x) => (x === null ? '' : String(x))).join(', ');
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function toNumber(value: RV, kind: Kind): number | null {
  if (value === null) return null;
  switch (kind) {
    case 'number':
    case 'currency':
    case 'rating':
      return value as number;
    case 'checkbox':
      return value ? 1 : 0;
    case 'date':
      return dateToMs(value as string);
    case 'timestamp':
      return value as number;
    case 'text': {
      const s = (value as string).trim();
      if (s === '') return null;
      const n = Number(s.replace(/,/g, ''));
      if (Number.isNaN(n)) throw new FormulaRuntimeError('invalid-argument', `"${value}" is not a number`);
      return n;
    }
    default:
      throw new FormulaRuntimeError('invalid-argument', `Cannot convert ${kind} to a number`);
  }
}

/** Implicit coercion of a value of type `from` to type `to` (types already checked compatible). */
export function coerce(value: RV, from: FType, to: FType): RV {
  if (value === null) return null;
  const src = unwrapAttr(from);
  const dst = unwrapAttr(to);
  if (dst.t === 'null' || src.t === 'null') return value;
  if (src.t === 'array') {
    if (dst.t !== 'array') return value;
    return (value as RV[]).map((x) => coerce(x, src.element, dst.element));
  }
  if (src.t !== 'value' || dst.t !== 'value' || src.kind === dst.kind) return value;
  const s = src.kind;
  switch (dst.kind) {
    case 'text':
      return toText(value, s);
    case 'number':
      return toNumber(value, s);
    case 'timestamp':
      if (s === 'date') return dateToMs(value as string);
      return value as number; // number → timestamp: epoch ms
    default:
      return value;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Explicit conversion functions

const E164 = /^\+[1-9]\d{6,14}$/;

export function parsePhone(text: string): PhoneValue {
  const cleaned = text.trim().replace(/[\s\-().]/g, '');
  const normalized = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  if (!E164.test(normalized)) {
    throw new FormulaRuntimeError('invalid-argument', `"${text}" is not a phone number with a country code`);
  }
  return { normalized, original: text, countryCode: null };
}

export function convertToText(value: RV, type: FType): string | null {
  return displayText(value, type);
}

export function convertToNumber(value: RV, kind: Kind): number | null {
  return toNumber(value, kind);
}

export function convertToCurrency(value: RV, kind: Kind): number | null {
  if (value === null) return null;
  if (kind === 'text') {
    const s = (value as string).trim().replace(/[\s,$€£¥₽]/g, '');
    if (s === '') return null;
    const n = Number(s);
    if (Number.isNaN(n)) throw new FormulaRuntimeError('invalid-argument', `"${value}" is not an amount`);
    return n;
  }
  return toNumber(value, kind);
}

export function convertToCheckbox(value: RV, type: FType): boolean {
  if (value === null) return false;
  const t = unwrapAttr(type);
  if (Array.isArray(value)) return value.length > 0;
  if (t.t === 'value') {
    if (t.kind === 'checkbox') return value as boolean;
    if (t.kind === 'number' || t.kind === 'currency' || t.kind === 'rating') return (value as number) !== 0;
    if (t.kind === 'text' || t.kind === 'domain') return (value as string) !== '';
  }
  return true;
}

export function convertToRating(value: RV, kind: Kind): number | null {
  const n = kind === 'text' ? toNumber(value, 'text') : (value as number | null);
  if (n === null) return null;
  return Math.min(5, Math.max(0, Math.round(n)));
}

export function convertToDate(value: RV, kind: Kind): string | null {
  if (value === null) return null;
  switch (kind) {
    case 'date':
      return value as string;
    case 'timestamp':
    case 'number':
      return msToDate(value as number);
    case 'text': {
      if ((value as string).trim() === '') return null;
      const d = parseDateText(value as string);
      if (d === null) throw new FormulaRuntimeError('invalid-argument', `"${value}" is not a date`);
      return d;
    }
    default:
      throw new FormulaRuntimeError('invalid-argument', `Cannot convert ${kind} to a date`);
  }
}

export function convertToTimestamp(value: RV, kind: Kind): number | null {
  if (value === null) return null;
  switch (kind) {
    case 'timestamp':
    case 'number':
      return value as number;
    case 'date':
      return dateToMs(value as string);
    case 'text': {
      if ((value as string).trim() === '') return null;
      const t = parseTimestampText(value as string);
      if (t === null) throw new FormulaRuntimeError('invalid-argument', `"${value}" is not a timestamp`);
      return t;
    }
    default:
      throw new FormulaRuntimeError('invalid-argument', `Cannot convert ${kind} to a timestamp`);
  }
}

export function convertToPhones(value: RV, type: FType): PhoneValue[] | null {
  if (value === null) return null;
  const t = unwrapAttr(type);
  const items = Array.isArray(value) ? value : [value];
  const kind =
    t.t === 'array' ? (t.element.t === 'value' ? t.element.kind : 'text') : t.t === 'value' ? t.kind : 'text';
  return items
    .filter((x) => x !== null && x !== '')
    .map((x) => (kind === 'phone-number' ? (x as PhoneValue) : parsePhone(x as string)));
}

// ---------------------------------------------------------------------------------------------------------------
// Identity keys (equality, unique, history matching)

export function identityKey(value: RV, type: FType): string {
  if (value === null) return '∅';
  const t = unwrapAttr(type);
  if (Array.isArray(value)) {
    const element = t.t === 'array' ? t.element : t;
    return `[${value.map((x) => identityKey(x, element)).join('|')}]`;
  }
  if (t.t === 'value') {
    switch (t.kind) {
      case 'pipeline':
      case 'select':
        return (value as OptionValue).id;
      case 'entity-reference':
        return (value as RecordValue).entityInstanceId;
      case 'actor-reference':
        return `${(value as ActorValue).type}:${(value as ActorValue).id}`;
      case 'email-address':
        return (value as EmailValue).email;
      case 'phone-number':
        return (value as PhoneValue).normalized;
      case 'personal-name':
        return (value as NameValue).fullName;
      case 'location':
        return locationText(value as LocationValue);
      case 'interaction':
        return String((value as InteractionValue).interactedAt);
      default:
        return typeof value === 'object' ? JSON.stringify(value) : `${typeof value}:${String(value)}`;
    }
  }
  return JSON.stringify(value);
}

/** Identity of a scalar for option / stage / actor matching (history functions). */
export function optionKey(value: RV): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if ('title' in value && 'id' in value) return (value as OptionValue).id;
  if ('type' in value && 'id' in value) return `${(value as ActorValue).type}:${(value as ActorValue).id}`;
  return null;
}

export { msToDate };
