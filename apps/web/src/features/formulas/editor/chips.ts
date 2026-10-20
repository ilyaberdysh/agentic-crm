// Reference chips: every `_{id}` token of the editor text renders as an atomic pill
// `{ Parent › Child }` (one "character" for cursor movement and deletion). States: default, selected (inside the
// selection), error (covered by a diagnostic; the message shows on hover); an id missing from the token map reads
// "{Unknown variable}". The token map, the diagnostics and the AI-result highlight live in state fields here.
// Copy / cut of chips writes `{version:1, plaintext, annotations}`; pasting it restores the chips.
import type { FormulaAnnotation } from '@agentic-crm/formula';
import {
  EditorSelection,
  type EditorState,
  type Extension,
  Facet,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, hoverTooltip, WidgetType } from '@codemirror/view';
import { chipError, type ErrorRange, messageAt } from '../model/diagnostics';
import { clipboardText, loadSource, parseClipboard, tokensIn } from '../model/source';

// ---- token map -------------------------------------------------------------------------------------------------------

export const addTokens = StateEffect.define<ReadonlyMap<string, FormulaAnnotation>>();

/** Token id → annotation. Tokens are only added (ids are fresh UUIDs; stale entries are harmless). */
export const tokenField = StateField.define<Map<string, FormulaAnnotation>>({
  create: () => new Map(),
  update(value, tr) {
    let next = value;
    for (const e of tr.effects) {
      if (e.is(addTokens)) {
        if (next === value) next = new Map(value);
        for (const [k, v] of e.value) next.set(k, v);
      }
    }
    return next;
  },
});

// ---- chip labels -----------------------------------------------------------------------------------------------------

export interface ChipInfo {
  /** Hop titles ("Company", "Name"); null = unresolvable path ("Unknown variable"). */
  parts: string[] | null;
  /** Sub-field label shown in brackets. */
  field?: string | null;
}

export type ChipResolver = (annotation: FormulaAnnotation) => ChipInfo;

export const chipResolver = Facet.define<ChipResolver, ChipResolver>({
  combine: (values) => values[values.length - 1] ?? (() => ({ parts: null })),
});

// ---- diagnostics -----------------------------------------------------------------------------------------------------

export const setErrors = StateEffect.define<ErrorRange[]>();

/** Error ranges of the last check; cleared as soon as the text changes (diagnostics re-run 600 ms later). */
export const errorField = StateField.define<ErrorRange[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setErrors)) return e.value;
    return tr.docChanged ? [] : value;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (ranges) =>
      Decoration.set(
        ranges.map((r) => Decoration.mark({ class: 'cm-formula-error' }).range(r.from, r.to)),
        true,
      ),
    ),
});

/** Dark tooltip under an error range with its message ( "Error hover"). */
export const errorTooltip = hoverTooltip(
  (view, pos) => {
    const hit = messageAt(view.state.field(errorField), pos);
    if (!hit) return null;
    return {
      pos: hit.from,
      end: hit.to,
      above: false,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-formula-tooltip';
        dom.textContent = hit.message;
        return { dom };
      },
    };
  },
  { hoverTime: 150 },
);

// ---- AI result highlight -----------------------------------------------------------------------------------------------

export const setHighlight = StateEffect.define<{ from: number; to: number } | null>();

/** `cm-highlighted` over AI-generated text until the next edit. */
export const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlight)) {
        return e.value && e.value.to > e.value.from
          ? Decoration.set([Decoration.mark({ class: 'cm-highlighted' }).range(e.value.from, e.value.to)])
          : Decoration.none;
      }
    }
    return tr.docChanged ? Decoration.none : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- chip widgets ----------------------------------------------------------------------------------------------------

type ChipState = 'default' | 'selected' | 'error';

class ChipWidget extends WidgetType {
  constructor(
    readonly info: ChipInfo,
    readonly state: ChipState,
    readonly error: string | null,
  ) {
    super();
  }

  override eq(other: ChipWidget): boolean {
    return (
      other.state === this.state &&
      other.error === this.error &&
      JSON.stringify(other.info) === JSON.stringify(this.info)
    );
  }

