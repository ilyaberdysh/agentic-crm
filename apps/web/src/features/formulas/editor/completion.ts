// Editor popups (formulas.md §4.4, shown only while the helper panel is collapsed): (a) function autocomplete —
// typing letters lists the functions whose name starts with the prefix (240 px list, `name()`, first row selected,
// Enter / Tab insert `name()` with the cursor inside); (b) attribute picker — `{` lists attributes (related objects
// as "Parent › Child"), picking inserts a chip. Pickers never open inside strings or comments.
import type { PathHop } from '@agentic-crm/contracts';
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from '@codemirror/autocomplete';
import { EditorSelection, type Extension, Facet } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { newId } from '../../../lib/ids';
import { functionMatches } from '../model/complete';
import { tokenText, variableAnnotation } from '../model/source';
import { addTokens } from './chips';
import { inStringOrComment } from './language';

export interface AttributeOption {
  /** "Name" or "Company › Name". */
  label: string;
  path: PathHop[];
  field?: string | null;
}

/** Attribute options for an attribute query (ranked by the provider). */
export type AttributeOptionsProvider = (query: string) => AttributeOption[];

export const attributeOptions = Facet.define<AttributeOptionsProvider, AttributeOptionsProvider>({
  combine: (values) => values[values.length - 1] ?? (() => []),
});

/** Replaces [from, to) with a chip for `path` (cursor after the chip). */
export function insertVariable(
  view: EditorView,
  path: PathHop[],
  from: number,
  to: number,
  field: string | null = null,
): void {
  const id = newId();
  const text = tokenText(id);
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length),
    effects: addTokens.of(new Map([[id, variableAnnotation(path, field)]])),
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
}

/** Inserts `name()` over [from, to) with the cursor between the parentheses. */
export function insertFunction(view: EditorView, name: string, from: number, to: number): void {
  const text = `${name}()`;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + text.length - 1),
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
}

function functionSource(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
  if (!word || word.from === word.to) return null;
  if (inStringOrComment(context.state, context.pos)) return null;
  const before = context.state.sliceDoc(Math.max(0, word.from - 1), word.from);
  if (before === '.' || before === '{' || /[0-9]/.test(word.text[0] as string)) return null;
  const names = functionMatches(word.text);
  if (names.length === 0) return null;
  return {
    from: word.from,
    to: word.to,
    filter: false,
    options: names.map(
      (name): Completion => ({
        label: `${name}()`,
        type: 'function',
        apply: (view, _c, from, to) => insertFunction(view, name, from, to),
      }),
    ),
  };
}

function attributeSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\{[^{}()",[\]\n]*/);
  if (!match) return null;
  if (match.from > 0 && context.state.sliceDoc(match.from - 1, match.from) === '_') return null;
  if (inStringOrComment(context.state, match.from + 1)) return null;
  const provider = context.state.facet(attributeOptions);
  const options = provider(match.text.slice(1));
  return {
    from: match.from,
    to: context.pos,
    filter: false,
    options: options.slice(0, 50).map(
      (o): Completion => ({
        label: o.label,
        type: 'variable',
        apply: (view, _c, from, to) => insertVariable(view, o.path, from, to, o.field ?? null),
      }),
    ),
  };
}

/** The popups; off (`[]`) while the helper panel is open. */
export function formulaCompletion(): Extension {
  return autocompletion({
    override: [attributeSource, functionSource],
    activateOnTyping: true,
    icons: false,
    closeOnBlur: true,
    maxRenderedOptions: 50,
    tooltipClass: () => 'cm-formula-completion',
    defaultKeymap: true,
  });
}

/** "Add variable": inserts `{` at the cursor and opens the attribute picker. */
export function startVariable(view: EditorView, withPopup: boolean): void {
  const sel = view.state.selection.main;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: '{' },
    selection: EditorSelection.cursor(sel.from + 1),
    userEvent: 'input.type',
  });
  view.focus();
  if (withPopup) startCompletion(view);
}
