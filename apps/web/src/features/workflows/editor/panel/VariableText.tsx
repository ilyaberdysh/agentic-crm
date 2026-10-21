// Text inputs with inline variable chips (B.11; evidence G/G-variable-inline-brace.png,
// G-update-record-config.png): a contenteditable line (or box) holding text and atomic chips. Typing "{" opens the
// variable picker at the caret and the chosen variable replaces the brace; the label row's {x} button inserts at the
// caret (or at the end). Clicking a chip opens its settings (data sources, fallback, remove). Saved as rich text with
// one "_" placeholder per variable on blur and after every chip change.
import type { VariableExpr, WfType } from '@agentic-crm/contracts';
import { PopoverPanel } from '@agentic-crm/ui';
import { forwardRef, type RefObject, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Dialog } from 'react-aria-components';
import { useVariables } from '../../data';
import type { Segment } from '../../model/config';
import { chipLabel, type PickerData } from '../../model/variables';
import { useEditorUi } from '../EditorContext';
import * as s from './picker.css';
import { ChipSettings } from './VariableChip';
import { VariablePicker } from './VariablePicker';

export interface VariableTextHandle {
  /** Opens the picker anchored to `anchor` (the {x} button); the pick goes to the caret or the end. */
  openPicker: (anchor: Element) => void;
}

export interface VariableTextProps {
  blockId: string;
  value: Segment[];
  onCommit: (segments: Segment[]) => void;
  expected?: WfType;
  placeholder?: string;
  multiline?: boolean;
  invalid?: boolean;
  readOnly?: boolean;
  testId?: string;
}

let chipSeq = 0;

