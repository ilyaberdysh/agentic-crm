// Shared helpers of the email and calendar services: address normalisation, public email providers, visibility
// levels, workspace email settings and the contact lists (suppression, protected / blocked contacts, mailbox
// blocklist) that ingestion consults.
import { ACCESS_RANK, type EmailAccess, type RecordCreationMode, type VisibilityLevel } from '@agentic-crm/contracts';
import type { Tx } from '../tx.ts';
import { normalizeDomain, normalizeEmail } from '../values/normalize.ts';

/**
 * Free / personal email providers: never internal domains, never auto-created companies, never matched to a
 * company by domain (Attio creates companies only from business domains).
 */
// biome-ignore format: compact table
export const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de',
  'web.de', 'mail.com', 'zoho.com', 'yandex.ru', 'yandex.com', 'ya.ru', 'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru',
  'rambler.ru', 'qq.com', '163.com', 'fastmail.com', 'hey.com', 'tutanota.com', 'example.com',
]);

export interface Address {
  /** Normalised (lower case). */
  email: string;
  original: string;
  domain: string;
  rootDomain: string;
  name: string | null;
}

/** Normalises an address; null when it is not a valid email address. */
export function toAddress(emailAddress: string, name?: string | null): Address | null {
  const n = normalizeEmail(emailAddress);
  if (!n) return null;
  const trimmed = name?.trim();
  return {
    email: n.normalizedEmailAddress,
    original: n.originalEmailAddress,
    domain: n.emailDomain,
    rootDomain: n.emailRootDomain,
    name: trimmed ? trimmed : null,
  };
}

export const isPublicDomain = (domain: string) => PUBLIC_EMAIL_DOMAINS.has(domain);

export const rank = (level: EmailAccess) => ACCESS_RANK[level];

export function maxAccess(a: EmailAccess, b: EmailAccess): EmailAccess {
  return rank(a) >= rank(b) ? a : b;
}

/** Parses a token-dialog value: a domain or an email address (null when neither). */
export function parseContact(raw: string): { kind: 'domain' | 'email'; value: string } | null {
  const value = raw.trim().replace(/^@/, '');
  if (value === '') return null;
  if (value.includes('@')) {
    const n = normalizeEmail(value);
    return n ? { kind: 'email', value: n.normalizedEmailAddress } : null;
  }
  const d = normalizeDomain(value);
  return d && d.normalizedDomain === value.toLowerCase().replace(/^www\./, '')
    ? { kind: 'domain', value: d.normalizedDomain }
    : null;
}

/** Splits token-dialog input ("a.com, b@c.com d.io") into values. */
export function splitTokens(values: string[]): string[] {
  return values.flatMap((v) => v.split(/[\s,;]+/)).filter((v) => v.trim() !== '');
}

export interface EmailSettings {
  defaultVisibility: VisibilityLevel;
  recordCreation: RecordCreationMode;
  autoCreateCompanies: boolean;
  unprotectedDomains: string[];
  updatedAt: string | null;
}

export async function loadEmailSettings(tx: Tx): Promise<EmailSettings> {
  const cached = tx.memo.get('email-settings') as EmailSettings | undefined;
  if (cached) return cached;
  const row = await tx.db
    .selectFrom('workspace_email_settings')
    .selectAll()
    .where('workspace_id', '=', tx.workspaceId)
    .executeTakeFirst();
  const settings: EmailSettings = row
    ? {
        defaultVisibility: row.default_visibility,
        recordCreation: row.record_creation,
        autoCreateCompanies: row.auto_create_companies,
        unprotectedDomains: row.unprotected_domains,
        updatedAt: row.updated_at,
      }
    : {
        defaultVisibility: 'subject-line',
        recordCreation: 'selective',
        autoCreateCompanies: true,
        unprotectedDomains: [],
        updatedAt: null,
      };
  tx.memo.set('email-settings', settings);
  return settings;
}

/**
 * Who counts as "us": members' addresses (account emails and mailbox addresses + aliases) and the internal domains
 * derived from them (public providers excluded). Internal addresses never create or match records.
 */
export interface Directory {
  /** Normalised address → member id. */
  memberByAddress: Map<string, string>;
  /** Internal business domains (system-default protected unless switched off). */
  internalDomains: Set<string>;
  /** Internal domains still protected (internal minus the unprotected ones). */
  protectedInternalDomains: Set<string>;
}

export async function loadDirectory(tx: Tx): Promise<Directory> {
  const cached = tx.memo.get('email-directory') as Directory | undefined;
  if (cached) return cached;
  const members = await tx.db
    .selectFrom('workspace_members')
    .select(['id', 'email_address'])
    .where('access_level', '!=', 'suspended')
    .execute();
  const mailboxes = await tx.db
    .selectFrom('mailboxes')
    .select(['member_id', 'email_address', 'aliases'])
    .where('archived_at', 'is', null)
    .execute();
  const memberByAddress = new Map<string, string>();
  for (const m of members) {
    const a = toAddress(m.email_address);
    if (a) memberByAddress.set(a.email, m.id);
  }
  for (const mb of mailboxes) {
    for (const raw of [mb.email_address, ...mb.aliases]) {
      const a = toAddress(raw);
      if (a && !memberByAddress.has(a.email)) memberByAddress.set(a.email, mb.member_id);
    }
  }
  const internalDomains = new Set<string>();
  for (const email of memberByAddress.keys()) {
    const domain = email.split('@')[1] as string;
    if (!isPublicDomain(domain)) internalDomains.add(domain);
  }
  const settings = await loadEmailSettings(tx);
  const unprotected = new Set(settings.unprotectedDomains);
  const directory: Directory = {
    memberByAddress,
    internalDomains,
    protectedInternalDomains: new Set([...internalDomains].filter((d) => !unprotected.has(d))),
  };
  tx.memo.set('email-directory', directory);
  return directory;
}

/** Contact lists consulted per address: workspace protected / blocked contacts and record suppression. */
export interface ContactLists {
  blocked: { domains: Set<string>; emails: Set<string> };
  protected: { domains: Set<string>; emails: Set<string> };
  suppressed: { domains: Set<string>; emails: Set<string> };
}

export async function loadContactLists(tx: Tx): Promise<ContactLists> {
  const cached = tx.memo.get('email-contact-lists') as ContactLists | undefined;
  if (cached) return cached;
  const lists: ContactLists = {
    blocked: { domains: new Set(), emails: new Set() },
    protected: { domains: new Set(), emails: new Set() },
    suppressed: { domains: new Set(), emails: new Set() },
  };
  const contacts = await tx.db.selectFrom('protected_contacts').select(['kind', 'value', 'enforcement']).execute();
  for (const c of contacts) {
    const target = c.enforcement === 'blocked' ? lists.blocked : lists.protected;
    (c.kind === 'domain' ? target.domains : target.emails).add(c.value);
  }
  const suppressions = await tx.db.selectFrom('record_suppressions').select(['kind', 'value']).execute();
  for (const s of suppressions) (s.kind === 'domain' ? lists.suppressed.domains : lists.suppressed.emails).add(s.value);
  tx.memo.set('email-contact-lists', lists);
  return lists;
}

export function matchesList(list: { domains: Set<string>; emails: Set<string> }, address: Address): boolean {
  return list.emails.has(address.email) || list.domains.has(address.domain) || list.domains.has(address.rootDomain);
}

/** Drops memoised settings / lists after a settings write in the same transaction. */
export function invalidateEmailMemo(tx: Tx): void {
  for (const key of ['email-settings', 'email-directory', 'email-contact-lists']) tx.memo.delete(key);
}
