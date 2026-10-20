// Access to the rich-text document store (decision B.10, slice3-contracts.md). The `documents` table belongs to
// apps/collab (migration 0400_documents.sql): `documents(id, workspace_id, doc_type, parent_ref, yjs_state bytea,
// blocks jsonb, markdown text, search_text, version, updated_at …)`. The collab server persists Yjs state and writes
// the `blocks` / `markdown` projections; this module creates rows for new notes and templates (same transaction as
// the header, I1), copies bodies (template ⇄ note) and reads the projections for previews and /v2.
//
// Columns written here are exactly the contract's: id, workspace_id, doc_type, parent_ref (the owning header's id),
// yjs_state, blocks, markdown, search_text, version, updated_at. Markdown bodies go through documents/content.ts.

import type { DocumentContent } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { writeDocumentMarkdown } from '../documents/content.ts';
import type { Tx } from '../tx.ts';

export type DocType = 'note' | 'note-template';

/** Creates an empty document for a new note / template (idempotent per id). */
export async function createDocument(tx: Tx, input: { id: string; docType: DocType; parentId: string }): Promise<void> {
  await sql`
    INSERT INTO documents (id, workspace_id, doc_type, parent_ref)
    VALUES (${input.id}, ${tx.workspaceId}, ${input.docType}, ${input.parentId})
    ON CONFLICT (id) DO NOTHING`.execute(tx.db);
}

/**
 * Copies a body into a brand-new document (template from note, note from template). The Yjs state is copied as is,
 * so the collab server opens the copy with the same content. A missing source yields an empty document.
 */
export async function copyDocument(
  tx: Tx,
  input: { sourceId: string; id: string; docType: DocType; parentId: string },
): Promise<void> {
  const { rows } = await sql<{ id: string }>`
    INSERT INTO documents (id, workspace_id, doc_type, parent_ref, yjs_state, blocks, markdown, search_text)
    SELECT ${input.id}, ${tx.workspaceId}, ${input.docType}, ${input.parentId}, s.yjs_state, s.blocks, s.markdown,
           s.search_text
    FROM documents s WHERE s.id = ${input.sourceId}
    ON CONFLICT (id) DO NOTHING
    RETURNING id`.execute(tx.db);
  if (rows.length === 0) await createDocument(tx, input);
}

/**
 * Replaces a body from an existing one, only while the target has never been stored by the collab server (no Yjs
 * state): an open editor session would otherwise overwrite the copy. Returns whether the copy happened.
 */
export async function copyIntoPristineDocument(
  tx: Tx,
  input: { sourceId: string; targetId: string },
): Promise<boolean> {
  const { rows } = await sql<{ id: string }>`
    UPDATE documents t
    SET yjs_state = s.yjs_state, blocks = s.blocks, markdown = s.markdown, search_text = s.search_text,
        version = t.version + 1, updated_at = now()
    FROM documents s
    WHERE t.id = ${input.targetId} AND s.id = ${input.sourceId} AND t.yjs_state IS NULL
      AND (t.blocks IS NULL OR jsonb_array_length(t.blocks) = 0) AND coalesce(t.markdown, '') = ''
    RETURNING t.id`.execute(tx.db);
  return rows.length > 0;
}

/**
 * Sets a body from markdown (public API create / PATCH content): converted with the editor model into blocks and
 * applied to the Yjs state as a diff in this same transaction (documents/content.ts), so `yjs_state`, `blocks`,
 * `markdown` and `search_text` stay consistent and an open editor receives the change live.
 */
export async function setDocumentMarkdown(tx: Tx, id: string, markdown: string): Promise<void> {
  await writeDocumentMarkdown(tx, id, markdown);
}

interface DocumentRow {
  id: string;
  markdown: string | null;
  blocks: unknown;
  updated_at: string | null;
}

/** Content projections of several documents (missing documents are absent from the map). */
export async function readDocuments(tx: Tx, ids: string[]): Promise<Map<string, DocumentContent>> {
  const out = new Map<string, DocumentContent>();
  if (ids.length === 0) return out;
  const { rows } = await sql<DocumentRow>`
    SELECT id, markdown, blocks, updated_at FROM documents WHERE id = ANY(${[...new Set(ids)]}::uuid[])`.execute(tx.db);
  for (const row of rows) {
    const blocks = Array.isArray(row.blocks) ? (row.blocks as unknown[]) : null;
    out.set(row.id, {
      markdown: row.markdown,
      plaintext: blocks ? blocksToPlaintext(blocks) : row.markdown === null ? null : markdownToPlaintext(row.markdown),
      blocks,
      updatedAt: row.updated_at,
    });
  }
  return out;
}

export const EMPTY_CONTENT: DocumentContent = { markdown: null, plaintext: null, blocks: null, updatedAt: null };

/** Public `content_plaintext`: one line per block (images give an empty line, E README §6). */
export function blocksToPlaintext(blocks: unknown[]): string {
  return blocks
    .map((b) => {
      const block = (b ?? {}) as { plaintext?: unknown; text?: unknown };
      if (typeof block.plaintext === 'string') return block.plaintext;
      if (typeof block.text === 'string') return block.text;
      return '';
    })
    .join('\n');
}

/** Strips the markdown subset of notes (headings, list markers, emphasis, highlight, links) to plain text. */
export function markdownToPlaintext(markdown: string): string {
  // Backslash escapes are parked in the private-use area so the emphasis rules below cannot touch them.
  const escaped: string[] = [];
  const park = (s: string) =>
    s.replace(/\\([\\`*_~=[\]#+\-.!()])/g, (_, ch: string) => {
      escaped.push(ch);
      return String.fromCharCode(0xe000 + escaped.length - 1);
    });
  const unpark = (s: string) => s.replace(/[-]/g, (c) => escaped[c.charCodeAt(0) - 0xe000] ?? '');
  return unpark(
    park(markdown)
      .split('\n')
      .map((line) =>
        line
          .replace(/^\s{0,}#{1,3}\s+/, '')
          .replace(/^(\s*)([-*+]|\d+\.)\s+/, '$1')
          .replace(/^\s+/, '')
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/(\*\*|__)(.+?)\1/g, '$2')
          .replace(/~~(.+?)~~/g, '$1')
          .replace(/==(.+?)==/g, '$1')
          .replace(/(\*|_)(.+?)\1/g, '$2'),
      )
      .join('\n'),
  );
}

/** Converts plain text (public API `format: plaintext`) to markdown that renders the same text. */
export function plaintextToMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/([\\`*_~=[\]#])/g, '\\$1').replace(/^(\s*)([-+]|\d+\.)(\s)/, '$1\\$2$3'))
    .join('\n');
}
