// Slash menu and @-mention typeahead (E editor.md §5, §8) on @tiptap/suggestion. The plugin finds the trigger and
// the query; the React layer renders from a small store (no React inside ProseMirror plugins).
import { type Editor, Extension, type Range } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import { filterInsertItems, type InsertItem } from './insert-items.tsx';
import type { InsertItemId, MentionItem, MentionSearch } from './types.ts';

export type SuggestionKind = 'slash' | 'mention';

export interface SuggestionSnapshot {
  kind: SuggestionKind;
  items: Array<InsertItem | MentionItem>;
  index: number;
  query: string;
  clientRect: (() => DOMRect | null) | null;
  select: (item: InsertItem | MentionItem) => void;
}

/** External store read with useSyncExternalStore. */
export class SuggestionStore {
  private snapshot: SuggestionSnapshot | null = null;
  private readonly listeners = new Set<() => void>();

  get = (): SuggestionSnapshot | null => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(next: SuggestionSnapshot | null): void {
    this.snapshot = next;
    for (const l of this.listeners) l();
  }

  setIndex(index: number): void {
    if (!this.snapshot) return;
    this.set({ ...this.snapshot, index });
  }

  /** ↑/↓ move, Enter/Tab select, Esc closes (the plugin dismisses on Escape when we return false). */
  handleKey(event: KeyboardEvent): boolean {
    const s = this.snapshot;
    if (!s || s.items.length === 0) return false;
    if (event.key === 'ArrowDown') {
      this.setIndex((s.index + 1) % s.items.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      this.setIndex((s.index - 1 + s.items.length) % s.items.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const item = s.items[s.index];
      if (item) s.select(item);
      return true;
    }
    return false;
  }
}

/** Up to 10 per group, members ("Users") before records ("Records"). */
export function orderMentionItems(items: MentionItem[]): MentionItem[] {
  const members = items.filter((i) => i.kind === 'member').slice(0, 10);
  const records = items.filter((i) => i.kind === 'record').slice(0, 10);
  return [...members, ...records];
}

function renderer(store: SuggestionStore, kind: SuggestionKind) {
  return () => {
    const publish = (
      props: SuggestionProps<InsertItem | MentionItem, InsertItem | MentionItem>,
      keepIndex: boolean,
    ) => {
      const previous = store.get();
      const index =
        keepIndex && previous && previous.kind === kind
          ? Math.min(previous.index, Math.max(0, props.items.length - 1))
          : 0;
      store.set({
        kind,
        items: props.items,
        index,
        query: props.query,
        clientRect: props.clientRect ?? null,
        select: (item) => props.command(item),
      });
    };
    return {
      onStart: (props: SuggestionProps<InsertItem | MentionItem, InsertItem | MentionItem>) => publish(props, false),
      onUpdate: (props: SuggestionProps<InsertItem | MentionItem, InsertItem | MentionItem>) => {
        const previous = store.get();
        publish(props, previous?.query === props.query);
      },
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === 'Escape') {
          store.set(null);
          return false;
        }
        return store.handleKey(event);
      },
      onExit: () => {
        if (store.get()?.kind === kind) store.set(null);
      },
    };
  };
}

export const slashPluginKey = new PluginKey('agenticCrmSlashMenu');
export const mentionPluginKey = new PluginKey('agenticCrmMention');

export interface SlashOptions {
  store: SuggestionStore;
  available: () => InsertItemId[];
  run: (editor: Editor, id: InsertItemId) => void;
}

/** `/` at the start of an empty line opens the insert menu; the `/query` text is replaced by the block. */
export const SlashCommand = Extension.create<SlashOptions>({
  name: 'agenticCrmSlashCommand',

  addOptions() {
    return { store: new SuggestionStore(), available: () => [], run: () => {} };
  },

  addProseMirrorPlugins() {
    const { store, available, run } = this.options;
    return [
      Suggestion<InsertItem, InsertItem>({
        editor: this.editor,
        pluginKey: slashPluginKey,
        char: '/',
        startOfLine: true,
        allowSpaces: false,
        decorationTag: 'span',
        decorationClass: 'agentic-crm-slash-query',
        decorationContent: 'Find item (use ↑↓ to navigate)',
        decorationEmptyClass: 'is-empty',
        allow: ({ state, range }) => {
          // Only when the block holds nothing but the slash query.
          const $from = state.doc.resolve(range.from);
          return $from.parent.isTextblock && $from.parent.textContent === state.doc.textBetween(range.from, range.to);
        },
        items: ({ query }) => filterInsertItems(query, available()),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          run(editor, props.id);
        },
        render: renderer(store, 'slash') as never,
      }),
    ];
  },
});

export interface MentionOptions {
  store: SuggestionStore;
  search: () => MentionSearch | undefined;
}

const autoSpaceKey = new PluginKey<{ pos: number | null }>('agenticCrmMentionAutoSpace');

/** Inserts the mention token plus an automatic space (dropped again if the next typed character is punctuation). */
function insertMention(editor: Editor, range: Range, item: MentionItem): void {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      {
        type: 'mention',
        attrs: {
          kind: item.kind,
          id: item.id,
          entityDefinitionId: item.kind === 'record' ? item.entityDefinitionId : null,
          label: item.label,
        },
      },
      { type: 'text', text: ' ' },
    ])
    .command(({ tr }) => {
      tr.setMeta(autoSpaceKey, { pos: tr.selection.from });
      return true;
    })
    .run();
}

/** `@` (not right after a word character) opens the member + record typeahead. */
export const MentionSuggestion = Extension.create<MentionOptions>({
  name: 'agenticCrmMentionSuggestion',

  addOptions() {
    return { store: new SuggestionStore(), search: () => undefined };
  },

  addProseMirrorPlugins() {
    const { store, search } = this.options;
    return [
      Suggestion<MentionItem, MentionItem>({
        editor: this.editor,
        pluginKey: mentionPluginKey,
        char: '@',
        allowSpaces: true,
        allowedPrefixes: null,
        allow: ({ state, range }) => {
          if (!search()) return false;
          const $from = state.doc.resolve(range.from);
          const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, '', '￼');
          return !/[\p{L}\p{N}_]/u.test(before);
        },
        items: async ({ query, signal }) => {
          const fn = search();
          if (!fn) return [];
          try {
            return orderMentionItems(await fn(query, { signal }));
          } catch {
            return [];
          }
        },
        command: ({ editor, range, props }) => insertMention(editor, range, props),
        render: renderer(store, 'mention') as never,
      }),
      new Plugin<{ pos: number | null }>({
        key: autoSpaceKey,
        state: {
          init: () => ({ pos: null }),
          apply: (tr, value) => {
            const meta = tr.getMeta(autoSpaceKey) as { pos: number | null } | undefined;
            if (meta) return meta;
            return tr.docChanged || tr.selectionSet ? { pos: null } : value;
          },
        },
        props: {
          handleTextInput: (view, from, to, text) => {
            const pending = autoSpaceKey.getState(view.state)?.pos;
            if (pending === null || pending === undefined || from !== pending || to !== pending) return false;
            if (!/^[.,!?;:)\]}'"]/.test(text)) return false;
            if (view.state.doc.textBetween(from - 1, from) !== ' ') return false;
            const tr = view.state.tr.insertText(text, from - 1, from);
            tr.setSelection(TextSelection.create(tr.doc, from));
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
