// React host of the CodeMirror editor used by the formula sheet (mode `formula`: language, line numbers, popups),
// the read-only formula preview of the attribute dialog, and the AI autofill prompt (mode `prompt`: plain text with
// variable chips). Uncontrolled: the parent reads the document through `onChange` and drives it through the handle.
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import { Compartment, EditorSelection, EditorState, type Extension, Prec } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder as placeholderExt } from '@codemirror/view';
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';
import type { ErrorRange } from '../model/diagnostics';
import type { EditorDoc } from '../model/source';
import {
  addTokens,
  type ChipResolver,
  chipExtensions,
  chipResolver,
  insertDoc,
  setErrors,
  setHighlight,
  tokenField,
} from './chips';
import {
  type AttributeOptionsProvider,
  attributeOptions,
  formulaCompletion,
  insertFunction,
  insertVariable,
  startVariable,
} from './completion';
import * as s from './editor.css';
import { formulaSupport } from './language';

/** Keyboard bridge to the helper panel: ArrowUp / ArrowDown / Enter while it is filtered by the editor (§4.3). */
export interface HelperKeys {
  move(delta: 1 | -1): boolean;
  enter(): boolean;
}

export interface EditorUpdate {
  doc: EditorDoc;
  cursor: number;
  selection: { from: number; to: number };
  undoDepth: number;
  redoDepth: number;
  focused: boolean;
}

export interface CodeEditorHandle {
  view(): EditorView | null;
  doc(): EditorDoc;
  /** Replaces the whole document (AI result: `highlight` marks the new text). */
  replaceDoc(doc: EditorDoc, options?: { highlight?: boolean }): void;
  insertDoc(doc: EditorDoc, options?: { from?: number; to?: number; cursorOffset?: number }): void;
  insertVariable(
    path: { entityDefinitionId: string; attributeDefinitionId: string }[],
    from?: number,
    to?: number,
    field?: string | null,
  ): void;
  insertFunction(name: string, from?: number, to?: number): void;
  /** "Add variable": `{` + picker. */
  startVariable(): void;
  focus(): void;
  undo(): void;
  redo(): void;
}

export interface CodeEditorProps {
  mode: 'formula' | 'prompt';
  initial: EditorDoc;
  resolveChip: ChipResolver;
  attributeOptions?: AttributeOptionsProvider;
  errors?: ErrorRange[] | null;
  readOnly?: boolean;
  /** Function / attribute popups (the formula sheet turns them off while the helper panel is open). */
  popups?: boolean;
  lineNumbers?: boolean;
  placeholder?: string;
  helperKeys?: { current: HelperKeys | null };
  onChange?: (update: EditorUpdate) => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
  className?: string;
  ariaLabel?: string;
  ref?: Ref<CodeEditorHandle>;
}

const docOf = (state: EditorState): EditorDoc => ({
  text: state.doc.toString(),
  tokens: new Map(state.field(tokenField)),
});