  toDOM(): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'cm-formula-chip';
    chip.dataset.state = this.state;
    chip.setAttribute('data-testid', 'formula-chip');
    const brace = (text: string) => {
      const b = document.createElement('span');
      b.className = 'cm-formula-chip-brace';
      b.textContent = text;
      return b;
    };
    chip.append(brace('{'));
    const parts = this.info.parts ?? ['Unknown variable'];
    parts.forEach((part, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'cm-formula-chip-sep';
        sep.textContent = '›';
        chip.append(sep);
      }
      const label = document.createElement('span');
      label.className = 'cm-formula-chip-label';
      label.textContent = part;
      chip.append(label);
    });
    if (this.info.field) {
      const field = document.createElement('span');
      field.className = 'cm-formula-chip-field';
      field.textContent = `[${this.info.field}]`;
      chip.append(field);
    }
    chip.append(brace('}'));
    chip.setAttribute('aria-label', parts.join(' › '));
    if (this.error) chip.title = this.error;
    return chip;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function chipDecorations(state: EditorState): DecorationSet {
  const tokens = state.field(tokenField);
  const resolve = state.facet(chipResolver);
  const errors = state.field(errorField);
  const text = state.doc.toString();
  const decos: Range<Decoration>[] = [];
  for (const t of tokensIn(text)) {
    const annotation = tokens.get(t.id);
    const info: ChipInfo = annotation ? resolve(annotation) : { parts: null };
    const error = chipError(errors, t.from, t.to);
    const selected = state.selection.ranges.some((r) => !r.empty && r.from <= t.from && r.to >= t.to);
    const chipState: ChipState = error || !annotation || !info.parts ? 'error' : selected ? 'selected' : 'default';
    decos.push(Decoration.replace({ widget: new ChipWidget(info, chipState, error) }).range(t.from, t.to));
  }
  return Decoration.set(decos, true);
}

export const chipField = StateField.define<DecorationSet>({
  create: (state) => chipDecorations(state),
  update(value, tr) {
    const resolverChanged = tr.startState.facet(chipResolver) !== tr.state.facet(chipResolver);
    if (
      tr.docChanged ||
      tr.selection ||
      resolverChanged ||
      tr.effects.some((e) => e.is(addTokens) || e.is(setErrors))
    ) {
      return chipDecorations(tr.state);
    }
    return value;
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

// ---- clipboard -------------------------------------------------------------------------------------------------------

function selectedText(view: EditorView): string {
  return view.state.selection.ranges
    .filter((r) => !r.empty)
    .map((r) => view.state.sliceDoc(r.from, r.to))
    .join('\n');
}

const clipboard = EditorView.domEventHandlers({
  copy(event, view) {
    const slice = selectedText(view);
    if (!slice || tokensIn(slice).length === 0 || !event.clipboardData) return false;
    event.clipboardData.setData('text/plain', clipboardText(slice, view.state.field(tokenField)));
    event.preventDefault();
    return true;
  },
  cut(event, view) {
    const slice = selectedText(view);
    if (!slice || tokensIn(slice).length === 0 || !event.clipboardData || view.state.readOnly) return false;
    event.clipboardData.setData('text/plain', clipboardText(slice, view.state.field(tokenField)));
    event.preventDefault();
    view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete.cut' });
    return true;
  },
  paste(event, view) {
    const raw = event.clipboardData?.getData('text/plain') ?? '';
    const source = parseClipboard(raw);
    if (!source || view.state.readOnly) return false;
    event.preventDefault();
    insertDoc(view, loadSource(source));
    return true;
  },
});

/** Inserts editor text with its tokens at the selection (paste, helper examples). */
export function insertDoc(
  view: EditorView,
  doc: { text: string; tokens: ReadonlyMap<string, FormulaAnnotation> },
  options: { from?: number; to?: number; cursorOffset?: number } = {},
): void {
  const sel = view.state.selection.main;
  const from = options.from ?? sel.from;
  const to = options.to ?? sel.to;
  const anchor = from + (options.cursorOffset ?? doc.text.length);
  view.dispatch({
    changes: { from, to, insert: doc.text },
    selection: EditorSelection.cursor(anchor),
    effects: addTokens.of(doc.tokens),
    userEvent: 'input',
    scrollIntoView: true,
  });
}

export function chipExtensions(): Extension {
  return [tokenField, errorField, highlightField, chipField, errorTooltip, clipboard];
}
