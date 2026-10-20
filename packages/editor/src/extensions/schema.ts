// The document schema shared by the browser editor and the server projection: the exact node and mark set of
// Attio's note model. The editor adds UI behaviour (collaboration, menus, placeholders, node views) on top of these
// extensions; the server only needs the ProseMirror schema derived from them (no DOM, no React).

import { type AnyExtension, getSchema } from '@tiptap/core';
import { Text } from '@tiptap/extension-text';
import type { Schema } from '@tiptap/pm/model';
import { ListItem } from './list-item.ts';
import { BlockedShortcuts, Bold, Highlight, Italic, Link, Strike, TextColor } from './marks.ts';
import { Document, HardBreak, Heading, Image, Mention, Paragraph, Variable } from './nodes.ts';

/** Name of the Y.XmlFragment that holds the body in every document's Y.Doc. */
export const DOCUMENT_FRAGMENT = 'default';

export const schemaExtensions: AnyExtension[] = [
  Document,
  Paragraph,
  Text,
  Heading,
  ListItem,
  Image,
  HardBreak,
  Mention,
  Variable,
  Bold,
  Italic,
  Strike,
  TextColor,
  Highlight,
  Link,
  BlockedShortcuts,
];

let cached: Schema | null = null;

/** The ProseMirror schema of documents (memoised). */
export function getDocumentSchema(): Schema {
  if (!cached) cached = getSchema(schemaExtensions);
  return cached;
}
