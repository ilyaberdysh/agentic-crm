// Email editors use a TipTap editor over the shared note schema without
// collaboration. Content goes in and out as flat blocks (the same model the server stores for drafts, templates and
// signatures), with placeholder variables (B.11) rendered as chips. Two flavours:
// <BlockEditor>  multi-line body: paragraphs, bulleted / numbered lists, bold / italic / strikethrough / link /
// text colour, the selection toolbar, variables via `{`
// <LineEditor> the single-line subject: text and variable chips only
// The variable menu and the "Variable settings" popover belong to the host (they need the recipient object's
// attributes); the editors report the caret position / the clicked chip and expose commands to change variables.
import { type AnyExtension, type Editor, getMarkRange } from '@tiptap/core';
import { Text } from '@tiptap/extension-text';
import { Dropcursor, Gapcursor, Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document as BaseDocument, Paragraph, Variable, type VariableAttributes } from '../extensions/nodes.ts';
import { schemaExtensions } from '../extensions/schema.ts';
import { type VariableClick, type VariableMenuRequest, VariableTrigger } from '../extensions/variable-trigger.ts';
import { type Block, isEmptyBlocks, textBlock, type VariableRef } from '../model/blocks.ts';
import { blocksToPmJson, pmJsonToBlocks } from '../model/pm.ts';
import { content as contentClass } from './content.css.ts';
import { LinkPopover, type LinkTarget } from './LinkPopover.tsx';
import { SelectionToolbar, type ToolbarOptions } from './SelectionToolbar.tsx';

export type { VariableClick, VariableMenuRequest } from '../extensions/variable-trigger.ts';
export type { ToolbarOptions } from './SelectionToolbar.tsx';

/** What a variable chip carries (the editor stores it as a `variable` node). */
export interface VariableInput {
  path: VariableRef['path'];
  field: VariableRef['field'];
  fallback: VariableRef['fallback'];
  /** Chip label ("Name › First"). */
  label: string;
}

export interface EmailEditorHandle {
  editor: Editor;
  focus(position?: 'start' | 'end'): void;
  hasFocus(): boolean;
  isEmpty(): boolean;
  getBlocks(): Block[];
  /** Replaces the whole content. */
  setBlocks(blocks: readonly Block[]): void;
  /** Appends blocks after the current content (a signature, a template). */
  appendBlocks(blocks: readonly Block[]): void;
  /** Inserts a variable at the caret, or in place of `replace` (the typed `{`). */
  insertVariable(variable: VariableInput, replace?: { from: number; to: number } | null): void;
  /** Types a `{` at the caret and reports it like the keyboard does (footer "Add variable"). */
  openVariableMenu(): void;
  /** Changes the attributes of the chip at `pos`. */
  updateVariable(pos: number, patch: Partial<VariableInput>): void;
  deleteVariable(pos: number): void;
}

export interface VariableHooks {
  onOpenMenu: (request: VariableMenuRequest) => void;
  onVariableClick: (click: VariableClick) => void;
}

interface CommonProps {
  /** Replacing the content: change this (switching drafts, applying a template). */
  resetKey?: string | number;
  onReady?: (handle: EmailEditorHandle) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  readOnly?: boolean;
  autofocus?: boolean | 'start' | 'end';
  ariaLabel?: string;
  testId?: string;
  className?: string;
  /** Static placeholder text. */
  placeholder?: string;
  variables?: VariableHooks;
}

export interface BlockEditorProps extends CommonProps {
  initialBlocks: readonly Block[];
  onChange?: (blocks: Block[], state: { isEmpty: boolean }) => void;
  /** Placeholder with markup (links) shown over an empty body instead of `placeholder`. */
  placeholderNode?: ReactNode;
  /** Selection toolbar subset; false = none. Default: Body / lists, grey text, link, B I S (email). */
  toolbar?: ToolbarOptions | false;
}

export const EMAIL_TOOLBAR: ToolbarOptions = {
  blocks: ['body', 'ol', 'ul'],
  colors: ['block_grey'],
  highlight: false,
  placement: 'bottom-start',
};

function snapshot(editor: Editor): Block[] {
  return pmJsonToBlocks(editor.getJSON());
}

