// Yjs state ↔ blocks. The Y.Doc holds the ProseMirror document in the XmlFragment `default` (TipTap
// Collaboration's field); conversions go through the shared document schema so the server reads exactly what the
// editor writes (unknown or invalid content is dropped the same way the editor would drop it).
import { Node as PMNode } from '@tiptap/pm/model';
import { initProseMirrorDoc, prosemirrorJSONToYXmlFragment, updateYFragment } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { DOCUMENT_FRAGMENT, getDocumentSchema } from '../extensions/schema.ts';
import { type Block, blocksToPlaintext, blocksToSearchText } from './blocks.ts';
import { blocksToMarkdown } from './markdown.ts';
import { blocksToPmJson, type PMNodeJSON, pmJsonToBlocks } from './pm.ts';

export interface DocumentProjection {
  blocks: Block[];
  markdown: string;
  plaintext: string;
  searchText: string;
}

/** ProseMirror JSON of the body held by a Y.Doc. */
export function yDocToPmJson(ydoc: Y.Doc): PMNodeJSON {
  const fragment = ydoc.getXmlFragment(DOCUMENT_FRAGMENT);
  const { doc } = initProseMirrorDoc(fragment, getDocumentSchema());
  return doc.toJSON() as PMNodeJSON;
}

export function yDocToBlocks(ydoc: Y.Doc): Block[] {
  return pmJsonToBlocks(yDocToPmJson(ydoc));
}

/** A Y.Doc loaded from an encoded state (or empty). */
export function yDocFromState(state: Uint8Array | null | undefined): Y.Doc {
  const ydoc = new Y.Doc();
  if (state && state.byteLength > 0) Y.applyUpdate(ydoc, state);
  return ydoc;
}

export function stateToBlocks(state: Uint8Array | null | undefined): Block[] {
  const ydoc = yDocFromState(state);
  try {
    return yDocToBlocks(ydoc);
  } finally {
    ydoc.destroy();
  }
}

/** Every projection the server stores, from a list of blocks. */
export function projectBlocks(blocks: Block[]): DocumentProjection {
  return {
    blocks,
    markdown: blocksToMarkdown(blocks),
    plaintext: blocksToPlaintext(blocks),
    searchText: blocksToSearchText(blocks),
  };
}

export function projectState(state: Uint8Array | null | undefined): DocumentProjection {
  return projectBlocks(stateToBlocks(state));
}

export function projectYDoc(ydoc: Y.Doc): DocumentProjection {
  return projectBlocks(yDocToBlocks(ydoc));
}

/** A fresh Yjs state whose body is `blocks` (for documents created with initial content). */
export function blocksToState(blocks: readonly Block[]): Uint8Array {
  const ydoc = new Y.Doc();
  try {
    prosemirrorJSONToYXmlFragment(getDocumentSchema(), blocksToPmJson(blocks), ydoc.getXmlFragment(DOCUMENT_FRAGMENT));
    return Y.encodeStateAsUpdate(ydoc);
  } finally {
    ydoc.destroy();
  }
}

/**
 * Replaces the body of `ydoc` with `blocks` as a minimal diff (unchanged blocks keep their Yjs items, so concurrent
 * edits elsewhere survive). Runs in one Yjs transaction with `origin`.
 */
export function replaceYDocContent(ydoc: Y.Doc, blocks: readonly Block[], origin: unknown = null): void {
  const schema = getDocumentSchema();
  const fragment = ydoc.getXmlFragment(DOCUMENT_FRAGMENT);
  const { meta } = initProseMirrorDoc(fragment, schema);
  const next = PMNode.fromJSON(schema, blocksToPmJson(blocks));
  ydoc.transact(() => updateYFragment(ydoc, fragment, next, meta), origin);
}

/** Appends `blocks` after the existing body (e.g. applying a template to a note) in one transaction. */
export function appendYDocContent(ydoc: Y.Doc, blocks: readonly Block[], origin: unknown = null): void {
  const current = yDocToBlocks(ydoc);
  const isBlank = current.length === 1 && current[0]?.type === 'unstyled' && current[0].text === '';
  replaceYDocContent(ydoc, isBlank ? blocks : [...current, ...blocks], origin);
}
