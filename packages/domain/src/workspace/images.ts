// Avatar and logo images are uploaded through the record files flow (D §4.4) to the uploader's own member record and
// then referenced by id: "We only support PNGs, JPEGs and GIFs under 10MB" (J workspace-admin §1–2).
import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES } from '@agentic-crm/contracts';
import { badRequest } from '../errors.ts';
import type { Tx } from '../tx.ts';

/** Validates a storage entry as an image file on the member's record (any member record when memberId is null). */
export async function assertImageFile(tx: Tx, fileId: string, memberId: string | null): Promise<void> {
  const row = await tx.db
    .selectFrom('storage_entries as e')
    .innerJoin('entity_definitions as d', 'd.id', 'e.entity_definition_id')
    .select([
      'e.entry_type',
      'e.content_type',
      'e.content_size',
      'e.entity_instance_id',
      'e.deleted_at',
      'd.entity_type',
    ])
    .where('e.id', '=', fileId)
    .executeTakeFirst();
  const invalid = (message: string) => badRequest('VALIDATION_ERROR', message, { file_id: fileId });
  if (!row || row.deleted_at !== null || row.entry_type !== 'file') throw invalid('The file could not be found');
  if (row.entity_type !== 'workspace-member' || (memberId !== null && row.entity_instance_id !== memberId)) {
    throw invalid('Upload the image to your own member record first');
  }
  if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(row.content_type ?? '')) {
    throw invalid('We only support PNGs, JPEGs and GIFs under 10MB');
  }
  if (Number(row.content_size ?? 0) > IMAGE_MAX_BYTES) throw invalid('We only support PNGs, JPEGs and GIFs under 10MB');
}
