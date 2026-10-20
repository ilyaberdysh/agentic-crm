// Derived entry bookkeeping: every record's hidden multi-value `list_entries` attribute points at its live entries
// (A §4.4), so record views can filter by list membership (`[list_entries, <list attribute>]` paths).
import type { RecordRef } from '@agentic-crm/contracts';
import { engineFor } from '../records/engine.ts';
import { loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { liveEntriesOf } from './parents.ts';

/**
 * Recomputes `list_entries` of records from their live entries (written as the system: the attribute is read-only).
 * Unchanged values keep their rows. The caller finalises the engine.
 */
export async function syncListEntries(tx: Tx, records: RecordRef[]): Promise<void> {
  if (records.length === 0) return;
  const engine = engineFor(tx);
  const ids = [...new Set(records.map((r) => r.entityInstanceId))];
  await engine.lock(ids);
  const live = await tx.db
    .selectFrom('entity_instances')
    .select(['id', 'entity_definition_id'])
    .where('id', 'in', ids)
    .where('archived_at', 'is', null)
    .where('merged_at', 'is', null)
    .execute();
  if (live.length === 0) return;
  const defs = await loadDefinitionsByIds(
    tx,
    live.map((r) => r.entity_definition_id),
  );
  const entries = await liveEntriesOf(
    tx,
    live.map((r) => r.id),
  );
  for (const record of live) {
    const def = defs.get(record.entity_definition_id);
    const attr = def?.attrs.find((a) => a.systemAttributeType === 'list-entries' && !a.isArchived);
    if (!def || !attr) continue;
    const desired = entries
      .filter((e) => e.recordId === record.id)
      .map((e) => ({ value: { entityDefinitionId: e.listId, entityInstanceId: e.entryId } }));
    await engine.asSystem(() => engine.setAttribute(def, record.id, attr, desired, 'replace'));
  }
}
