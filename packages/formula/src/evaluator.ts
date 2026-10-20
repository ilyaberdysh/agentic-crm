// Evaluator of the typed tree (formulas.md §2.4, §3.7–3.8). Arguments are coerced to the types the checker resolved;
// most functions return null when an input is null, logical functions treat null as false, contains / count treat
// null as empty. Runtime problems throw FormulaRuntimeError with one of the 7 runtime codes.
import type { ReferenceInfo, TExpr } from './checker.ts';
import {
  coerce,
  convertToCheckbox,
  convertToCurrency,
  convertToNumber,
  convertToPhones,
  convertToRating,
  convertToText,
  convertToTimestamp,
  identityKey,
  optionKey,
  parsePhone,
} from './coerce.ts';
import {
  addUnits,
  dateParts,
  dateToMs,
  diffUnits,
  endOfMonth,
  formatDate,
  msToDate,
  parseDateText,
  parseTimestampText,
  parseUnit,
  setTimezone,
} from './dates.ts';
import { FormulaRuntimeError } from './diagnostics.ts';
import { FIELDS } from './fields.ts';
import type { FunctionName } from './functions.ts';
import { type FType, type Kind, unwrapAttr, v } from './types.ts';
import type {
  ActorValue,
  EmailValue,
  HistoryEntry,
  InteractionValue,
  LocationValue,
  NameValue,
  PhoneValue,
  RV,
} from './values.ts';
import { isEmpty } from './values.ts';

export interface EvalEnv {
  /** Evaluation time (epoch ms): now(), today(), open intervals of timeSpentIn. */
  now: number;
  /**
   * Current raw value(s) of an entity-variable reference — the last hop's attribute value without the sub-field:
   * one value (or null) for singular paths, an array otherwise.
   */
  ref(index: number): RV;
  /** Value history of a reference used by a history function (rows of the referenced attribute on the record). */
  history?(index: number): HistoryEntry[];
  random?(): number;
}

const kindOf = (t: FType): Kind => {
  const u = unwrapAttr(t);
  if (u.t === 'value') return u.kind;
  if (u.t === 'array' && u.element.t === 'value') return u.element.kind;
  return 'text';
};

function finite(n: number): number {
  if (!Number.isFinite(n)) throw new FormulaRuntimeError('math-domain-error');
  return n;
}

const fpRound = (n: number) => Number(n.toPrecision(15));

function round(n: number, digits: number): number {
  const d = Math.trunc(digits);
  const f = 10 ** d;
  const r = (Math.sign(n) * Math.round(fpRound(Math.abs(n) * f))) / f;
  return finite(r === 0 ? 0 : r);
}

/** Sub-field of a raw attribute value (annotation `field` or `.key` access). */
export function applyField(value: RV, kind: Kind, field: string): RV {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((x) => applyField(x, kind, field));
  switch (kind) {
    case 'actor-reference': {
      const a = value as ActorValue;
      return field === 'email_address' ? a.email : (a.name ?? a.email ?? a.id);
    }
    case 'location': {
      const l = value as LocationValue;
      const map: Record<string, keyof LocationValue> = {
        line_1: 'line1',
        line_2: 'line2',
        line_3: 'line3',
        line_4: 'line4',
        locality: 'locality',
        region: 'region',
        postcode: 'postcode',
        country_code: 'countryCode',
      };
      const key = map[field];
      return key ? l[key] : null;
    }
    case 'email-address': {
      const e = value as EmailValue;
      return field === 'email_domain' ? e.domain : e.email;
    }
    case 'phone-number':
      return (value as PhoneValue).normalized;
    case 'personal-name': {
      const n = value as NameValue;
      return field === 'first_name' ? n.firstName : field === 'last_name' ? n.lastName : n.fullName;
    }
    case 'interaction': {
      const i = value as InteractionValue;
      return field === 'interacted_at' ? i.interactedAt : i.interactedWith;
    }
    default:
      return value; // identity fields
  }
}

function toMs(value: RV, kind: Kind): number | null {
  if (value === null) return null;
  switch (kind) {
    case 'date':
      return dateToMs(value as string);
    case 'timestamp':
    case 'number':
      return value as number;
    case 'text': {
      const t = parseTimestampText(value as string);
      if (t === null) throw new FormulaRuntimeError('invalid-argument', `"${value}" is not a date`);
      return t;
    }
    default:
      throw new FormulaRuntimeError('invalid-argument');
  }
}

function numbers(values: RV): number[] {
  return (values as RV[]).filter((x): x is number => typeof x === 'number');
}

