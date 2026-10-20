// Hooks the documents store calls for insight-section documents (doc type 'insight-section', parent_ref = section):
// a content change marks the template's draft as touched (and the template as no longer transient, B.21); only the
// sections of a draft are editable — published versions are immutable (B.20). Kept free of other calls/ imports so
// documents/ can depend on it without a cycle.
import type { Tx } from '../tx.ts';

/** True when the section belongs to a template's current draft. */
export async function isDraftSection(tx: Tx, sectionId: string): Promise<boolean> {
  const row = await tx.db
    .selectFrom('insight_template_sections as s')
    .innerJoin('insight_template_snapshots as v', 'v.id', 's.snapshot_id')
    .select('v.status')
    .where('s.id', '=', sectionId)
    .where('s.deleted_at', 'is', null)
    .executeTakeFirst();
  return row?.status === 'draft';
}

/** Marks the draft of the template touched (publish / discard become available) and the template permanent. */
export async function touchDraft(tx: Tx, templateId: string, snapshotId: string): Promise<void> {
  await tx.db
    .updateTable('insight_template_snapshots')
    .set((eb) => ({
      first_touched_at: eb.fn.coalesce('first_touched_at', eb.val(tx.now)),
      last_touched_at: tx.now,
    }))
    .where('id', '=', snapshotId)
    .where('status', '=', 'draft')
    .execute();
  const changed = await tx.db
    .updateTable('insight_templates')
    .set({ is_transient: false, updated_at: tx.now })
    .where('id', '=', templateId)
    .returning(['id'])
    .executeTakeFirst();
  if (!changed) return;
  tx.emit('insight-template', templateId, { templateId });
  tx.emit('insight-template-list', null, { templateIds: [templateId] });
}

/** A section document changed: touch its draft (no-op for sections of published versions). */
export async function touchSection(tx: Tx, sectionId: string): Promise<void> {
  const row = await tx.db
    .selectFrom('insight_template_sections as s')
    .innerJoin('insight_template_snapshots as v', 'v.id', 's.snapshot_id')
    .select(['v.id as snapshot_id', 'v.template_id', 'v.status'])
    .where('s.id', '=', sectionId)
    .executeTakeFirst();
  if (row?.status !== 'draft') return;
  await touchDraft(tx, row.template_id, row.snapshot_id);
}