function toAttrs(variable: VariableInput): VariableAttributes {
  return {
    path: JSON.stringify(variable.path),
    field: variable.field,
    fallback: variable.fallback,
    label: variable.label,
  };
}

function useHandle(editor: Editor | null, onReady: ((handle: EmailEditorHandle) => void) | undefined) {
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    if (!editor) return;
    const handle: EmailEditorHandle = {
      editor,
      focus: (position = 'end') => {
        editor.commands.focus(position);
      },
      hasFocus: () => editor.isFocused,
      isEmpty: () => isEmptyBlocks(snapshot(editor)),
      getBlocks: () => snapshot(editor),
      setBlocks: (blocks) => {
        editor.commands.setContent(blocksToPmJson(blocks), { emitUpdate: true });
      },
      appendBlocks: (blocks) => {
        const json = blocksToPmJson(blocks);
        const empty = isEmptyBlocks(snapshot(editor));
        if (empty) editor.commands.setContent(json, { emitUpdate: true });
        else editor.commands.insertContentAt(editor.state.doc.content.size, json.content ?? []);
      },
      insertVariable: (variable, replace) => {
        const chain = editor.chain().focus();
        const node = { type: 'variable', attrs: toAttrs(variable) };
        if (replace && replace.to <= editor.state.doc.content.size) chain.insertContentAt(replace, node).run();
        else chain.insertContent(node).run();
      },
      openVariableMenu: () => {
        // The trigger plugin reacts to typed text only: insert the brace as typing would.
        editor
          .chain()
          .focus()
          .command(({ view, state }) => {
            const { from, to } = state.selection;
            const insert = () => state.tr.insertText('{', from, to);
            if (view.someProp('handleTextInput', (f) => f(view, from, to, '{', insert))) return true;
            view.dispatch(insert());
            return true;
          })
          .run();
      },
      updateVariable: (pos, patch) => {
        const node = editor.state.doc.nodeAt(pos);
        if (!node || node.type.name !== 'variable') return;
        const next: VariableAttributes = {
          ...(node.attrs as VariableAttributes),
          ...(patch.path !== undefined ? { path: JSON.stringify(patch.path) } : {}),
          ...(patch.field !== undefined ? { field: patch.field } : {}),
          ...(patch.fallback !== undefined ? { fallback: patch.fallback } : {}),
          ...(patch.label !== undefined ? { label: patch.label } : {}),
        };
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, next));
      },
      deleteVariable: (pos) => {
        const node = editor.state.doc.nodeAt(pos);
        if (!node || node.type.name !== 'variable') return;
        editor
          .chain()
          .focus()
          .deleteRange({ from: pos, to: pos + node.nodeSize })
          .run();
      },
    };
    readyRef.current?.(handle);
  }, [editor]);
}

function useVariableTrigger(hooks: VariableHooks | undefined) {
  const ref = useRef(hooks);
  ref.current = hooks;
  return useMemo(
    () =>
      VariableTrigger.configure({
        onOpenMenu: (request) => ref.current?.onOpenMenu(request),
        onVariableClick: (click) => ref.current?.onVariableClick(click),
      }),
    [],
  );
}

