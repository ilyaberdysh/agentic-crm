// Formula type universe (formulas.md §3.1–3.2): scalar values of the 17 attribute kinds, arrays, direct attribute
// references (`attr<X>`, usable by history functions) and null. Kinds use the internal attribute type names
// (pipeline = status, entity-reference = record, actor-reference = actor, …).

export const KINDS = [
  'text',
  'number',
  'checkbox',
  'currency',
  'date',
  'timestamp',
  'rating',
  'pipeline',
  'select',
  'entity-reference',
  'actor-reference',
  'location',
  'domain',
  'email-address',
  'phone-number',
  'interaction',
  'personal-name',
] as const;
export type Kind = (typeof KINDS)[number];

export type FType =
  | { t: 'value'; kind: Kind }
  | { t: 'array'; element: FType }
  | { t: 'attr'; value: FType }
  | { t: 'null' };

export const NULL: FType = { t: 'null' };
export const v = (kind: Kind): FType => ({ t: 'value', kind });
export const arr = (element: FType | Kind): FType => ({
  t: 'array',
  element: typeof element === 'string' ? v(element) : element,
});
export const attrOf = (value: FType | Kind): FType => ({
  t: 'attr',
  value: typeof value === 'string' ? v(value) : value,
});

/** Implicit coercions (§3.2): value of kind → kinds it may be used as. */
export const COERCIONS: Record<Kind, readonly Kind[]> = {
  text: [],
  number: ['text', 'timestamp'],
  checkbox: ['text', 'number'],
  currency: ['text', 'number'],
  date: ['text', 'number', 'timestamp'],
  timestamp: ['text', 'number'],
  rating: ['number', 'text'],
  pipeline: ['text'],
  select: ['text'],
  location: ['text'],
  domain: ['text'],
  'email-address': ['text'],
  'phone-number': ['text'],
  'personal-name': ['text'],
  'entity-reference': [],
  'actor-reference': [],
  interaction: [],
};

export function typeEquals(a: FType, b: FType): boolean {
  if (a.t !== b.t) return false;
  switch (a.t) {
    case 'value':
      return a.kind === (b as { kind: Kind }).kind;
    case 'array':
      return typeEquals(a.element, (b as { element: FType }).element);
    case 'attr':
      return typeEquals(a.value, (b as { value: FType }).value);
    case 'null':
      return true;
  }
}

/** attr<X> → X (recursively); other types unchanged. */
export function unwrapAttr(t: FType): FType {
  return t.t === 'attr' ? unwrapAttr(t.value) : t;
}

/**
 * Whether a value of type `from` may be used where `to` is expected. null coerces to anything (and array<null> to
 * any array); attr<X> coerces to whatever X does and is exactly X for matching.
 */
export function coercible(from: FType, to: FType): boolean {
  if (from.t === 'null') return true;
  if (from.t === 'attr') {
    if (to.t === 'attr') return typeEquals(from, to);
    return coercible(from.value, to);
  }
  if (to.t === 'attr') return false;
  if (from.t === 'array') {
    if (to.t !== 'array') return false;
    return coercible(from.element, to.element);
  }
  if (from.t === 'value') {
    if (to.t !== 'value') return false;
    return from.kind === to.kind || COERCIONS[from.kind].includes(to.kind);
  }
  return false;
}

/** Exact match for generic candidate resolution: equal types, or attr<X> against X. */
export function matchesExactly(arg: FType, candidate: FType): boolean {
  if (typeEquals(arg, candidate)) return true;
  if (arg.t === 'attr' && candidate.t !== 'attr') return typeEquals(arg.value, candidate);
  return false;
}

const KIND_LABELS: Record<Kind, string> = {
  text: 'text',
  number: 'number',
  checkbox: 'checkbox',
  currency: 'currency',
  date: 'date',
  timestamp: 'timestamp',
  rating: 'rating',
  pipeline: 'status',
  select: 'select',
  'entity-reference': 'record',
  'actor-reference': 'person',
  location: 'location',
  domain: 'domain',
  'email-address': 'email address',
  'phone-number': 'phone number',
  interaction: 'interaction',
  'personal-name': 'name',
};

/** Readable type name used in diagnostics ("number", "text[]", "status attribute", "null"). */
export function typeLabel(t: FType): string {
  switch (t.t) {
    case 'value':
      return KIND_LABELS[t.kind];
    case 'array':
      return `${typeLabel(t.element)}[]`;
    case 'attr':
      return `${typeLabel(t.value)} attribute`;
    case 'null':
      return 'null';
  }
}

export function kindLabel(kind: Kind): string {
  return KIND_LABELS[kind];
}

export const isArrayType = (t: FType): boolean => unwrapAttr(t).t === 'array';
