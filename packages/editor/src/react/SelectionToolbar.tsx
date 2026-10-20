// Floating selection toolbar (E editor.md §4): appears above a mouse selection (not for keyboard-only selections),
// starting at the selection's left edge (the curated crops show it start-aligned). Groups: block type | text colour, highlight | link | bold, italic, strikethrough (no underline).
// Sub-pickers replace the toolbar content in place with a ‹ back button.
import { useThemeClassName } from '@agentic-crm/ui';
import { colorTokens } from '@agentic-crm/ui/tokens';
import { autoUpdate, FloatingPortal, flip, offset, shift, useFloating } from '@floating-ui/react';
import { type Editor, getMarkRange, posToDOMRect } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  ChevronLeft,
  CornerDownLeft,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Strikethrough,
  Type,
} from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HIGHLIGHT_COLORS, hueOfColorKey, TEXT_COLORS } from '../model/colors.ts';
import * as s from './menus.css.ts';

type Mode = 'main' | 'block' | 'color' | 'highlight' | 'link';

export type BlockKind = 'body' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol';

/** What a toolbar offers; the note editor shows everything, email editors a subset (F composer §2.5). */
export interface ToolbarOptions {
  /** Block types of the "Body ▾" picker (default: all six). */
  blocks?: readonly BlockKind[];
  /** Text colours after "default" (default: the note palette). */
  colors?: readonly string[];
  /** Offer the highlight picker (default true). */
  highlight?: boolean;
  /** Where the bar sits relative to the selection (notes: above; the email composer: below). */
  placement?: 'top-start' | 'bottom-start';
}

const BLOCK_LABEL: Record<BlockKind, string> = {
  body: 'Body',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  ul: 'Bulleted list',
  ol: 'Numbered list',
};

/** Block picker order as observed: Body, Numbered list, Bulleted list, Heading 1–3. */
const BLOCK_OPTIONS: Array<{ kind: BlockKind; icon: LucideIcon }> = [
  { kind: 'body', icon: Type },
  { kind: 'ol', icon: ListOrdered },
  { kind: 'ul', icon: List },
  { kind: 'h1', icon: Heading1 },
  { kind: 'h2', icon: Heading2 },
  { kind: 'h3', icon: Heading3 },
];

const surface = colorTokens.light.utilities.surface as Record<string, string>;
/** Swatch fill of a colour key: the bold surface colour (default text = near-black content.primary). */
function swatchColor(key: string | null): string {
  if (!key) return colorTokens.light.content.primary;
  return surface[hueOfColorKey(key)] ?? colorTokens.light.content.primary;
}

function currentBlock(editor: Editor): BlockKind {
  const node = editor.state.selection.$from.parent;
  if (node.type.name === 'heading') return `h${node.attrs.level}` as BlockKind;
  if (node.type.name === 'listItem') return node.attrs.kind === 'ol' ? 'ol' : 'ul';
  return 'body';
}

/** `example.com` → `http://example.com`; null when it is not a usable URL. */
export function normalizeUrl(input: string): string | null {
  const value = input.trim();
  if (value === '' || /\s/.test(value)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') return withScheme;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return withScheme;
  } catch {
    return null;
  }
}

