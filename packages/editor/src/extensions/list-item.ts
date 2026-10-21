// Flat list items: the server model stores each list item as its own block with a list type
// (`ul`/`ol`) and an `indent` depth, so the editor uses the same flat structure — one textblock per item — instead of
// nested <ul><li> trees. Behaviour:
// - `- `, `* `, `+ ` start a bulleted item and `1. ` a numbered one (`1) ` is not recognised);
// - Enter in a non-empty item creates a sibling; Enter in an empty item outdents one level, and at level 0 leaves
// the list (paragraph);
// - Tab at the start of an item (or over a multi-block selection) indents, Shift+Tab outdents; Tab elsewhere inserts
// a tab character;
// - Backspace at the start of an item outdents, and at level 0 turns it into a paragraph;
// - adjacent items of the same type form one list (numbering continues across deeper items).
import { mergeAttributes, Node, textblockTypeInputRule } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { MAX_INDENT } from '../model/blocks.ts';
import { listNumbers } from '../model/numbering.ts';

export type ListKind = 'ul' | 'ol';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    listItem: {
      /** Turns the selected textblocks into list items of `kind` (keeps their indent when already list items). */
      setListItem: (kind: ListKind) => ReturnType;
      /** Toggles between `kind` list items and paragraphs. */
      toggleListItem: (kind: ListKind) => ReturnType;
      /** Changes the indent of every list item in the selection by `delta` (clamped to 0..MAX_INDENT). */
      indentListItems: (delta: 1 | -1) => ReturnType;
    };
  }
}

export const LIST_ITEM = 'listItem';

const numberingKey = new PluginKey<DecorationSet>('agenticCrmListNumbering');

function numberDecorations(doc: PMNode): DecorationSet {
  const items: Array<{ type: string; indent: number; pos: number; size: number }> = [];
  doc.forEach((node, offset) => {
    if (node.type.name === LIST_ITEM)
      items.push({
        type: node.attrs.kind as string,
        indent: node.attrs.indent as number,
        pos: offset,
        size: node.nodeSize,
      });
    else items.push({ type: 'other', indent: 0, pos: offset, size: node.nodeSize });
  });
  const numbers = listNumbers(items);
  const decorations: Decoration[] = [];
  items.forEach((item, i) => {
    const n = numbers[i];
    if (n !== null && n !== undefined)
      decorations.push(Decoration.node(item.pos, item.pos + item.size, { 'data-number': String(n) }));
  });
  return DecorationSet.create(doc, decorations);
}

/** List items (and their positions) touched by the selection. */
function selectedListItems(state: EditorState): Array<{ pos: number; node: PMNode }> {
  const { from, to } = state.selection;
  const out: Array<{ pos: number; node: PMNode }> = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === LIST_ITEM) out.push({ pos, node });
    return node.type.name === 'doc';
  });
  return out;
}

function changeIndent(tr: Transaction, items: Array<{ pos: number; node: PMNode }>, delta: number): boolean {
  let changed = false;
  for (const { pos, node } of items) {
    const indent = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent as number) + delta));
    if (indent === node.attrs.indent) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
    changed = true;
  }
  return changed;
}

