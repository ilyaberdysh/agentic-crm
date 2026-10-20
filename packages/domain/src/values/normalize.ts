// Normalisers for identity-like values (domains, email addresses, phone numbers, timestamps).
// Slice-1 scope: deterministic, dependency-free rules. Wave 2 may swap in the Public Suffix List and libphonenumber.

/** Second-level public suffixes common enough to matter for root-domain grouping. */
// biome-ignore format: compact table
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'com.au', 'net.au', 'org.au', 'co.nz',
  'org.nz', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.cn', 'com.hk', 'com.sg', 'com.tr', 'com.mx', 'com.ar',
  'co.in', 'co.za', 'co.kr', 'co.il', 'com.ua', 'com.ru', 'msk.ru', 'spb.ru', 'com.pl', 'com.tw', 'co.id',
]);

export interface NormalizedDomain {
  normalizedDomain: string;
  rootDomain: string;
}

/** 'https://www.Example.co.uk/path' → {normalizedDomain: 'example.co.uk', rootDomain: 'example.co.uk'}; null if invalid. */
export function normalizeDomain(input: string): NormalizedDomain | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  d = d.replace(/^[^@/]*@/, ''); // userinfo
  d = d.split(/[/?#]/)[0] ?? '';
  d = d.replace(/:\d+$/, '').replace(/\.$/, '');
  if (d.startsWith('www.')) d = d.slice(4);
  const labels = d.split('.');
  if (labels.length < 2) return null;
  if (!labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return null;
  if (!/^[a-z]{2,63}$|^xn--[a-z0-9-]+$/.test(labels[labels.length - 1] as string)) return null;
  const lastTwo = labels.slice(-2).join('.');
  const rootDomain = TWO_LEVEL_SUFFIXES.has(lastTwo) && labels.length >= 3 ? labels.slice(-3).join('.') : lastTwo;
  return { normalizedDomain: d, rootDomain };
}

export interface NormalizedEmail {
  originalEmailAddress: string;
  normalizedEmailAddress: string;
  emailDomain: string;
  emailRootDomain: string;
  emailLocalSpecifier: string;
}

export function normalizeEmail(input: string): NormalizedEmail | null {
  const original = input.trim();
  const normalized = original.toLowerCase();
  const m = /^([^\s@]+)@([^\s@]+)$/.exec(normalized);
  if (!m) return null;
  const local = m[1] as string;
  const domain = normalizeDomain(m[2] as string);
  if (!domain || domain.normalizedDomain !== m[2]) return null;
  const plus = local.indexOf('+');
  return {
    originalEmailAddress: original,
    normalizedEmailAddress: normalized,
    emailDomain: domain.normalizedDomain,
    emailRootDomain: domain.rootDomain,
    emailLocalSpecifier: plus >= 0 ? local.slice(plus + 1) : '',
  };
}

/** Country calling codes for the countries we expect first; numbers in '+…' form work for every country. */
// biome-ignore format: compact table
const CALLING_CODES: Record<string, string> = {
  US: '1', CA: '1', GB: '44', IE: '353', DE: '49', FR: '33', ES: '34', IT: '39', NL: '31', BE: '32', CH: '41',
  AT: '43', SE: '46', NO: '47', DK: '45', FI: '358', PL: '48', CZ: '420', PT: '351', GR: '30', RU: '7', KZ: '7',
  UA: '380', BY: '375', GE: '995', AM: '374', AZ: '994', UZ: '998', TR: '90', IL: '972', AE: '971', SA: '966',
  IN: '91', CN: '86', JP: '81', KR: '82', SG: '65', HK: '852', AU: '61', NZ: '64', BR: '55', MX: '52', AR: '54',
  ZA: '27', EE: '372', LV: '371', LT: '370', RS: '381', CY: '357', TH: '66', ID: '62', VN: '84', MY: '60',
};

export type PhoneResult =
  | { ok: true; originalPhoneNumber: string; countryCode: string | null; normalizedPhoneNumber: string }
  | { ok: false; reason: 'MISSING_COUNTRY_CODE' | 'INVALID_PHONE_NUMBER' };

/** E.164-style normalisation: '+44 20 7946 0958' → '+442079460958'; national numbers need a known country code. */
export function normalizePhone(original: string, countryCode: string | null | undefined): PhoneResult {
  const trimmed = original.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  const cc = countryCode ? countryCode.toUpperCase() : null;
  if (trimmed.startsWith('+') || trimmed.startsWith('00')) {
    const intl = trimmed.startsWith('00') ? digits.slice(2) : digits;
    if (intl.length < 6 || intl.length > 15) return { ok: false, reason: 'INVALID_PHONE_NUMBER' };
    return { ok: true, originalPhoneNumber: trimmed, countryCode: cc, normalizedPhoneNumber: `+${intl}` };
  }
  const calling = cc ? CALLING_CODES[cc] : undefined;
  if (!calling) return { ok: false, reason: 'MISSING_COUNTRY_CODE' };
  const national = digits.replace(/^0+/, '');
  if (national.length < 4 || calling.length + national.length > 15)
    return { ok: false, reason: 'INVALID_PHONE_NUMBER' };
  return { ok: true, originalPhoneNumber: trimmed, countryCode: cc, normalizedPhoneNumber: `+${calling}${national}` };
}

/** Any ISO-8601 timestamp with offset → UTC 'YYYY-MM-DDTHH:MM:SS.ffffffZ' (microseconds, as Postgres stores). */
export function normalizeTimestamp(input: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})$/i.exec(input.trim());
  if (!m) return null;
  const whole = Date.parse(`${m[1]}${(m[3] as string).toUpperCase()}`);
  if (Number.isNaN(whole)) return null;
  const fraction = (m[2] ?? '').slice(0, 6).padEnd(6, '0');
  return `${new Date(whole).toISOString().slice(0, 19)}.${fraction}Z`;
}

/** 'YYYY-MM-DD' or an ISO timestamp → the (UTC) calendar date, validated. */
export function normalizeDate(input: string): string | null {
  const s = input.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
  }
  const ts = normalizeTimestamp(s);
  return ts ? ts.slice(0, 10) : null;
}
