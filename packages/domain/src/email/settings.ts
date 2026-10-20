// Workspace email & calendar settings (F settings §4; BACKLOG 7.08 server): default visibility for new mailboxes,
// record creation mode, company auto-creation, the internal-domain protection switch, record suppression and
// workspace protected / blocked contacts. Writes are admin-only (settings pages are admin pages); non-member actors
// act for the workspace.
import {
  type AddContactsOutput,
  type AddProtectedContactsInput,
  addContactsInputSchema,
  addProtectedContactsInputSchema,
  type ListSuppressionOutput,
  type ProtectedContact,
  removeEntryInputSchema,
  type SuppressionEntry,
  type UpdateWorkspaceEmailSettingsInput,
  updateProtectedContactInputSchema,
  updateWorkspaceEmailSettingsInputSchema,
  type WorkspaceEmailSettings,
} from '@agentic-crm/contracts';
import { toActor } from '../collab/common.ts';
import { actingMemberId } from '../context.ts';
import { forbidden, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Tx } from '../tx.ts';
import { invalidateEmailMemo, loadDirectory, loadEmailSettings, parseContact, splitTokens } from './model.ts';

/** Throws 403 unless the acting member is a workspace admin (non-member actors pass). */
export async function requireAdmin(tx: Tx): Promise<void> {
  const memberId = actingMemberId(tx.ctx);
  if (!memberId) return;
  const row = await tx.db
    .selectFrom('workspace_members')
    .select('access_level')
    .where('id', '=', memberId)
    .executeTakeFirst();
  if (row?.access_level !== 'admin') throw forbidden('Only workspace admins can do this');
}

function emitSettings(tx: Tx): void {
  tx.emit('workspace-email-settings', null, {});
}

type EntryRow = { id: string; kind: 'domain' | 'email'; value: string; created_by: unknown; created_at: string };
const toEntry = (r: EntryRow): SuppressionEntry => ({
  id: r.id,
  kind: r.kind,
  value: r.value,
  createdBy: toActor(r.created_by),
  createdAt: r.created_at,
});

/** Parses token-dialog values, splitting valid / invalid / duplicate (against `existing` and within the input). */
export function classifyContacts(
  values: string[],
  existing: Set<string>,
): { fresh: { kind: 'domain' | 'email'; value: string }[]; duplicates: string[]; invalid: string[] } {
  const fresh: { kind: 'domain' | 'email'; value: string }[] = [];
  const duplicates: string[] = [];
  const invalid: string[] = [];
  const seen = new Set(existing);
  for (const raw of splitTokens(values)) {
    const contact = parseContact(raw);
    if (!contact) {
      invalid.push(raw);
      continue;
    }
    const key = `${contact.kind}:${contact.value}`;
    if (seen.has(key)) {
      duplicates.push(contact.value);
      continue;
    }
    seen.add(key);
    fresh.push(contact);
  }
  return { fresh, duplicates, invalid };
}

