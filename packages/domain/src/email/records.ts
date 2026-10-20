// Participant → record matching and record auto-creation (F settings §4.2; BACKLOG 7.02, acceptance 2), shared by
// email ingestion, calendar ingestion and meetings created in the app or through /v2/meetings.
//
//   • Members' addresses and protected internal domains are "us": they never create or match people / companies.
//   • A person matches by email address (people.email_addresses, unique), a company by domain (companies.domains,
//     unique; the address domain, then its root domain). Public email providers never match or create companies.
//   • Record creation follows the workspace mode: all = every external participant; selective = recipients of
//     emails sent by members and calendar participants; none = nothing (matching still links existing records).
//   • "Automatically create company records": a company is created from the domain of a person created here (or of
//     a matched person without a company), and set as that person's company.
//   • Record suppression (addresses and domains) and protected / blocked contacts never create records.
// Records are created through the single write path (createRecordInTx + engine) with the caller's actor (the
// mail-sync system actor during ingestion).
import type { ValueInput } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { newId } from '../ids.ts';
import { engineFor } from '../records/engine.ts';
import { createRecordInTx } from '../records/service.ts';
import { type AttrDef, type DefInfo, loadDefinition } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { normalizeDomain } from '../values/normalize.ts';
import {
  type Address,
  type ContactLists,
  type Directory,
  type EmailSettings,
  isPublicDomain,
  loadContactLists,
  loadDirectory,
  loadEmailSettings,
  matchesList,
} from './model.ts';

export interface ParticipantMatch {
  memberId: string | null;
  personId: string | null;
  companyId: string | null;
  /** A member address or a protected internal domain. */
  internal: boolean;
  /** A workspace protected contact (emails involving it are visible to their owners only). */
  protectedContact: boolean;
}

export interface MatchOptions {
  /** May a person record be created for this participant (decided by the caller from the creation mode)? */
  createPerson: boolean;
}

/** The domain a company is created with: the root domain, unless that is a public provider (then the full one). */
function companyDomainOf(address: Address): string {
  if (address.rootDomain !== address.domain && !isPublicDomain(address.rootDomain)) return address.rootDomain;
  return address.domain;
}

/** "northwind.example.com" → "Northwind"; "acme.co.uk" → "Acme". */
export function companyNameFromDomain(domain: string): string {
  const root = normalizeDomain(domain)?.rootDomain ?? domain;
  // Under a public root (e.g. northwind.example.com) the label left of the root names the company.
  const label =
    isPublicDomain(root) && domain.endsWith(`.${root}`)
      ? (domain
          .slice(0, -(root.length + 1))
          .split('.')
          .at(-1) ?? domain)
      : (root.split('.')[0] ?? domain);
  return label
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] as string, lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) as string };
}

export class RecordResolver {
  private people!: DefInfo;
  private companies!: DefInfo;
  private peopleEmail!: AttrDef;
  private peopleCompany!: AttrDef | undefined;
  private companyDomains!: AttrDef;
  directory!: Directory;
  lists!: ContactLists;
  settings!: EmailSettings;
  /** Records created by this resolver (for reporting). */
  readonly created: { entityDefinitionId: string; entityInstanceId: string }[] = [];
  private readonly personByEmail = new Map<string, string | null>();
  private readonly companyByDomain = new Map<string, string | null>();

  private constructor(readonly tx: Tx) {}

  static async create(tx: Tx): Promise<RecordResolver> {
    const cached = tx.memo.get('record-resolver') as RecordResolver | undefined;
    if (cached) return cached;
    const r = new RecordResolver(tx);
    r.people = await loadDefinition(tx, 'people');
    r.companies = await loadDefinition(tx, 'companies');
    r.peopleEmail = r.people.bySlug.get('email_addresses') as AttrDef;
    r.peopleCompany = r.people.bySlug.get('company');
    r.companyDomains = r.companies.bySlug.get('domains') as AttrDef;
    r.directory = await loadDirectory(tx);
    r.lists = await loadContactLists(tx);
    r.settings = await loadEmailSettings(tx);
    tx.memo.set('record-resolver', r);
    return r;
  }

  get peopleId(): string {
    return this.people.id;
  }

  get companiesId(): string {
    return this.companies.id;
  }

  memberOf(address: Address): string | null {
    return this.directory.memberByAddress.get(address.email) ?? null;
  }

  /** Members' addresses and protected internal domains. */
  isInternal(address: Address): boolean {
    return this.memberOf(address) !== null || this.directory.protectedInternalDomains.has(address.domain);
  }

  isBlocked(address: Address): boolean {
    return matchesList(this.lists.blocked, address);
  }

  isProtected(address: Address): boolean {
    return matchesList(this.lists.protected, address);
  }