function sameSegments(a: readonly Segment[], b: readonly Segment[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const VariableText = forwardRef<VariableTextHandle, VariableTextProps>(function VariableText(
  { blockId, value, onCommit, expected, placeholder, multiline, invalid, readOnly, testId },
  handle,
) {
  const ui = useEditorUi();
  const data = useVariables(ui.page.workflowId, blockId, ui.viewingVersionId).data as PickerData | undefined;
  const el = useRef<HTMLDivElement>(null);
  const vars = useRef(new Map<string, VariableExpr>());
  const focused = useRef(false);
  const savedRange = useRef<Range | null>(null);
  const braceRange = useRef<Range | null>(null);
  const anchor = useRef<Element | null>(null);
  const caretAnchor = useRef<HTMLSpanElement>(null);
  const [picker, setPicker] = useState<{ mode: 'brace' | 'button'; x: number; y: number } | null>(null);
  const [chip, setChip] = useState<{ key: string; element: HTMLElement } | null>(null);
  const [empty, setEmpty] = useState(true);
  const last = useRef<Segment[]>(value);
  const pickerOpen = useRef(false);
  const chipOpen = useRef(false);
  pickerOpen.current = picker !== null;
  chipOpen.current = chip !== null;

  const chipNode = (key: string, variable: VariableExpr) => {
    const span = document.createElement('span');
    span.className = s.chip;
    span.contentEditable = 'false';
    span.dataset.chip = key;
    span.dataset.testid = 'variable-chip';
    const label = chipLabel(data, variable, ui.blockTitle);
    if (label.broken) span.dataset.broken = 'true';
    span.title = label.segments.join(' › ');
    const parts: Node[] = [];
    const brace = (t: string) => {
      const b = document.createElement('span');
      b.className = s.chipBrace;
      b.textContent = t;
      return b;
    };
    parts.push(brace('{'));
    label.shown.forEach((seg, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = s.chipSep;
        sep.textContent = '›';
        parts.push(sep);
      }
      const t = document.createElement('span');
      t.textContent = seg;
      parts.push(t);
    });
    parts.push(brace('}'));
    span.append(...parts);
    return span;
  };

  const render = (segments: readonly Segment[]) => {
    const root = el.current;
    if (!root) return;
    vars.current = new Map();
    root.replaceChildren();
    for (const seg of segments) {
      if (typeof seg === 'string') {
        root.append(document.createTextNode(multiline ? seg : seg.replace(/\n/g, ' ')));
      } else {
        const key = `c${++chipSeq}`;
        vars.current.set(key, seg);
        root.append(chipNode(key, seg));
      }
    }
    setEmpty(segments.every((x) => typeof x === 'string' && x === ''));
  };

  const read = (): Segment[] => {
    const out: Segment[] = [];
    const pushText = (t: string) => {
      if (!t) return;
      const prev = out[out.length - 1];
      if (typeof prev === 'string') out[out.length - 1] = prev + t;
      else out.push(t);
    };
    const walk = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) pushText((child.textContent ?? '').replace(/ /g, ' '));
        else if (child instanceof HTMLElement) {
          const key = child.dataset.chip;
          if (key) {
            const v = vars.current.get(key);
            if (v) out.push(v);
          } else if (child.tagName === 'BR') pushText('\n');
          else {
            if (child.tagName === 'DIV' && out.length > 0) pushText('\n');
            walk(child);
          }
        }
      }
    };
    if (el.current) walk(el.current);
    return out;
  };

  // The user is editing: typing, or choosing a variable in the picker (the editor is blurred then).
  const busy = () => focused.current || pickerOpen.current || chipOpen.current;

  // External value (server echo, other tab) re-renders unless the user is editing.
  useEffect(() => {
    if (busy()) return;
    last.current = value;
    render(value);
  }, [JSON.stringify(value)]);

  // Chip labels follow the picker data (block renamed, attribute loaded); only the chips are redrawn, so the text being
  // edited, the caret and a pending "{" stay where they are.
  useEffect(() => {
    for (const chipEl of Array.from(el.current?.querySelectorAll<HTMLElement>('[data-chip]') ?? [])) {
      const key = chipEl.dataset.chip as string;
      const v = vars.current.get(key);
      if (v) chipEl.replaceWith(chipNode(key, v));
    }
  }, [data]);

  const commit = () => {
    const segs = read();
    setEmpty(segs.length === 0);
    if (!sameSegments(segs, last.current)) {
      last.current = segs;
      onCommit(segs);
    }
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.current?.contains(sel.anchorNode))
      savedRange.current = sel.getRangeAt(0).cloneRange();
  };

  const insertVariable = (variable: VariableExpr) => {
    const root = el.current;
    if (!root) return;
    const key = `c${++chipSeq}`;
    vars.current.set(key, variable);
    const node = chipNode(key, variable);
    let range = braceRange.current ?? savedRange.current;
    if (range && !root.contains(range.startContainer)) range = null;
    if (range) {
      if (braceRange.current) {
        // Remove the typed "{".
        const r = braceRange.current;
        const start = Math.max(0, r.startOffset - 1);
        if (r.startContainer.nodeType === Node.TEXT_NODE && r.startContainer.textContent?.[start] === '{') {
          const del = document.createRange();
          del.setStart(r.startContainer, start);
          del.setEnd(r.startContainer, start + 1);
          del.deleteContents();
          range = document.createRange();
          range.setStart(r.startContainer, start);
          range.collapse(true);
        }
      }
      range.insertNode(node);
    } else root.append(node);
    const space = document.createTextNode('');
    node.after(space);
    const caret = document.createRange();
    caret.setStartAfter(node);
    caret.collapse(true);
    savedRange.current = caret;
    braceRange.current = null;
    commit();
  };

  useImperativeHandle(handle, () => ({
    openPicker(a: Element) {
      anchor.current = a;
      const r = a.getBoundingClientRect();
      braceRange.current = null;
      setPicker({ mode: 'button', x: r.left, y: r.bottom });
    },
  }));

  const chipVar = chip ? vars.current.get(chip.key) : undefined;
  const chipRef = useRef<Element | null>(null);
  chipRef.current = chip?.element ?? null;

  return (
    <>
      <div
        ref={el}
        className={`${s.editor} ${multiline ? s.multiline : ''}`}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline={multiline || undefined}
        aria-label={placeholder ?? 'Text'}
        tabIndex={readOnly ? -1 : 0}
        data-placeholder={placeholder ?? ''}
        data-empty={empty || undefined}
        data-invalid={invalid || undefined}
        data-readonly={readOnly || undefined}
        data-testid={testId ?? 'variable-text'}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          saveSelection();
          focused.current = false;
          if (!picker) commit();
        }}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onInput={(e) => {
          setEmpty((el.current?.textContent ?? '') === '' && vars.current.size === 0);
          const ev = e.nativeEvent as InputEvent;
          if (ev.inputType === 'insertText' && ev.data === '{') {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0).cloneRange();
            braceRange.current = range;
            const rect = range.getBoundingClientRect();
            const box = el.current?.getBoundingClientRect();
            setPicker({ mode: 'brace', x: rect.left || box?.left || 0, y: (rect.bottom || box?.bottom || 0) + 4 });
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !multiline) {
            e.preventDefault();
            (e.currentTarget as HTMLDivElement).blur();
          } else if (e.key === 'Enter' && multiline) {
            e.preventDefault();
            document.execCommand('insertText', false, '\n');
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const textData = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, multiline ? textData : textData.replace(/\n/g, ' '));
        }}
        onClick={(e) => {
          const target = (e.target as HTMLElement).closest<HTMLElement>('[data-chip]');
          if (target && !readOnly) setChip({ key: target.dataset.chip as string, element: target });
        }}
      />
      <span
        ref={caretAnchor}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: picker?.x ?? 0,
          top: picker?.y ?? 0,
          width: 1,
          height: 1,
          pointerEvents: 'none',
        }}
      />
      <PopoverPanel
        triggerRef={(picker?.mode === 'button' ? anchor : caretAnchor) as RefObject<Element>}
        isOpen={picker !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPicker(null);
            braceRange.current = null;
            commit();
          }
        }}
        placement="bottom end"
        padding={4}
      >
        <Dialog aria-label="Choose a variable" style={{ outline: 'none' }}>
          <VariablePicker
            blockId={blockId}
            expected={expected}
            onPick={(v) => {
              setPicker(null);
              insertVariable(v);
            }}
          />
        </Dialog>
      </PopoverPanel>
      {chip && chipVar && (
        <ChipSettings
          anchor={chipRef}
          isOpen
          onOpenChange={(open) => !open && setChip(null)}
          blockId={blockId}
          variable={chipVar}
          expected={expected}
          onChange={(next) => {
            vars.current.set(chip.key, next);
            const fresh = chipNode(chip.key, next);
            chip.element.replaceWith(fresh);
            setChip({ key: chip.key, element: fresh });
            commit();
          }}
          onRemove={() => {
            chip.element.remove();
            vars.current.delete(chip.key);
            setChip(null);
            commit();
          }}
        />
      )}
    </>
  );
});