export const ListItem = Node.create({
  name: LIST_ITEM,
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'ul' as ListKind,
        parseHTML: (element) => {
          const own = element.getAttribute('data-list');
          if (own === 'ol' || own === 'ul') return own;
          return element.parentElement?.tagName === 'OL' ? 'ol' : 'ul';
        },
        renderHTML: (attributes) => ({ 'data-list': attributes.kind }),
      },
      indent: {
        default: 0,
        parseHTML: (element) => {
          const own = element.getAttribute('data-indent');
          if (own !== null) return Math.max(0, Math.min(MAX_INDENT, Number.parseInt(own, 10) || 0));
          // Pasted nested HTML lists: depth = number of enclosing <ul>/<ol> minus one.
          let depth = -1;
          for (let el = element.parentElement; el; el = el.parentElement) {
            if (el.tagName === 'UL' || el.tagName === 'OL') depth += 1;
          }
          return Math.max(0, Math.min(MAX_INDENT, depth));
        },
        renderHTML: (attributes) => ({ 'data-indent': String(attributes.indent) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-list]' }, { tag: 'li' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes({ class: 'agentic-crm-note-list-item' }, HTMLAttributes),
      ['div', { class: 'agentic-crm-note-list-item-content' }, 0],
    ];
  },

  renderText({ node }) {
    return node.textContent;
  },

  addCommands() {
    return {
      setListItem:
        (kind) =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          const type = state.schema.nodes[LIST_ITEM];
          if (!type) return false;
          let changed = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isTextblock) return true;
            const indent = node.type.name === LIST_ITEM ? (node.attrs.indent as number) : 0;
            if (node.type === type && node.attrs.kind === kind) return false;
            tr.setNodeMarkup(pos, type, { kind, indent });
            changed = true;
            return false;
          });
          if (changed && dispatch) dispatch(tr);
          return changed;
        },
      toggleListItem:
        (kind) =>
        ({ state, commands }) => {
          const items = selectedListItems(state);
          const allOfKind = items.length > 0 && items.every((i) => i.node.attrs.kind === kind);
          return allOfKind ? commands.setNode('paragraph') : commands.setListItem(kind);
        },
      indentListItems:
        (delta) =>
        ({ state, tr, dispatch }) => {
          const items = selectedListItems(state);
          if (items.length === 0) return false;
          const changed = changeIndent(tr, items, delta);
          if (changed && dispatch) dispatch(tr);
          return true;
        },
    };
  },

  addInputRules() {
    const type = this.type;
    return [
      textblockTypeInputRule({ find: /^\s*([-+*])\s$/, type, getAttributes: { kind: 'ul', indent: 0 } }),
      textblockTypeInputRule({ find: /^(\d+)\.\s$/, type, getAttributes: { kind: 'ol', indent: 0 } }),
    ];
  },

  addKeyboardShortcuts() {
    const name = this.name;
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        const node = $from.parent;
        if (node.type.name !== name) return false;
        if (empty && node.content.size === 0) {
          // Empty item: outdent one level, or leave the list at level 0.
          const indent = node.attrs.indent as number;
          if (indent > 0) return editor.commands.updateAttributes(name, { indent: indent - 1 });
          return editor.commands.setNode('paragraph');
        }
        return editor
          .chain()
          .command(({ tr }) => {
            if (!tr.selection.empty) tr.deleteSelection();
            const pos = tr.selection.from;
            const marks = tr.storedMarks ?? tr.selection.$from.marks();
            tr.split(pos, 1, [{ type: node.type, attrs: { kind: node.attrs.kind, indent: node.attrs.indent } }]);
            if (marks.length > 0) tr.ensureMarks(marks);
            tr.scrollIntoView();
            return true;
          })
          .run();
      },
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        const node = $from.parent;
        if (node.type.name !== name || !empty || $from.parentOffset !== 0) return false;
        const indent = node.attrs.indent as number;
        if (indent > 0) return editor.commands.updateAttributes(name, { indent: indent - 1 });
        return editor.commands.setNode('paragraph');
      },
      Tab: ({ editor }) => {
        const { state } = editor;
        const items = selectedListItems(state);
        const { $from, $to, empty } = state.selection;
        const multiBlock = !$from.sameParent($to);
        const atItemStart = empty && $from.parent.type.name === name && $from.parentOffset === 0;
        if (items.length > 0 && (multiBlock || atItemStart)) return editor.commands.indentListItems(1);
        if (!editor.isEditable) return false;
        return editor.commands.insertContent('\t');
      },
      'Shift-Tab': ({ editor }) => {
        if (selectedListItems(editor.state).length === 0) return true; // keep focus in the editor
        return editor.commands.indentListItems(-1);
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: numberingKey,
        state: {
          init: (_config, state) => numberDecorations(state.doc),
          apply: (tr, value, _old, state) => (tr.docChanged ? numberDecorations(state.doc) : value),
        },
        props: {
          decorations: (state) => numberingKey.getState(state),
        },
      }),
    ];
  },
});

/** Places the caret at the end of `pos`'s textblock (used after converting blocks from menus). */
export function caretToEnd(tr: Transaction, pos: number): Transaction {
  const $pos = tr.doc.resolve(pos);
  return tr.setSelection(TextSelection.create(tr.doc, $pos.end()));
}
