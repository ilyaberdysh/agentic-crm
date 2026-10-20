// Inline marks of the note schema: bold, italic, strikethrough, text colour, highlight and link.
// No underline and no inline code: ⌘U is swallowed, and `**x**`, `*x*`, `_x_`, `~~x~~`, `` `x` `` stay literal
// while typing — only `[text](url)` converts (to a link). Strikethrough and link have no keyboard shortcut.

import { Extension, Mark } from '@tiptap/core';
import { Bold as TiptapBold } from '@tiptap/extension-bold';
import { Italic as TiptapItalic } from '@tiptap/extension-italic';
import { Link as TiptapLink } from '@tiptap/extension-link';
import { Strike as TiptapStrike } from '@tiptap/extension-strike';
import { isHighlightColor, isTextColor } from '../model/colors.ts';

export const Bold = TiptapBold.extend({
  addOptions() {
    return { ...this.parent?.(), HTMLAttributes: { class: 'agentic-crm-note-bold' } };
  },
  addInputRules() {
    return [];
  },
  addPasteRules() {
    return [];
  },
});

export const Italic = TiptapItalic.extend({
  addOptions() {
    return { ...this.parent?.(), HTMLAttributes: { class: 'agentic-crm-note-italic' } };
  },
  addInputRules() {
    return [];
  },
  addPasteRules() {
    return [];
  },
});

export const Strike = TiptapStrike.extend({
  addOptions() {
    return { ...this.parent?.(), HTMLAttributes: { class: 'agentic-crm-note-strikethrough' } };
  },
  addInputRules() {
    return [];
  },
  addPasteRules() {
    return [];
  },
  addKeyboardShortcuts() {
    return {};
  },
});

/**
 * Links: autolink on space/punctuation after a URL, `[text](url)` while typing, scheme-less URLs saved as http://,
 * opened in a new tab without referrer. Clicking a link in the editor opens the link popover (react layer) instead of
 * navigating.
 */
export const Link = TiptapLink.extend({
  inclusive: false,
}).configure({
  autolink: true,
  linkOnPaste: true,
  markdownLinks: true,
  openOnClick: false,
  enableClickSelection: false,
  defaultProtocol: 'http',
  HTMLAttributes: { class: 'agentic-crm-note-link', target: '_blank', rel: 'noreferrer noopener' },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      /** Applies a `block_*` text colour to the selection; null resets to the default colour. */
      setTextColor: (color: string | null) => ReturnType;
    };
    highlight: {
      /** Applies a `pastel_*` highlight to the selection; null removes it. */
      setHighlight: (color: string | null) => ReturnType;
    };
  }
}

/** Text colour (the UI COLORED style with a `block_*` key). */
export const TextColor = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-text-color');
          return isTextColor(value) ? value : null;
        },
        renderHTML: (attributes) => ({ 'data-text-color': attributes.color }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-text-color]',
        getAttrs: (element) => (isTextColor(element.getAttribute('data-text-color')) ? {} : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'agentic-crm-note-text-color' }, 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          color && isTextColor(color) ? commands.setMark(this.name, { color }) : commands.unsetMark(this.name),
    };
  },
});

/** Highlight (the UI HIGHLIGHTED style with a `pastel_*` key). */
export const Highlight = Mark.create({
  name: 'highlight',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute('data-highlight');
          return isHighlightColor(value) ? value : null;
        },
        renderHTML: (attributes) => ({ 'data-highlight': attributes.color }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-highlight]',
        getAttrs: (element) => (isHighlightColor(element.getAttribute('data-highlight')) ? {} : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'agentic-crm-note-highlight' }, 0];
  },

  addCommands() {
    return {
      setHighlight:
        (color) =>
        ({ commands }) =>
          color && isHighlightColor(color) ? commands.setMark(this.name, { color }) : commands.unsetMark(this.name),
    };
  },
});

/** The UI blocks ⌘U in notes and templates (no underline in the model); swallow it so the browser does not apply it. */
export const BlockedShortcuts = Extension.create({
  name: 'agenticCrmBlockedShortcuts',
  addKeyboardShortcuts() {
    return { 'Mod-u': () => true, 'Mod-U': () => true };
  },
});