export const settingsOps = {
  async get(tx: Tx): Promise<WorkspaceEmailSettings> {
    const settings = await loadEmailSettings(tx);
    const directory = await loadDirectory(tx);
    return {
      defaultVisibility: settings.defaultVisibility,
      recordCreation: settings.recordCreation,
      autoCreateCompanies: settings.autoCreateCompanies,
      internalDomains: [...directory.internalDomains].sort(),
      unprotectedDomains: settings.unprotectedDomains,
      updatedAt: settings.updatedAt,
    };
  },

  async update(tx: Tx, input: UpdateWorkspaceEmailSettingsInput): Promise<WorkspaceEmailSettings> {
    const data = updateWorkspaceEmailSettingsInputSchema.parse(input);
    await requireAdmin(tx);
    const current = await loadEmailSettings(tx);
    const next = {
      default_visibility: data.defaultVisibility ?? current.defaultVisibility,
      record_creation: data.recordCreation ?? current.recordCreation,
      auto_create_companies: data.autoCreateCompanies ?? current.autoCreateCompanies,
      unprotected_domains: data.unprotectedDomains
        ? [...new Set(data.unprotectedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean))]
        : current.unprotectedDomains,
      updated_by: JSON.stringify(tx.ctx.actor),
      updated_at: tx.now,
    };
    await tx.db
      .insertInto('workspace_email_settings')
      .values({ workspace_id: tx.workspaceId, ...next })
      .onConflict((oc) => oc.column('workspace_id').doUpdateSet(next))
      .execute();
    invalidateEmailMemo(tx);
    emitSettings(tx);
    return settingsOps.get(tx);
  },

  async listSuppression(tx: Tx): Promise<ListSuppressionOutput> {
    const rows = await tx.db.selectFrom('record_suppressions').selectAll().orderBy('created_at', 'desc').execute();
    return {
      domains: rows.filter((r) => r.kind === 'domain').map(toEntry),
      emailAddresses: rows.filter((r) => r.kind === 'email').map(toEntry),
    };
  },

  async addSuppression(tx: Tx, input: { values: string[] }): Promise<AddContactsOutput> {
    const data = addContactsInputSchema.parse(input);
    await requireAdmin(tx);
    const existing = await tx.db.selectFrom('record_suppressions').select(['kind', 'value']).execute();
    const { fresh, duplicates, invalid } = classifyContacts(
      data.values,
      new Set(existing.map((e) => `${e.kind}:${e.value}`)),
    );
    const added =
      fresh.length === 0
        ? []
        : await tx.db
            .insertInto('record_suppressions')
            .values(
              fresh.map((c) => ({
                id: newId(),
                workspace_id: tx.workspaceId,
                kind: c.kind,
                value: c.value,
                created_by: JSON.stringify(tx.ctx.actor),
              })),
            )
            .returningAll()
            .execute();
    invalidateEmailMemo(tx);
    emitSettings(tx);
    return { added: added.map(toEntry), duplicates, invalid };
  },

  async removeSuppression(tx: Tx, input: { id: string }): Promise<{ id: string }> {
    const { id } = removeEntryInputSchema.parse(input);
    await requireAdmin(tx);
    const row = await tx.db.deleteFrom('record_suppressions').where('id', '=', id).returning('id').executeTakeFirst();
    if (!row) throw notFound('Suppression not found', { id });
    invalidateEmailMemo(tx);
    emitSettings(tx);
    return { id };
  },

  async listProtected(tx: Tx): Promise<ProtectedContact[]> {
    const rows = await tx.db.selectFrom('protected_contacts').selectAll().orderBy('created_at', 'desc').execute();
    return rows.map((r) => ({ ...toEntry(r), enforcement: r.enforcement, updatedAt: r.updated_at }));
  },

  async addProtected(tx: Tx, input: AddProtectedContactsInput): Promise<AddContactsOutput> {
    const data = addProtectedContactsInputSchema.parse(input);
    await requireAdmin(tx);
    const existing = await tx.db.selectFrom('protected_contacts').select(['kind', 'value']).execute();
    const { fresh, duplicates, invalid } = classifyContacts(
      data.values,
      new Set(existing.map((e) => `${e.kind}:${e.value}`)),
    );
    const added =
      fresh.length === 0
        ? []
        : await tx.db
            .insertInto('protected_contacts')
            .values(
              fresh.map((c) => ({
                id: newId(),
                workspace_id: tx.workspaceId,
                kind: c.kind,
                value: c.value,
                enforcement: data.enforcement,
                created_by: JSON.stringify(tx.ctx.actor),
              })),
            )
            .returningAll()
            .execute();
    invalidateEmailMemo(tx);
    emitSettings(tx);
    return { added: added.map(toEntry), duplicates, invalid };
  },

  async updateProtected(
    tx: Tx,
    input: { id: string; enforcement: 'protected' | 'blocked' },
  ): Promise<ProtectedContact> {
    const data = updateProtectedContactInputSchema.parse(input);
    await requireAdmin(tx);
    const row = await tx.db
      .updateTable('protected_contacts')
      .set({ enforcement: data.enforcement, updated_at: tx.now })
      .where('id', '=', data.id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw notFound('Contact not found', { id: data.id });
    invalidateEmailMemo(tx);
    emitSettings(tx);
    return { ...toEntry(row), enforcement: row.enforcement, updatedAt: row.updated_at };
  },

  async removeProtected(tx: Tx, input: { id: string }): Promise<{ id: string }> {
    const { id } = removeEntryInputSchema.parse(input);
    await requireAdmin(tx);
    const row = await tx.db.deleteFrom('protected_contacts').where('id', '=', id).returning('id').executeTakeFirst();
    if (!row) throw notFound('Contact not found', { id });
    invalidateEmailMemo(tx);
    emitSettings(tx);
    return { id };
  },
};
