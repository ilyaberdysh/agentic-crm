// Interaction of placeholder variables in the email editors (F composer §2.6): typing `{` asks the host to open the
// variable menu at the caret (the typed brace stays in the text until a variable replaces it), and clicking a chip
// asks the host to open "Variable settings". The menus themselves live in the host (they need the recipient object's
// attributes); the editor only reports where.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { VariableAttributes } from './nodes.ts';

export interface VariableMenuRequest {
  /** Document range of the typed `{` to replace with the chosen variable; null when the host asked without one. */
  replace: { from: number; to: number } | null;
  /** Viewport rectangle of the caret (re-read while the menu is open). */
  anchorRect: () => DOMRect;
}

export interface VariableClick {
  /** Document position of the variable node. */
  pos: number;
  attrs: VariableAttributes;
  element: HTMLElement;
}

export interface VariableTriggerOptions {
  /** Called after a `{` was typed. */
  onOpenMenu: (request: VariableMenuRequest) => void;
  /** Called when a chip was clicked. */
  onVariableClick: (click: VariableClick) => void;
}

const key = new PluginKey('agenticCrmVariableTrigger');

export const VariableTrigger = Extension.create<VariableTriggerOptions>({
  name: 'agenticCrmVariableTrigger',

  addOptions() {
    return { onOpenMenu: () => undefined, onVariableClick: () => undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key,
        props: {
          handleTextInput(view, from, to, text) {
            // The typed text ends with the brace (a browser may hand over a space with it: " {").
            if (!text.endsWith('{')) return false;
            // The text is inserted by ProseMirror after this handler returns false; report once it is in the doc.
            queueMicrotask(() => {
              const start = from + text.length - 1;
              const end = start + 1;
              if (view.isDestroyed || view.state.doc.textBetween(start, end, '\n', '\n') !== '{') return;
              options.onOpenMenu({
                replace: { from: start, to: end },
                anchorRect: () => {
                  const coords = view.coordsAtPos(Math.min(end, view.state.doc.content.size));
                  return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
                },
              });
            });
            return false;
          },
          handleClick(view, _pos, event) {
            const element = (event.target as HTMLElement | null)?.closest?.(
              '.agentic-crm-variable',
            ) as HTMLElement | null;
            if (!element || !view.dom.contains(element)) return false;
            // The position of the atom: where the DOM element starts (±1 depending on how the node renders).
            const at = view.posAtDOM(element, 0);
            const pos = [at, at - 1, at + 1].find((p) => view.state.doc.nodeAt(p)?.type.name === 'variable');
            if (pos === undefined) return false;
            const node = view.state.doc.nodeAt(pos);
            if (!node) return false;
            options.onVariableClick({ pos, attrs: node.attrs as VariableAttributes, element });
            return true;
          },
        },
      }),
    ];
  },
});
