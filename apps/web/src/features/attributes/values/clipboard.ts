// Clipboard text per type (2.10) and plain single-cell paste. the paste semantics are unknown (
// BACKLOG defer list), so paste is ours: the text is parsed as the attribute's type; anything that does not parse
// returns null (the table counts it as an invalid cell: "# invalid cells were skipped."). Empty text clears.
import { formatOne, memberName } from '../format/formatValue';
import type { FormatSettings } from '../format/locale';
import type {
  AttributeDefinition,
  AttributeValue,
  Member,
  PipelineStage,
  SelectOption,
  ValueField,
  ValueInput,
  ValueLookup,
} from '../types';
import { normalizeDomain, normalizeEmail, normalizePhone } from './normalize';
import {
  parseBoolean,
  parseCurrencyAmount,
  parseDateText,
  parseNumber,
  parseRating,
  parseTimestampText,
  splitList,
  splitName,
} from './parse';
import { currentValues } from './shapes';

/** Clipboard text: the displayed values joined with ", " (numbers raw so they paste back into spreadsheets). */
export function copyTextOf(
  attribute: AttributeDefinition,
  values: readonly AttributeValue[],
  lookup: ValueLookup | undefined,
  field?: ValueField,
): string {
  return currentValues(values)
    .map((v) => {
      if (attribute.type === 'number') return typeof v.value === 'number' ? String(v.value) : '';
      return formatOne(attribute, v.value, { lookup, field });
    })
    .filter(Boolean)
    .join(', ');
}

export interface PasteContext {
  options?: SelectOption[];
  stages?: PipelineStage[];
  members?: Member[];
  settings: FormatSettings;
  today: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const byTitle = <T extends { title: string; isArchived: boolean }>(list: T[] | undefined, title: string) =>
  list?.find((o) => !o.isArchived && o.title.trim().toLowerCase() === title.trim().toLowerCase());

export function pasteValueOf(attribute: AttributeDefinition, raw: string, ctx: PasteContext): ValueInput[] | null {
  const text = raw.replace(/\r?\n$/, '');
  const trimmed = text.trim();
  if (!trimmed && attribute.type !== 'checkbox') return [];
  const { locale, timeZone } = ctx.settings;
  const multi = attribute.isMultiselect;
  switch (attribute.type) {
    case 'text':
      return [{ value: text }];
    case 'number': {
      const n = parseNumber(trimmed, locale);
      return n === null ? null : [{ value: n }];
    }
    case 'currency': {
      const n = parseCurrencyAmount(trimmed, locale);
      const code = attribute.config.currencyConfiguration?.defaultCurrencyCode ?? 'USD';
      return n === null ? null : [{ value: { currencyValue: n, currencyCode: code } }];
    }
    case 'checkbox': {
      const b = parseBoolean(trimmed);
      return b === null ? null : [{ value: b }];
    }
    case 'rating': {
      const n = parseRating(trimmed);
      return n === null ? null : n === 0 ? [] : [{ value: n }];
    }
    case 'date': {
      const d = parseDateText(trimmed, ctx.today);
      return d ? [{ value: d }] : null;
    }
    case 'timestamp': {
      const t = parseTimestampText(trimmed, ctx.today, timeZone);
      return t ? [{ value: t }] : null;
    }
    case 'pipeline': {
      const stage = byTitle(ctx.stages, trimmed) ?? ctx.stages?.find((s) => s.id === trimmed);
      return stage ? [{ value: { pipelineStageId: stage.id } }] : null;
    }
    case 'select': {
      const titles = multi ? splitList(trimmed) : [trimmed];
      const found = titles.map((t) => byTitle(ctx.options, t)).filter((o): o is SelectOption => Boolean(o));
      if (found.length === 0) return null;
      return found.map((o) => ({ value: { selectOptionId: o.id } }));
    }
    case 'entity-reference': {
      const ids = splitList(trimmed, true).filter((t) => UUID.test(t));
      if (ids.length === 0) return null;
      return (multi ? ids : ids.slice(0, 1)).map((id) => ({ value: { entityInstanceId: id } }));
    }
    case 'actor-reference': {
      const parts = multi ? splitList(trimmed) : [trimmed];
      const found = parts
        .map((p) =>
          ctx.members?.find(
            (m) => m.emailAddress.toLowerCase() === p.toLowerCase() || memberName(m).toLowerCase() === p.toLowerCase(),
          ),
        )
        .filter((m): m is Member => Boolean(m));
      if (found.length === 0) return null;
      return found.map((m) => ({ value: { referencedActorType: 'workspace-member', referencedActorId: m.id } }));
    }
    case 'location':
      return [{ value: { locality: trimmed } }];
    case 'domain': {
      const list = splitList(trimmed, true).filter((d) => normalizeDomain(d));
      if (list.length === 0) return null;
      return (multi ? list : list.slice(0, 1)).map((d) => ({ value: d }));
    }
    case 'email-address': {
      const list = splitList(trimmed, true).filter((e) => normalizeEmail(e));
      if (list.length === 0) return null;
      return (multi ? list : list.slice(0, 1)).map((e) => ({ value: e }));
    }
    case 'phone-number': {
      const list = splitList(trimmed)
        .map((p) => ({ p, r: normalizePhone(p, null) }))
        .filter((x) => x.r.ok);
      if (list.length === 0) return null;
      return (multi ? list : list.slice(0, 1)).map(({ p }) => ({
        value: { originalPhoneNumber: p, countryCode: null },
      }));
    }
    case 'interaction':
      return null;
    case 'personal-name': {
      const name = splitName(trimmed);
      return name.fullName ? [{ value: name }] : [];
    }
  }
}
