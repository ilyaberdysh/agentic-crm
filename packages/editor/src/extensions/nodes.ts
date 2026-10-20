// Nodes of the note schema, restricted to Attio's model (E editor.md §3): paragraph ("Body"), headings 1–3, flat
// list items (list-item.ts), images, hard breaks and inline mentions. No quote, code block, divider, checklist,
// table, toggle or callout: their markdown triggers stay literal text.

import { mergeAttributes, Node } from '@tiptap/core';
import { Document as TiptapDocument } from '@tiptap/extension-document';
import { HardBreak as TiptapHardBreak } from '@tiptap/extension-hard-break';
import { Heading as TiptapHeading } from '@tiptap/extension-heading';
import { Paragraph as TiptapParagraph } from '@tiptap/extension-paragraph';
import { IMAGE_ALIGNMENTS, type ImageAlignment } from '../model/blocks.ts';

export const Document = TiptapDocument.extend({ content: 'block+' });

export const Paragraph = TiptapParagraph.extend({
  addOptions() {
    return { ...this.parent?.(), HTMLAttributes: { class: 'agentic-crm-note-paragraph' } };
  },
  addKeyboardShortcuts() {
    return {};
  },
});

/** h1–h3 only; `#### ` and deeper stay literal (Attio cannot store h4–h6). No Mod-Alt-n shortcuts (Attio has none). */
export const Heading = TiptapHeading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const level = [1, 2, 3].includes(node.attrs.level) ? node.attrs.level : 1;
    return [`h${level}`, mergeAttributes({ class: `agentic-crm-note-heading-h${level}` }, HTMLAttributes), 0];
  },
  addKeyboardShortcuts() {
    return {};
  },
}).configure({ levels: [1, 2, 3] });

/** Shift+Enter inserts a line break inside the block (Mod+Enter is left to the host, e.g. "submit"). */
export const HardBreak = TiptapHardBreak.extend({
  addKeyboardShortcuts() {
    return { 'Shift-Enter': () => this.editor.commands.setHardBreak() };
  },
});

export interface ImageAttributes {
  src: string | null;
  assetId: string | null;
  /** Client-side id of an upload in progress (the uploader swaps in src/assetId when it completes). */
  uploadId: string | null;
  width: number | null;
  height: number | null;
  alignment: ImageAlignment;
  caption: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      /** Inserts an image block after the current block (replacing it when it is an empty paragraph). */
      insertImage: (attributes: Partial<ImageAttributes>) => ReturnType;
    };
  }
}

const numberAttr = (name: string) => ({
  default: null,
  parseHTML: (element: { getAttribute(name: string): string | null }) => {
    const raw = element.getAttribute(name);
    const value = raw === null ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  },
});

/** Block-level image (Attio `image-embed`): natural size up to the column width, centred by default. */
export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      assetId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-asset-id'),
        renderHTML: (attributes) => (attributes.assetId ? { 'data-asset-id': attributes.assetId } : {}),
      },
      uploadId: { default: null, rendered: false },
      width: numberAttr('width'),
      height: numberAttr('height'),
      alignment: {
        default: 'center' as ImageAlignment,
        parseHTML: (element) => {
          const value = element.getAttribute('data-align');
          return (IMAGE_ALIGNMENTS as readonly string[]).includes(value ?? '') ? value : 'center';
        },
        renderHTML: (attributes) => ({ 'data-align': attributes.alignment }),
      },
      caption: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-caption'),
        renderHTML: (attributes) => (attributes.caption ? { 'data-caption': attributes.caption } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes({ class: 'agentic-crm-note-image' }, HTMLAttributes)];
  },

  addCommands() {
    return {
      insertImage:
        (attributes) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes.image;
          if (!type) return false;
          const node = type.create({ alignment: 'center', ...attributes });
          const { $from } = state.selection;
          const parent = $from.depth > 0 ? $from.node(1) : null;
          if (dispatch) {
            if (parent && parent.type.name === 'paragraph' && parent.content.size === 0) {
              const start = $from.before(1);
              tr.replaceWith(start, start + parent.nodeSize, node);
            } else {
              const after = $from.depth > 0 ? $from.after(1) : state.selection.to;
              tr.insert(after, node);
            }
            dispatch(tr.scrollIntoView());
          }
          return true;
        },
    };
  },
});

export type MentionKind = 'member' | 'record';

export interface MentionAttributes {
  kind: MentionKind;
  /** Workspace member id, or the record's entity instance id. */
  id: string;
  /** Record mentions only. */
  entityDefinitionId: string | null;
  /** Display name at insertion time (rendered as `@label`). */
  label: string;
}

/** Inline mention token (Attio `agentic-crm-actor-reference-node` / `agentic-crm-entity-reference-node`). */
export const Mention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  /** No marks on mentions (Attio renders them unstyled; Yjs would not keep marks on inline atoms anyway). */
  marks: '',

  addAttributes() {
    return {
      kind: {
        default: 'member' as MentionKind,
        parseHTML: (element) => (element.getAttribute('data-mention-kind') === 'record' ? 'record' : 'member'),
        renderHTML: (attributes) => ({ 'data-mention-kind': attributes.kind }),
      },
      id: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-id') ?? '',
        renderHTML: (attributes) => ({ 'data-id': attributes.id }),
      },
      entityDefinitionId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-entity-definition-id'),
        renderHTML: (attributes) =>
          attributes.entityDefinitionId ? { 'data-entity-definition-id': attributes.entityDefinitionId } : {},
      },
      label: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-label') ?? element.textContent?.replace(/^@/, '') ?? '',
        renderHTML: (attributes) => ({ 'data-label': attributes.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention-kind]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const cls = node.attrs.kind === 'record' ? 'agentic-crm-entity-reference-node' : 'agentic-crm-actor-reference-node';
    return [
      'span',
      mergeAttributes({ class: `agentic-crm-note-mention ${cls}` }, HTMLAttributes),
      `@${node.attrs.label}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});

export interface VariableAttributes {
  /** JSON array of {entityDefinitionId, attributeDefinitionId} steps from the recipient record. */
  path: string;
  /** Sub-field (e.g. `first_name`), or null. */
  field: string | null;
  /** Value used when the merged value is empty, or null. */
  fallback: string | null;
  /** Chip label at insertion time ("Name › First"). */
  label: string | null;
}

/**
 * Inline placeholder variable of email bodies and templates (CROSS-DOMAIN B.11; F composer §2.6): an atom that the
 * block model stores as one `_` character plus a variable annotation. The composer renders it as a chip.
 */
export const Variable = Node.create({
  name: 'variable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',

  addAttributes() {
    return {
      path: {
        default: '[]',
        parseHTML: (element) => element.getAttribute('data-variable-path') ?? '[]',
        renderHTML: (attributes) => ({ 'data-variable-path': attributes.path }),
      },
      field: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-variable-field'),
        renderHTML: (attributes) => (attributes.field ? { 'data-variable-field': attributes.field } : {}),
      },
      fallback: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-variable-fallback'),
        renderHTML: (attributes) =>
          attributes.fallback !== null && attributes.fallback !== undefined
            ? { 'data-variable-fallback': attributes.fallback }
            : {},
      },
      label: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-variable-label'),
        renderHTML: (attributes) => (attributes.label ? { 'data-variable-label': attributes.label } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-variable-path]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ class: 'agentic-crm-variable' }, HTMLAttributes),
      `{ ${node.attrs.label ?? ''} }`,
    ];
  },

  renderText({ node }) {
    return `{ ${node.attrs.label ?? ''} }`;
  },
});
