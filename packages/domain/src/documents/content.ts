// Server-side body writes shared by the documents module and the note / template services (collab/documents.ts):
// a new body is applied to the stored Yjs state as a diff (so live editors merge it), the projections are
// recomputed from the result, and the collab server is told to pull the state (NOTIFY document_state).
import { jsonb, sql } from '@agentic-crm/db';
import {
  type Block,
  blocksToState,
  markdownToBlocks,
  projectYDoc,
  replaceYDocContent,
  yDocFromState,
} from '@agentic-crm/editor/model';
import * as Y from 'yjs';
import { touchSection } from '../calls/touch.ts';
import type { Tx } from '../tx.ts';

/** pg_notify channel: `{"id":…, "op":"update"|"delete"}` after a server-side write the collab server must pull. */
export const DOCUMENT_STATE_CHANNEL = 'document_state';

export async function notifyDocumentState(tx: Tx, id: string, op: 'update' | 'delete'): Promise<void> {
  await sql`SELECT pg_notify(${DOCUMENT_STATE_CHANNEL}, ${JSON.stringify({ id, op })})`.execute(tx.db);
}

/** Blocks a stored document holds: its projection, or its markdown (legacy rows written without blocks). */
export function storedBlocks(row: { blocks: unknown; markdown: string | null }): Block[] {
  if (Array.isArray(row.blocks)) return row.blocks as Block[];
  return row.markdown ? markdownToBlocks(row.markdown) : [];
}

/**
 * The stored body as a Y.Doc: the Yjs state, or — without one (or with an unreadable one) — a state built from what
 * the projections say the body is, so a diff still applies cleanly.
 */
export function baseDocument(row: { yjs_state: Buffer | null; blocks: unknown; markdown: string | null }): Y.Doc {
  if (row.yjs_state) {
    try {
      return yDocFromState(new Uint8Array(row.yjs_state));
    } catch {
      // fall through: rebuild from the projections
    }
  }
  return yDocFromState(blocksToState(storedBlocks(row)));
}

/**
 * Replaces the body of document `id` with `blocks` in the caller's transaction. Returns the new version, or null
 * when the document does not exist (or is deleted).
 */
export async function writeDocumentBlocks(tx: Tx, id: string, blocks: Block[]): Promise<number | null> {
  const row = await tx.db
    .selectFrom('documents')
    .select(['id', 'doc_type', 'parent_ref', 'yjs_state', 'blocks', 'markdown', 'version', 'deleted_at'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row || row.deleted_at !== null) return null;
  const ydoc = baseDocument(row);
  try {
    replaceYDocContent(ydoc, blocks);
    const state = Y.encodeStateAsUpdate(ydoc);
    const projection = projectYDoc(ydoc);
    const version = Number(row.version) + 1;
    await tx.db
      .updateTable('documents')
      .set({
        yjs_state: Buffer.from(state),
        blocks: jsonb(projection.blocks),
        markdown: projection.markdown,
        search_text: projection.searchText,
        version,
        updated_by: jsonb(tx.ctx.actor),
        updated_at: sql<string>`now()`,
      })
      .where('id', '=', id)
      .execute();
    tx.emit('document', id, { docType: row.doc_type, parentId: row.parent_ref, version });
    await notifyDocumentState(tx, id, 'update');
    if (row.doc_type === 'insight-section' && row.parent_ref) await touchSection(tx, row.parent_ref);
    return version;
  } finally {
    ydoc.destroy();
  }
}

/** Body from markdown (public API create / PATCH content, `format: markdown`). */
export async function writeDocumentMarkdown(tx: Tx, id: string, markdown: string): Promise<number | null> {
  return writeDocumentBlocks(tx, id, markdownToBlocks(markdown));
}
