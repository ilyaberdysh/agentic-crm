// "Send email" on selected records (F composer; table bulk bar): a mass-send draft addressed to the people among
// them — each person's primary email address and the record, so variables merge from it. Records without an email
// address (and companies: asks for related people first) are skipped with a note.
import { toast } from '@agentic-crm/ui';
import { api, inWorkspace, type WorkspaceRef } from '../../data/trpc';
import { MASS_SEND_MAX, type RecipientLike } from './model';
import { openComposer } from './open';

export interface SelectedRecord {
  entityDefinitionId: string;
  entityInstanceId: string;
}

async function recipientOf(ws: WorkspaceRef, record: SelectedRecord): Promise<RecipientLike | null> {
  // A record id finds exactly that record (search ranking: 2000).
  const out = await api.search.records.query(
    { query: record.entityInstanceId, entityDefinitionIds: [record.entityDefinitionId], limit: 1 },
    inWorkspace(ws),
  );
  const hit = out.hits.find((h) => h.entityInstanceId === record.entityInstanceId);
  const address = hit?.emailAddresses[0];
  return hit && address ? { emailAddress: address, name: hit.title, record } : null;
}

/** Resolves the records' addresses (in selection order) and opens the composer in mass-send mode. */
export async function composeToRecords(ws: WorkspaceRef, records: readonly SelectedRecord[]): Promise<void> {
  if (records.length === 0) return;
  const found: RecipientLike[] = [];
  const seen = new Set<string>();
  try {
    for (let i = 0; i < records.length; i += 10) {
      const batch = await Promise.all(records.slice(i, i + 10).map((r) => recipientOf(ws, r)));
      for (const r of batch) {
        if (!r || seen.has(r.emailAddress.toLowerCase())) continue;
        seen.add(r.emailAddress.toLowerCase());
        found.push(r);
      }
    }
  } catch {
    toast.error({ title: 'Failed to look up the email addresses' });
    return;
  }
  if (found.length === 0) {
    toast.warning({
      title: 'No email addresses to send to',
      description: 'Select people with an email address to send them an email.',
    });
    return;
  }
  const recipients = found.slice(0, MASS_SEND_MAX);
  if (found.length > MASS_SEND_MAX) {
    toast.warning({
      title: `Please add a maximum of ${MASS_SEND_MAX} recipients`,
      description: `The first ${MASS_SEND_MAX} were added.`,
    });
  } else if (found.length < records.length) {
    toast({ title: `${records.length - found.length} selected without an email address were skipped` });
  }
  openComposer({ to: recipients, isMassSend: true });
}