export function CodeEditor(props: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const compartments = useRef({
    resolver: new Compartment(),
    options: new Compartment(),
    popups: new Compartment(),
    readOnly: new Compartment(),
    gutter: new Compartment(),
    placeholder: new Compartment(),
  });

  useEffect(() => {
    const c = compartments.current;
    const p = latest.current;
    const report = (view: EditorView) => {
      const state = view.state;
      const main = state.selection.main;
      latest.current.onChange?.({
        doc: docOf(state),
        cursor: main.head,
        selection: { from: main.from, to: main.to },
        undoDepth: undoDepth(state),
        redoDepth: redoDepth(state),
        focused: view.hasFocus,
      });
    };
    const helperKeymap = Prec.highest(
      keymap.of([
        { key: 'ArrowDown', run: () => latest.current.helperKeys?.current?.move(1) ?? false },
        { key: 'ArrowUp', run: () => latest.current.helperKeys?.current?.move(-1) ?? false },
        { key: 'Enter', run: () => latest.current.helperKeys?.current?.enter() ?? false },
        {
          key: 'Mod-Enter',
          run: () => {
            if (!latest.current.onSubmit) return false;
            latest.current.onSubmit();
            return true;
          },
        },
      ]),
    );
    const extensions: Extension[] = [
      helperKeymap,
      history(),
      chipExtensions(),
      c.resolver.of(chipResolver.of(p.resolveChip)),
      c.options.of(attributeOptions.of(p.attributeOptions ?? (() => []))),
      c.readOnly.of(readOnlyExt(Boolean(p.readOnly))),
      c.placeholder.of(p.placeholder ? placeholderExt(p.placeholder) : []),
      EditorView.lineWrapping,
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.focusChanged ||
          u.transactions.some((t) => t.effects.some((e) => e.is(addTokens)))
        )
          report(u.view);
      }),
      EditorView.contentAttributes.of({ 'aria-label': p.ariaLabel ?? 'Formula', 'data-testid': `${p.mode}-editor` }),
    ];
    if (p.mode === 'formula') {
      extensions.push(
        formulaSupport(),
        closeBrackets(),
        c.gutter.of(p.lineNumbers === false ? [] : lineNumbers()),
        c.popups.of(p.popups ? formulaCompletion() : []),
      );
    } else {
      extensions.push(c.popups.of(p.popups ? formulaCompletion() : []));
    }
    const state = EditorState.create({ doc: p.initial.text, extensions });
    const view = new EditorView({ state, parent: host.current as HTMLDivElement });
    view.dispatch({ effects: addTokens.of(p.initial.tokens) });
    viewRef.current = view;
    if (p.autoFocus) {
      view.focus();
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.resolver.reconfigure(chipResolver.of(props.resolveChip)),
    });
  }, [props.resolveChip]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.options.reconfigure(attributeOptions.of(props.attributeOptions ?? (() => []))),
    });
  }, [props.attributeOptions]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.popups.reconfigure(props.popups ? formulaCompletion() : []),
    });
  }, [props.popups]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.readOnly.reconfigure(readOnlyExt(Boolean(props.readOnly))),
    });
  }, [props.readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.placeholder.reconfigure(props.placeholder ? placeholderExt(props.placeholder) : []),
    });
  }, [props.placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setErrors.of(props.errors ?? []) });
  }, [props.errors]);

  useImperativeHandle(
    props.ref,
    (): CodeEditorHandle => ({
      view: () => viewRef.current,
      doc: () => (viewRef.current ? docOf(viewRef.current.state) : { text: '', tokens: new Map() }),
      replaceDoc(doc, options) {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: doc.text },
          selection: EditorSelection.cursor(doc.text.length),
          effects: addTokens.of(doc.tokens),
          userEvent: 'input.replace',
        });
        if (options?.highlight) view.dispatch({ effects: setHighlight.of({ from: 0, to: doc.text.length }) });
      },
      insertDoc(doc, options) {
        const view = viewRef.current;
        if (view) insertDoc(view, doc, options);
        view?.focus();
      },
      insertVariable(path, from, to, field) {
        const view = viewRef.current;
        if (!view) return;
        const sel = view.state.selection.main;
        insertVariable(view, path, from ?? sel.from, to ?? sel.to, field ?? null);
        view.focus();
      },
      insertFunction(name, from, to) {
        const view = viewRef.current;
        if (!view) return;
        const sel = view.state.selection.main;
        insertFunction(view, name, from ?? sel.from, to ?? sel.to);
        view.focus();
      },
      startVariable() {
        const view = viewRef.current;
        if (view) startVariable(view, Boolean(latest.current.popups));
      },
      focus() {
        viewRef.current?.focus();
      },
      undo() {
        const view = viewRef.current;
        if (view) undo(view);
      },
      redo() {
        const view = viewRef.current;
        if (view) redo(view);
      },
    }),
    [],
  );

  return (
    <div
      ref={host}
      className={`${s.root} ${props.mode === 'prompt' ? s.prompt : s.formula} ${props.className ?? ''}`}
      onPointerDown={(e) => {
        // Clicking empty space focuses the editor with the cursor at the end (§4.4).
        const view = viewRef.current;
        if (!view || e.target !== e.currentTarget || props.readOnly) return;
        e.preventDefault();
        view.focus();
        view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
      }}
    />
  );
}

function readOnlyExt(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}
