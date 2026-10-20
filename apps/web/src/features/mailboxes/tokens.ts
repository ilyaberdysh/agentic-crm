// Token dialogs (mailbox blocklist, protected and blocked contacts, record suppression; F settings §2.2, §4): the
// textarea holds domains and addresses separated by commas, semicolons, spaces or line breaks. The server classifies
// every token (`{added, duplicates, invalid}`); these helpers split the input and turn the answer into what the
// dialog shows. Pure, so they are unit-tested.

/** Splits dialog input ("a.com, b@c.com d.io") into values, without empties and without repeats (case-insensitive). */
export function splitTokens(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const token = raw.trim();
    if (token === '') continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

export interface AddOutcome {
  added: readonly unknown[];
  /** Values already in the list (as the server normalised them). */
  duplicates: readonly string[];
  /** Raw tokens that are neither an address nor a domain. */
  invalid: readonly string[];
}

export interface OutcomeView {
  /** Tokens flagged "Invalid email/domain". */
  invalid: string[];
  /** "N duplicate email addresses were not added", or null. */
  duplicateMessage: string | null;
  /** The dialog closes once something was added or nothing is wrong. */
  shouldClose: boolean;
  /** What stays in the textarea when the dialog stays open: the flagged tokens only. */
  remaining: string;
  /** A closing dialog still tells about leftovers (toast text), or null. */
  leftoverNotice: string | null;
}

export const INVALID_TOKEN_MESSAGE = 'Invalid email/domain';

/** "1 duplicate domain was not added" / "3 duplicate email addresses were not added" / mixed → "entries". */
export function duplicateMessage(duplicates: readonly string[]): string | null {
  const n = duplicates.length;
  if (n === 0) return null;
  const emails = duplicates.filter((d) => d.includes('@')).length;
  const noun =
    emails === n
      ? n === 1
        ? 'email address'
        : 'email addresses'
      : emails === 0
        ? n === 1
          ? 'domain'
          : 'domains'
        : n === 1
          ? 'entry'
          : 'entries';
  return `${n} duplicate ${noun} ${n === 1 ? 'was' : 'were'} not added`;
}

export function invalidNotice(count: number): string | null {
  if (count === 0) return null;
  return `${count} invalid ${count === 1 ? 'entry was' : 'entries were'} not added`;
}

/** Interprets the server's answer for the dialog. */
export function describeOutcome(outcome: AddOutcome): OutcomeView {
  const invalid = [...outcome.invalid];
  const dupMessage = duplicateMessage(outcome.duplicates);
  const nothingWrong = invalid.length === 0 && outcome.duplicates.length === 0;
  const shouldClose = outcome.added.length > 0 || nothingWrong;
  const leftovers = [invalidNotice(invalid.length), dupMessage].filter((m): m is string => m !== null);
  return {
    invalid,
    duplicateMessage: dupMessage,
    shouldClose,
    remaining: [...invalid, ...outcome.duplicates].join(' '),
    leftoverNotice: shouldClose && leftovers.length > 0 ? leftovers.join('. ') : null,
  };
}

/** Whether `value` looks like an address (contains "@") rather than a domain. */
export const isEmailLike = (value: string): boolean => value.includes('@');