/** Values of a numeric / date list as numbers + a converter back to the element kind. */
function orderable(values: RV, kind: Kind): { nums: number[]; back: (n: number) => RV } {
  if (kind === 'date') {
    return {
      nums: (values as RV[]).filter((x): x is string => typeof x === 'string').map(dateToMs),
      back: (n) => msToDate(Math.floor(n / 86_400_000) * 86_400_000),
    };
  }
  return { nums: numbers(values), back: (n) => n };
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function equalsValues(a: RV, b: RV, type: FType): boolean {
  if (a === null || b === null) return isEmpty(a) && isEmpty(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    const t = unwrapAttr(type);
    const element = t.t === 'array' ? t.element : t;
    const ka = a.map((x) => identityKey(x, element)).sort();
    const kb = b.map((x) => identityKey(x, element)).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
  }
  return identityKey(a, type) === identityKey(b, type);
}

function textArg(value: RV): string {
  return value as string;
}

// ---------------------------------------------------------------------------------------------------------------
// History functions

function activeAt(history: HistoryEntry[], at: number): HistoryEntry[] {
  return history.filter((h) => h.activeFrom <= at && (h.activeUntil === null || h.activeUntil > at));
}

function matching(history: HistoryEntry[], wanted: Set<string>): HistoryEntry[] {
  return history.filter((h) => {
    const key = optionKey(h.value);
    return key !== null && wanted.has(key);
  });
}

function keysOf(values: RV): Set<string> {
  const list = Array.isArray(values) ? values : [values];
  return new Set(list.map(optionKey).filter((k): k is string => k !== null));
}

class Evaluator {
  constructor(
    private readonly env: EvalEnv,
    private readonly refs: ReferenceInfo[],
  ) {}

  eval(e: TExpr): RV {
    switch (e.k) {
      case 'literal':
        return e.value;
      case 'ref':
        return this.ref(e.ref);
      case 'array':
        return e.elements.map((x) => coerce(this.eval(x), x.type, e.target));
      case 'field':
        return applyField(this.eval(e.object), e.objectKind, e.field);
      case 'index': {
        const list = this.eval(e.object);
        const index = coerce(this.eval(e.index), e.index.type, v('number'));
        if (list === null || index === null) return null;
        const i = index as number;
        if (!Number.isInteger(i) || i < 0) throw new FormulaRuntimeError('invalid-array-index');
        const items = list as RV[];
        if (i >= items.length) throw new FormulaRuntimeError('array-index-out-of-bounds');
        return items[i] as RV;
      }
      case 'call':
        return this.call(e);
    }
  }

  private ref(index: number): RV {
    const info = this.refs[index] as ReferenceInfo;
    if (info.archived) throw new FormulaRuntimeError('referenced-attribute-missing-or-archived');
    const raw = this.env.ref(index);
    if (!info.field || !info.attribute) return raw;
    return applyField(raw, info.attribute.type, info.field);
  }

  private history(e: TExpr): HistoryEntry[] {
    if (e.k !== 'ref') throw new FormulaRuntimeError('invalid-argument');
    const info = this.refs[e.ref] as ReferenceInfo;
    if (info.archived) throw new FormulaRuntimeError('referenced-attribute-missing-or-archived');
    const rows = this.env.history?.(e.ref) ?? [];
    return [...rows].sort((a, b) => a.activeFrom - b.activeFrom);
  }

  /** Evaluates argument i coerced to its resolved type. */
  private arg(e: Extract<TExpr, { k: 'call' }>, i: number): RV {
    const a = e.args[i] as TExpr;
    return coerce(this.eval(a), a.type, e.targets[i] as FType);
  }

  private call(e: Extract<TExpr, { k: 'call' }>): RV {
    const fn = e.fn as FunctionName;
    // Lazy and null-tolerant functions first.
    switch (fn) {
      case 'if': {
        const cond = this.arg(e, 0);
        return cond === true ? this.arg(e, 1) : this.arg(e, 2);
      }
      case 'ifNull': {
        const left = this.arg(e, 0);
        return isEmpty(left) ? this.arg(e, 1) : left;
      }
      case 'and':
        return this.arg(e, 0) === true && this.arg(e, 1) === true;
      case 'or':
        return this.arg(e, 0) === true || this.arg(e, 1) === true;
      case 'not':
        return this.arg(e, 0) !== true;
      case 'equals':
        return equalsValues(this.arg(e, 0), this.arg(e, 1), e.targets[0] as FType);
      case 'notEquals':
        return !equalsValues(this.arg(e, 0), this.arg(e, 1), e.targets[0] as FType);
      case 'count': {
        const list = this.arg(e, 0);
        return list === null ? 0 : (list as RV[]).length;
      }
      case 'contains': {
        const haystack = this.arg(e, 0);
        const needle = this.arg(e, 1);
        if (haystack === null || needle === null) return false;
        if (Array.isArray(haystack)) return haystack.some((x) => x === needle);
        return (haystack as string).includes(needle as string);
      }
      case 'checkbox':
        return convertToCheckbox(this.arg(e, 0), e.targets[0] as FType);
      case 'text':
        return convertToText(this.arg(e, 0), e.targets[0] as FType);
      case 'random':
        return (this.env.random ?? Math.random)();
      case 'now':
        return this.env.now;
      case 'today':
        return msToDate(this.env.now);
      case 'valueAt': {
        const history = this.history(e.args[0] as TExpr);
        const at = this.arg(e, 1);
        if (at === null) return null;
        const info = this.refs[(e.args[0] as { ref: number }).ref] as ReferenceInfo;
        const rows = activeAt(history, at as number).map((h) => h.value);
        const field = info.field;
        const attr = info.attribute;
        const values = field && attr ? rows.map((x) => applyField(x, attr.type, field)) : rows;
        return info.singular ? (values[0] ?? null) : values;
      }
      case 'previousValue': {
        const history = this.history(e.args[0] as TExpr);
        const info = this.refs[(e.args[0] as { ref: number }).ref] as ReferenceInfo;
        const changes = [
          ...new Set(history.flatMap((h) => (h.activeUntil === null ? [h.activeFrom] : [h.activeFrom, h.activeUntil]))),
        ].sort((a, b) => a - b);
        const latest = changes.at(-1);
        if (latest === undefined) return info.singular ? null : [];
        const before = activeAt(history, latest - 0.001).map((h) => h.value);
        return info.singular ? (before[0] ?? null) : before;
      }
      case 'hasBeenIn': {
        const history = this.history(e.args[0] as TExpr);
        const wanted = keysOf(this.arg(e, 1));
        return matching(history, wanted).length > 0;
      }
      case 'valueSetAt': {
        const history = this.history(e.args[0] as TExpr);
        const value = this.arg(e, 1);
        const position = e.args.length > 2 ? this.arg(e, 2) : 'first';
        if (position !== 'first' && position !== 'last' && position !== null) {
          throw new FormulaRuntimeError('invalid-argument', 'position must be "first" or "last"');
        }
        const rows = matching(history, keysOf(value));
        if (rows.length === 0) return null;
        const times = rows.map((r) => r.activeFrom);
        return position === 'last' ? Math.max(...times) : Math.min(...times);
      }
      case 'timeSpentIn': {
        const history = this.history(e.args[0] as TExpr);
        const value = this.arg(e, 1);
        const unit = this.arg(e, 2);
        const per: Record<string, number> = {
          hours: 3_600_000,
          days: 86_400_000,
          weeks: 7 * 86_400_000,
          months: 30 * 86_400_000,
        };
        const size = per[String(unit)];
        if (!size) throw new FormulaRuntimeError('invalid-argument', 'unit must be hours, days, weeks or months');
        const total = matching(history, keysOf(value)).reduce(
          (sum, r) => sum + Math.max(0, (r.activeUntil ?? this.env.now) - r.activeFrom),
          0,
        );
        return Math.floor(total / size);
      }
      default:
        break;
    }
    const args = e.args.map((_a, i) => this.arg(e, i));
    if (args.some((a) => a === null)) {
      // Aggregations over a null list are null; everything else propagates null.
      return null;
    }
    return this.strict(e, fn, args);
  }

  /** Functions whose arguments are all non-null. */
  private strict(e: Extract<TExpr, { k: 'call' }>, fn: FunctionName, args: RV[]): RV {
    const [a, b, c] = args;
    const targetKind = (i: number) => kindOf(e.targets[i] as FType);
    switch (fn) {
      case 'add':
        if (targetKind(0) === 'text') return textArg(a as RV) + textArg(b as RV);
        return finite((a as number) + (b as number));
      case 'subtract':
        return finite((a as number) - (b as number));
      case 'multiply':
        return finite((a as number) * (b as number));
      case 'divide':
        if ((b as number) === 0) throw new FormulaRuntimeError('division-by-zero');
        return finite((a as number) / (b as number));
      case 'negate':
        return -(a as number) || 0;
      case 'greaterThan':
        return (a as number) > (b as number);
      case 'greaterThanOrEqual':
        return (a as number) >= (b as number);
      case 'lessThan':
        return (a as number) < (b as number);
      case 'lessThanOrEqual':
        return (a as number) <= (b as number);
      case 'avg': {
        const nums = numbers(a as RV);
        return nums.length === 0 ? null : finite(nums.reduce((s, n) => s + n, 0) / nums.length);
      }
      case 'sum':
        return finite(numbers(a as RV).reduce((s, n) => s + n, 0));
      case 'max':
      case 'min':
      case 'mean':
      case 'median': {
        const { nums, back } = orderable(a as RV, kindOf(e.targets[0] as FType));
        if (nums.length === 0) return null;
        if (fn === 'max') return back(Math.max(...nums));
        if (fn === 'min') return back(Math.min(...nums));
        if (fn === 'mean') return back(nums.reduce((s, n) => s + n, 0) / nums.length);
        return back(median(nums) as number);
      }
      case 'unique': {
        const element = unwrapAttr(e.targets[0] as FType);
        const el = element.t === 'array' ? element.element : element;
        const seen = new Set<string>();
        return (a as RV[]).filter((x) => {
          const k = identityKey(x, el);
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }
      case 'exp':
        return finite(Math.exp(a as number));
      case 'log':
        if ((a as number) <= 0) throw new FormulaRuntimeError('math-domain-error');
        return finite(Math.log(a as number));
      case 'abs':
        return Math.abs(a as number);
      case 'round':
        return round(a as number, b as number);
      case 'ceil':
        return Math.ceil(fpRound(a as number));
      case 'floor':
        return Math.floor(fpRound(a as number));
      case 'power': {
        const r = (a as number) ** (b as number);
        if (Number.isNaN(r)) throw new FormulaRuntimeError('math-domain-error');
        return finite(r);
      }
      case 'mod': {
        if ((b as number) === 0) throw new FormulaRuntimeError('division-by-zero');
        const r = (((a as number) % (b as number)) + (b as number)) % (b as number);
        return fpRound(r);
      }
      case 'date': {
        if (targetKind(0) === 'number') return msToDate(a as number);
        const d = parseDateText(a as string);
        if (d === null) throw new FormulaRuntimeError('invalid-argument', `"${a}" is not a date`);
        return d;
      }
      case 'timestamp':
        return convertToTimestamp(a as RV, targetKind(0));
      case 'dateAdd': {
        const ms = toMs(a as RV, targetKind(0)) as number;
        const unit = parseUnit(c as string);
        return msToDate(addUnits(ms, b as number, unit));
      }
      case 'dateDiff': {
        const start = toMs(a as RV, targetKind(0)) as number;
        const end = toMs(b as RV, targetKind(1)) as number;
        return diffUnits(start, end, parseUnit(c as string));
      }
      case 'formatDate':
        return formatDate(toMs(a as RV, targetKind(0)) as number, b as string);
      case 'day':
      case 'month':
      case 'year':
      case 'quarter':
      case 'hour':
      case 'minute':
      case 'second': {
        const p = dateParts(toMs(a as RV, targetKind(0)) as number);
        if (fn === 'quarter') return Math.floor((p.month - 1) / 3) + 1;
        return p[fn];
      }
      case 'eomonth':
        return endOfMonth(toMs(a as RV, targetKind(0)) as number);
      case 'setTimezone':
        return setTimezone(toMs(a as RV, targetKind(0)) as number, b as string);
      case 'length':
        return [...(a as string)].length;
      case 'replace':
        return (a as string).replace(b as string, () => c as string);
      case 'replaceAll':
        return (b as string) === '' ? (a as string) : (a as string).split(b as string).join(c as string);
      case 'startsWith':
        return (a as string).startsWith(b as string);
      case 'endsWith':
        return (a as string).endsWith(b as string);
      case 'left': {
        const n = Math.trunc(b as number);
        return n <= 0 ? '' : [...(a as string)].slice(0, n).join('');
      }
      case 'right': {
        const n = Math.trunc(b as number);
        const chars = [...(a as string)];
        return n <= 0 ? '' : chars.slice(Math.max(0, chars.length - n)).join('');
      }
      case 'lower':
        return (a as string).toLowerCase();
      case 'upper':
        return (a as string).toUpperCase();
      case 'split':
        return (a as string).split(b as string);
      case 'splitPart': {
        const i = Math.trunc(c as number);
        const parts = (a as string).split(b as string);
        return i >= 0 && i < parts.length ? (parts[i] as string) : '';
      }
      case 'number':
        return convertToNumber(a as RV, targetKind(0));
      case 'currency':
        return convertToCurrency(a as RV, targetKind(0));
      case 'rating':
        return convertToRating(a as RV, targetKind(0));
      case 'phoneNumber':
        return convertToPhones(a as RV, e.targets[0] as FType);
      default:
        throw new FormulaRuntimeError('invalid-argument', `Unsupported function ${fn}`);
    }
  }
}

export function evaluateTyped(expr: TExpr, refs: ReferenceInfo[], env: EvalEnv): RV {
  return new Evaluator(env, refs).eval(expr);
}

export { FIELDS, parsePhone };