  isSuppressed(address: Address): boolean {
    return matchesList(this.lists.suppressed, address);
  }

  private async findByUnique(attr: AttrDef, key: string): Promise<string | null> {
    const { rows } = await sql<{ instance_id: string }>`
      SELECT v.instance_id FROM attribute_values v
      JOIN entity_instances i ON i.id = v.instance_id AND i.archived_at IS NULL AND i.merged_at IS NULL
      WHERE v.attribute_id = ${attr.id} AND v.unique_key = ${key} AND v.active_until IS NULL
      LIMIT 1`.execute(this.tx.db);
    return rows[0]?.instance_id ?? null;
  }

  async findPerson(address: Address): Promise<string | null> {
    if (!this.personByEmail.has(address.email)) {
      this.personByEmail.set(address.email, await this.findByUnique(this.peopleEmail, address.email));
    }
    return this.personByEmail.get(address.email) ?? null;
  }

  async findCompany(address: Address): Promise<string | null> {
    if (isPublicDomain(address.domain)) return null;
    for (const domain of new Set([address.domain, address.rootDomain])) {
      if (isPublicDomain(domain)) continue;
      if (!this.companyByDomain.has(domain)) {
        this.companyByDomain.set(domain, await this.findByUnique(this.companyDomains, domain));
      }
      const found = this.companyByDomain.get(domain);
      if (found) return found;
    }
    return null;
  }

  private async currentCompanyOf(personId: string): Promise<string | null> {
    if (!this.peopleCompany) return null;
    const rows = await engineFor(this.tx).currentValues(personId, this.peopleCompany.id);
    return rows[0]?.v_ref ?? null;
  }

  private async createRecord(def: DefInfo, values: Map<AttrDef, ValueInput[]>): Promise<string> {
    const id = newId();
    await createRecordInTx(this.tx, def, id, values);
    this.created.push({ entityDefinitionId: def.id, entityInstanceId: id });
    return id;
  }

  /** May a company be auto-created for this address? */
  private canCreateCompany(address: Address): boolean {
    if (!this.settings.autoCreateCompanies) return false;
    const domain = companyDomainOf(address);
    if (isPublicDomain(address.domain) || isPublicDomain(domain)) return false;
    if (this.directory.internalDomains.has(address.domain)) return false;
    return !this.isSuppressed(address) && !this.isProtected(address) && !this.isBlocked(address);
  }

  /**
   * Matches (and, when allowed, creates) the person and company of one participant. Members and protected internal
   * addresses get only their member id.
   */
  async match(address: Address, options: MatchOptions): Promise<ParticipantMatch> {
    const memberId = this.memberOf(address);
    const protectedContact = this.isProtected(address);
    if (this.isInternal(address)) {
      return { memberId, personId: null, companyId: null, internal: true, protectedContact };
    }
    let personId = await this.findPerson(address);
    let companyId = await this.findCompany(address);
    const mayCreate = !this.isSuppressed(address) && !protectedContact && !this.isBlocked(address);
    let personCreated = false;
    if (!personId && options.createPerson && mayCreate) {
      const values = new Map<AttrDef, ValueInput[]>([[this.peopleEmail, [{ value: address.original }]]]);
      const nameAttr = this.people.bySlug.get('name');
      if (address.name && nameAttr) {
        const { firstName, lastName } = splitName(address.name);
        values.set(nameAttr, [{ value: { firstName, lastName, fullName: address.name } }]);
      }
      personId = await this.createRecord(this.people, values);
      this.personByEmail.set(address.email, personId);
      personCreated = true;
    }
    if (!companyId && personId && this.canCreateCompany(address)) {
      // A company is created for a person created here, or for a matched person who has none yet.
      if (personCreated || (await this.currentCompanyOf(personId)) === null) {
        const domain = companyDomainOf(address);
        const values = new Map<AttrDef, ValueInput[]>([[this.companyDomains, [{ value: domain }]]]);
        const nameAttr = this.companies.bySlug.get('name');
        if (nameAttr) values.set(nameAttr, [{ value: companyNameFromDomain(domain) }]);
        companyId = await this.createRecord(this.companies, values);
        this.companyByDomain.set(domain, companyId);
        this.companyByDomain.set(address.domain, companyId);
      }
    }
    if (personId && companyId && this.peopleCompany && (await this.currentCompanyOf(personId)) === null) {
      const engine = engineFor(this.tx);
      await engine.lock([personId]);
      await engine.asSystem(() =>
        engine.setAttribute(this.people, personId as string, this.peopleCompany as AttrDef, [
          { value: { entityDefinitionId: this.companies.id, entityInstanceId: companyId as string } },
        ]),
      );
    }
    return { memberId, personId, companyId, internal: false, protectedContact };
  }
}