/** Multi-line body editor. */
export function BlockEditor(props: BlockEditorProps) {
  const { initialBlocks, toolbar = EMAIL_TOOLBAR } = props;
  const propsRef = useRef(props);
  propsRef.current = props;
  const trigger = useVariableTrigger(props.variables);
  const [pointerSelection, setPointerSelection] = useState(false);
  const [toolbarMode, setToolbarMode] = useState<'main' | 'link'>('main');
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const [empty, setEmpty] = useState(() => isEmptyBlocks(initialBlocks));
  const editorRef = useRef<Editor | null>(null);

  const extensions = useMemo<AnyExtension[]>(
    () => [
      ...schemaExtensions,
      trigger,
      Placeholder.configure({
        placeholder: () => (propsRef.current.placeholderNode ? '' : (propsRef.current.placeholder ?? '')),
        showOnlyWhenEditable: false,
        showOnlyCurrent: false,
      }),
      Dropcursor.configure({ color: '#266df0', width: 2 }),
      Gapcursor,
    ],
    [trigger],
  );

  const editor = useEditor(
    {
      extensions,
      content: blocksToPmJson(initialBlocks),
      editable: !props.readOnly,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      onUpdate: ({ editor: e }) => {
        const blocks = snapshot(e);
        const isEmpty = isEmptyBlocks(blocks);
        setEmpty(isEmpty);
        propsRef.current.onChange?.(blocks, { isEmpty });
      },
      onFocus: () => propsRef.current.onFocus?.(),
      onBlur: ({ event }) => {
        const next = (event as FocusEvent).relatedTarget as HTMLElement | null;
        if (!next?.closest?.('[data-testid="selection-toolbar"]')) setPointerSelection(false);
        propsRef.current.onBlur?.();
      },
      editorProps: {
        attributes: {
          class: contentClass,
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': props.ariaLabel ?? 'Email body',
          'data-testid': props.testId ?? 'email-body-editor',
        },
        handleClick: (view, _pos, event) => {
          const anchor = (event.target as HTMLElement | null)?.closest?.(
            'a.agentic-crm-note-link',
          ) as HTMLAnchorElement | null;
          if (!anchor || !view.dom.contains(anchor)) return false;
          event.preventDefault();
          if (!view.state.selection.empty) return false;
          setLinkTarget({ href: anchor.getAttribute('href') ?? '', element: anchor });
          return false;
        },
        handleDOMEvents: {
          mousedown: () => {
            setPointerSelection(false);
            setToolbarMode('main');
            const onUp = () => {
              document.removeEventListener('mouseup', onUp, true);
              setTimeout(() => {
                const current = editorRef.current;
                if (current && !current.state.selection.empty) setPointerSelection(true);
              }, 0);
            };
            document.addEventListener('mouseup', onUp, true);
            return false;
          },
          keydown: (_view, event) => {
            if (event.shiftKey || event.key.startsWith('Arrow')) setPointerSelection(false);
            return false;
          },
        },
      },
    },
    [extensions],
  );
  editorRef.current = editor;

  useEffect(() => {
    if (editor && editor.isEditable === Boolean(props.readOnly)) editor.setEditable(!props.readOnly, false);
  }, [editor, props.readOnly]);

  // Replace the content when the host asks (resetKey changed), without echoing it back as a user edit.
  const lastReset = useRef(props.resetKey);
  useEffect(() => {
    if (!editor || lastReset.current === props.resetKey) return;
    lastReset.current = props.resetKey;
    editor.commands.setContent(blocksToPmJson(propsRef.current.initialBlocks), { emitUpdate: false });
    setEmpty(isEmptyBlocks(propsRef.current.initialBlocks));
  }, [editor, props.resetKey]);

  useHandle(editor, props.onReady);

  const autofocused = useRef(false);
  useEffect(() => {
    const autofocus = propsRef.current.autofocus;
    if (!editor || !autofocus || autofocused.current) return;
    autofocused.current = true;
    editor.commands.focus(autofocus === 'start' ? 'start' : 'end');
  }, [editor]);

  const withRange = useCallback(
    (fn: (e: Editor, range: { from: number; to: number } | null) => void) => {
      const current = editorRef.current;
      const target = linkTarget;
      setLinkTarget(null);
      if (!current || !target) return;
      const pos = current.view.posAtDOM(target.element, 0);
      fn(current, getMarkRange(current.state.doc.resolve(pos), current.schema.marks.link as never) ?? null);
    },
    [linkTarget],
  );
  const editLink = () =>
    withRange((e, range) => {
      if (range) e.chain().focus().setTextSelection(range).run();
      setToolbarMode('link');
      setPointerSelection(true);
    });
  const unlink = () =>
    withRange((e, range) => {
      if (range) e.chain().focus().setTextSelection(range).unsetLink().run();
    });

  return (
    <div
      className={props.className}
      data-editor-state={props.readOnly ? 'read-only' : 'editable'}
      style={{ position: 'relative' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && editor?.isEditable) {
          event.preventDefault();
          editor.commands.focus('end');
        }
      }}
    >
      <EditorContent editor={editor} />
      {empty && props.placeholderNode && !props.readOnly ? (
        <div
          data-testid="email-body-placeholder"
          style={{
            position: 'absolute',
            inset: 0,
            height: 24,
            pointerEvents: 'none',
            font: 'inherit',
            color: 'var(--ar-color-content-tertiary)',
          }}
        >
          {props.placeholderNode}
        </div>
      ) : null}
      {editor && toolbar !== false ? (
        <>
          <SelectionToolbar
            key={toolbarMode}
            editor={editor}
            options={toolbar}
            pointerSelection={pointerSelection}
            initialMode={toolbarMode}
            onDismiss={() => {
              setPointerSelection(false);
              setToolbarMode('main');
            }}
          />
          {linkTarget ? (
            <LinkPopover
              target={linkTarget}
              editable={!props.readOnly}
              onClose={() => setLinkTarget(null)}
              onEdit={editLink}
              onUnlink={unlink}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ---- single line (subject) ----------------------------------------------------------------------------------

/** Text with variables: what a draft's subject stores (`text` holds one `_` per variable). */
export interface LineValue {
  text: string;
  variables: VariableRef[];
}

export interface LineEditorProps extends CommonProps {
  initial: LineValue;
  onChange?: (value: LineValue, state: { isEmpty: boolean }) => void;
  /** Enter pressed (the composer moves on to the body). */
  onEnter?: () => void;
}

const LineDocument = BaseDocument.extend({ content: 'paragraph' });
const lineExtensions: AnyExtension[] = [LineDocument, Paragraph, Text, Variable];

function lineToPm(value: LineValue) {
  return blocksToPmJson([{ ...textBlock('unstyled', value.text.replace(/\n/g, ' ')), variables: value.variables }]);
}

function lineOf(editor: Editor): LineValue {
  const block = snapshot(editor)[0];
  return block ? { text: block.text, variables: block.variables ?? [] } : { text: '', variables: [] };
}

export function LineEditor(props: LineEditorProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const trigger = useVariableTrigger(props.variables);
  const extensions = useMemo<AnyExtension[]>(
    () => [
      ...lineExtensions,
      trigger,
      Placeholder.configure({
        placeholder: () => propsRef.current.placeholder ?? '',
        showOnlyWhenEditable: false,
        showOnlyCurrent: false,
      }),
    ],
    [trigger],
  );
  const editor = useEditor(
    {
      extensions,
      content: lineToPm(props.initial),
      editable: !props.readOnly,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      onUpdate: ({ editor: e }) => {
        const value = lineOf(e);
        propsRef.current.onChange?.(value, { isEmpty: value.text.trim() === '' });
      },
      onFocus: () => propsRef.current.onFocus?.(),
      onBlur: () => propsRef.current.onBlur?.(),
      editorProps: {
        attributes: {
          class: contentClass,
          role: 'textbox',
          'aria-label': props.ariaLabel ?? 'Subject',
          'data-testid': props.testId ?? 'email-subject-editor',
        },
        handleKeyDown: (_view, event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            propsRef.current.onEnter?.();
            return true;
          }
          return false;
        },
        // One line: pasted line breaks become spaces.
        transformPastedText: (text) => text.replace(/\s*\n+\s*/g, ' '),
      },
    },
    [extensions],
  );

  useEffect(() => {
    if (editor && editor.isEditable === Boolean(props.readOnly)) editor.setEditable(!props.readOnly, false);
  }, [editor, props.readOnly]);

  const lastReset = useRef(props.resetKey);
  useEffect(() => {
    if (!editor || lastReset.current === props.resetKey) return;
    lastReset.current = props.resetKey;
    editor.commands.setContent(lineToPm(propsRef.current.initial), { emitUpdate: false });
  }, [editor, props.resetKey]);

  useHandle(editor, props.onReady);

  const autofocused = useRef(false);
  useEffect(() => {
    const autofocus = propsRef.current.autofocus;
    if (!editor || !autofocus || autofocused.current) return;
    autofocused.current = true;
    editor.commands.focus(autofocus === 'start' ? 'start' : 'end');
  }, [editor]);

  return (
    <div className={props.className} data-editor-state={props.readOnly ? 'read-only' : 'editable'}>
      <EditorContent editor={editor} />
    </div>
  );
}