function ToolbarButton({
  label,
  pressed,
  onPress,
  children,
  variant = 'icon',
  testId,
}: {
  label: string;
  pressed?: boolean;
  onPress: () => void;
  children: ReactNode;
  variant?: 'icon' | 'text' | 'swatch';
  testId?: string;
}) {
  const cls = variant === 'icon' ? s.toolbarIconButton : variant === 'swatch' ? s.swatchButton : s.toolbarButton;
  return (
    <button
      type="button"
      className={cls}
      aria-label={label}
      title={variant === 'text' ? undefined : label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      data-testid={testId}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

function Back({ onPress }: { onPress: () => void }) {
  return (
    <ToolbarButton label="Back" onPress={onPress}>
      <ChevronLeft size={16} strokeWidth={1.5} />
    </ToolbarButton>
  );
}

export interface SelectionToolbarProps {
  editor: Editor;
  options?: ToolbarOptions;
  /** Set by the editor when a selection was made with the pointer (Attio shows no toolbar for keyboard selections). */
  pointerSelection: boolean;
  onDismiss: () => void;
  /** Opens directly in link mode (from the link popover's Edit). */
  initialMode?: Mode;
}

export function SelectionToolbar({
  editor,
  options,
  pointerSelection,
  onDismiss,
  initialMode = 'main',
}: SelectionToolbarProps) {
  const blockOptions = options?.blocks ? BLOCK_OPTIONS.filter((o) => options.blocks?.includes(o.kind)) : BLOCK_OPTIONS;
  const textColors = options?.colors ?? TEXT_COLORS;
  const withHighlight = options?.highlight ?? true;
  const [mode, setMode] = useState<Mode>(initialMode);
  const [href, setHref] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const { selection } = e.state;
      const textSelection = selection instanceof TextSelection && !selection.empty;
      return {
        from: selection.from,
        to: selection.to,
        visible: e.isEditable && textSelection,
        block: currentBlock(e),
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        link: e.isActive('link'),
        linkHref: (e.getAttributes('link').href as string | undefined) ?? '',
        color: (e.getAttributes('textColor').color as string | undefined) ?? null,
        highlight: (e.getAttributes('highlight').color as string | undefined) ?? null,
      };
    },
  });

  const visible = Boolean(state?.visible) && (pointerSelection || mode !== 'main' || initialMode !== 'main');

  useEffect(() => {
    if (!visible) {
      setMode(initialMode);
      setError(null);
    }
  }, [visible, initialMode]);

  useEffect(() => {
    if (mode === 'link') {
      setHref(state?.linkHref ?? '');
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [mode, state?.linkHref]);

  const { refs, floatingStyles } = useFloating({
    // Start-aligned with the selection (note-toolbar-text-color.png / -highlight.png: the bar starts at the word).
    placement: options?.placement ?? 'top-start',
    strategy: 'fixed',
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { setReference } = refs;
  const from = state?.from ?? 0;
  const to = state?.to ?? 0;
  useLayoutEffect(() => {
    if (!visible) return;
    // Virtual reference: the selection's bounding box (re-read on every autoUpdate tick).
    setReference({
      getBoundingClientRect: () => posToDOMRect(editor.view, from, to),
      contextElement: editor.view.dom,
    });
  }, [editor, from, to, visible, setReference]);

  if (!visible || !state) return null;

  const chain = () => editor.chain().focus();

  const saveLink = () => {
    const normalized = normalizeUrl(href);
    if (!normalized) {
      setError('Enter a valid URL');
      return;
    }
    let c = chain();
    if (state.link && editor.state.selection.empty) {
      const range = getMarkRange(editor.state.selection.$from, editor.schema.marks.link as never);
      if (range) c = c.setTextSelection(range);
    }
    c.extendMarkRange('link').setLink({ href: normalized }).run();
    setMode('main');
  };

  const onLinkKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveLink();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setMode('main');
      editor.commands.focus();
    }
  };

  let body: ReactNode;
  if (mode === 'block') {
    body = (
      <>
        <Back onPress={() => setMode('main')} />
        {blockOptions.map(({ kind, icon: Icon }) => (
          <ToolbarButton
            key={kind}
            label={BLOCK_LABEL[kind]}
            pressed={state.block === kind}
            onPress={() => {
              const c = chain();
              if (kind === 'body') c.setNode('paragraph').run();
              else if (kind === 'ul' || kind === 'ol') c.setListItem(kind).run();
              else c.setNode('heading', { level: Number(kind.slice(1)) }).run();
              setMode('main');
            }}
          >
            <Icon size={16} strokeWidth={1.5} />
          </ToolbarButton>
        ))}
      </>
    );
  } else if (mode === 'color' || mode === 'highlight') {
    const isColor = mode === 'color';
    const keys: Array<string | null> = [null, ...(isColor ? textColors : HIGHLIGHT_COLORS)];
    const current = isColor ? state.color : state.highlight;
    body = (
      <>
        <Back onPress={() => setMode('main')} />
        {keys.map((key) => (
          <ToolbarButton
            key={key ?? 'none'}
            variant="swatch"
            label={key ? key.replace(/^(block|pastel)_/, '').replace('-', ' ') : isColor ? 'Default' : 'None'}
            pressed={current === key}
            testId={`swatch-${key ?? 'none'}`}
            onPress={() => {
              if (isColor) chain().setTextColor(key).run();
              else chain().setHighlight(key).run();
              setMode('main');
            }}
          >
            {!isColor && key === null ? (
              <span className={s.noneSwatch} />
            ) : (
              <span className={s.swatch} style={{ backgroundColor: swatchColor(key) }} />
            )}
          </ToolbarButton>
        ))}
      </>
    );
  } else if (mode === 'link') {
    body = (
      <div className={s.linkForm}>
        <Back onPress={() => setMode('main')} />
        <input
          ref={inputRef}
          className={s.linkInput}
          placeholder="Enter URL..."
          aria-label="URL"
          value={href}
          onChange={(e) => {
            setHref(e.target.value);
            setError(null);
          }}
          onKeyDown={onLinkKey}
          aria-invalid={error ? true : undefined}
        />
        {error ? <span className={s.linkError}>{error}</span> : null}
        <ToolbarButton label="Save" onPress={saveLink}>
          <CornerDownLeft size={14} strokeWidth={1.5} />
        </ToolbarButton>
      </div>
    );
  } else {
    body = (
      <>
        <ToolbarButton
          variant="text"
          label={`Block type: ${BLOCK_LABEL[state.block]}`}
          onPress={() => setMode('block')}
        >
          {BLOCK_LABEL[state.block]}
        </ToolbarButton>
        <span className={s.toolbarDivider} />
        <ToolbarButton variant="text" label="Text colour" onPress={() => setMode('color')}>
          Text
          <span className={s.swatch} style={{ backgroundColor: swatchColor(state.color) }} />
        </ToolbarButton>
        {withHighlight && (
          <ToolbarButton variant="text" label="Highlight" onPress={() => setMode('highlight')}>
            Highlight
            {state.highlight ? (
              <span className={s.swatch} style={{ backgroundColor: swatchColor(state.highlight) }} />
            ) : (
              <span className={s.noneSwatch} />
            )}
          </ToolbarButton>
        )}
        <span className={s.toolbarDivider} />
        <ToolbarButton label="Link" pressed={state.link} onPress={() => setMode('link')}>
          <Link2 size={16} strokeWidth={1.5} />
        </ToolbarButton>
        <span className={s.toolbarDivider} />
        <ToolbarButton label="Bold" pressed={state.bold} onPress={() => chain().toggleBold().run()}>
          <Bold size={16} strokeWidth={1.5} />
        </ToolbarButton>
        <ToolbarButton label="Italic" pressed={state.italic} onPress={() => chain().toggleItalic().run()}>
          <Italic size={16} strokeWidth={1.5} />
        </ToolbarButton>
        <ToolbarButton label="Strikethrough" pressed={state.strike} onPress={() => chain().toggleStrike().run()}>
          <Strikethrough size={16} strokeWidth={1.5} />
        </ToolbarButton>
      </>
    );
  }

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className={`${themeClass} ${s.toolbar}`}
        role="toolbar"
        aria-label="Formatting"
        data-testid="selection-toolbar"
        data-mode={mode}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && mode !== 'link') {
            e.preventDefault();
            if (mode === 'main') onDismiss();
            else setMode('main');
          }
        }}
      >
        {body}
      </div>
    </FloatingPortal>
  );
}
