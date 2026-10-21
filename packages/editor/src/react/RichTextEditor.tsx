// <RichTextEditor> — contract E1: TipTap + Yjs over a HocuspocusProvider connected to
// apps/collab, restricted to the note model, with the slash menu, mention typeahead, selection toolbar,
// link popover, images, placeholder, remote carets and presence data.
import { HocuspocusProvider } from '@hocuspocus/provider';
import { type AnyExtension, type Editor, Extension, getMarkRange } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { Text } from '@tiptap/extension-text';
import { Dropcursor, Gapcursor, Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { ListItem } from '../extensions/list-item.ts';
import { BlockedShortcuts, Bold, Highlight, Italic, Link, Strike, TextColor } from '../extensions/marks.ts';
import { Document, HardBreak, Heading, Mention, Paragraph } from '../extensions/nodes.ts';
import { DOCUMENT_FRAGMENT } from '../extensions/schema.ts';
import { type Block, isEmptyBlocks } from '../model/blocks.ts';
import type { CollabAwarenessUser, CollabDenyReason } from '../model/collab.ts';
import { presenceColor } from '../model/colors.ts';
import { blocksToPmJson, pmJsonToBlocks } from '../model/pm.ts';
import { content as contentClass } from './content.css.ts';
import { EditorImage } from './ImageView.tsx';
import { ImageUploads, imagePastePlugin, pickImageFile } from './images.ts';
import { INSERT_ITEMS, runInsertItem } from './insert-items.tsx';
import { LinkPopover, type LinkTarget } from './LinkPopover.tsx';
import { SelectionToolbar } from './SelectionToolbar.tsx';
import { SuggestionMenu } from './SuggestionMenu.tsx';
import { MentionSuggestion, SlashCommand, SuggestionStore } from './suggestions.ts';
import type { EditorHandle, EditorStatus, InsertItemId, PresenceUser, RichTextEditorProps } from './types.ts';

const DEFAULT_PLACEHOLDER: Record<RichTextEditorProps['docType'], string> = {
  note: 'Start typing your note',
  'note-template': 'Start typing...',
  'email-template': 'Start typing...',
  'insight-section': 'Start typing...',
};

interface Session {
  /** Distinguishes provider generations (React StrictMode mounts effects twice). */
  id: number;
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
}

let sessionCounter = 0;

/** Distinct users from awareness states (one entry per user, the current user first). */
export function presenceUsers(states: Map<number, Record<string, unknown>>, selfClientId: number): PresenceUser[] {
  const byUser = new Map<string, PresenceUser>();
  const ordered = [...states.entries()].sort(([a], [b]) => (a === selfClientId ? -1 : b === selfClientId ? 1 : a - b));
  for (const [clientId, state] of ordered) {
    const user = state?.user as Partial<CollabAwarenessUser> | undefined;
    if (!user?.id || !user.name) continue;
    const isSelf = clientId === selfClientId;
    const existing = byUser.get(user.id);
    if (existing) {
      if (isSelf) existing.isSelf = true;
      continue;
    }
    byUser.set(user.id, {
      id: user.id,
      memberId: user.memberId ?? '',
      name: user.name,
      color: user.color ?? presenceColor(user.memberId ?? user.id),
      avatarUrl: user.avatarUrl ?? null,
      isSelf,
    });
  }
  return [...byUser.values()];
}

export function RichTextEditor(props: RichTextEditorProps) {
  const { documentId, collabUrl, readOnly = false } = props;
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const url = readOnly ? withParam(collabUrl, 'readonly', 'true') : collabUrl;
    const provider = new HocuspocusProvider({ url, name: documentId, document: ydoc });
    setSession({ id: ++sessionCounter, ydoc, provider });
    return () => {
      provider.destroy();
      ydoc.destroy();
      setSession(null);
    };
  }, [documentId, collabUrl, readOnly]);

  if (!session) return <div className={`${contentClass} ${props.className ?? ''}`} aria-busy="true" />;
  // Keyed by session: the editor's extensions are bound to one Y.Doc / provider for their whole life.
  return <CollabEditor key={session.id} {...props} session={session} />;
}

function withParam(url: string, key: string, value: string): string {
  const u = new URL(url, typeof location !== 'undefined' ? location.href : 'http://localhost');
  u.searchParams.set(key, value);
  return u.toString();
}

function CollabEditor({ session, ...props }: RichTextEditorProps & { session: Session }) {
  const { provider, ydoc } = session;
  const propsRef = useRef(props);
  propsRef.current = props;
  const [synced, setSynced] = useState(false);
  const [scope, setScope] = useState<'read-write' | 'readonly' | null>(null);
  const [denied, setDenied] = useState<CollabDenyReason | null>(null);
  const [pointerSelection, setPointerSelection] = useState(false);
  const [toolbarMode, setToolbarMode] = useState<'main' | 'link'>('main');
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const suggestionStore = useMemo(() => new SuggestionStore(), []);
  const editorRef = useRef<Editor | null>(null);
  const uploads = useMemo(() => new ImageUploads(() => propsRef.current.uploadImage), []);
  useEffect(() => () => uploads.destroy(), [uploads]);

  const availableItems = useCallback(
    (): InsertItemId[] =>
      INSERT_ITEMS.map((i) => i.id).filter((id) => id !== 'image' || propsRef.current.uploadImage !== undefined),
    [],
  );
  const pickImage = useCallback(() => {
    pickImageFile((file) => {
      const editor = editorRef.current;
      if (editor) void uploads.insert(editor, file);
    });
  }, [uploads]);

  const user = props.user;
  const localUser = useMemo(
    () => ({
      id: user.id,
      memberId: user.memberId,
      name: user.name,
      color: presenceColor(user.memberId),
      avatarUrl: user.avatarUrl ?? null,
    }),
    [user.id, user.memberId, user.name, user.avatarUrl],
  );

  const extensions = useMemo<AnyExtension[]>(
    () => [
      Document,
      Paragraph,
      Text,
      Heading,
      ListItem,
      EditorImage.configure({
        uploads,
        resolveImageUrl: (assetId: string) => {
          const resolve = propsRef.current.resolveImageUrl;
          if (!resolve) throw new Error('no resolver');
          return resolve(assetId);
        },
      }),
      HardBreak,
      Mention,
      Bold,
      Italic,
      Strike,
      TextColor,
      Highlight,
      Link,
      BlockedShortcuts,
      Collaboration.configure({ document: ydoc, field: DOCUMENT_FRAGMENT }),
      CollaborationCaret.configure({
        provider,
        user: localUser,
        render: renderCaret,
        selectionRender: (u: Record<string, unknown>) => ({
          nodeName: 'span',
          class: 'collaboration-carets__selection',
          style: `background-color: ${String(u.color ?? '#266DF0')}40`,
          'data-user': String(u.name ?? ''),
        }),
      }),
      Placeholder.configure({
        placeholder: () => propsRef.current.placeholder ?? DEFAULT_PLACEHOLDER[propsRef.current.docType],
        showOnlyWhenEditable: false,
        showOnlyCurrent: false,
      }),
      Dropcursor.configure({ color: '#266df0', width: 2 }),
      Gapcursor,
      SlashCommand.configure({
        store: suggestionStore,
        available: availableItems,
        run: (editor, id) => runInsertItem(editor, id, pickImage),
      }),
      MentionSuggestion.configure({ store: suggestionStore, search: () => propsRef.current.mentionSearch }),
      Extension.create({
        name: 'agenticCrmImagePaste',
        addProseMirrorPlugins: () => [imagePastePlugin(() => editorRef.current, uploads)],
      }),
    ],
    // The session (ydoc/provider) is fixed for the lifetime of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editable = !props.readOnly && synced && scope === 'read-write' && !denied;

  const editor = useEditor(
    {
      extensions,
      editable: false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: contentClass,
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Note body',
          'data-testid': 'rich-text-editor',
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
            // The selection may end outside the editor: listen for the release on the document.
            const onUp = () => {
              document.removeEventListener('mouseup', onUp, true);
              // Read after ProseMirror took the browser's selection.
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
    if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, editable]);

  // Provider lifecycle → status, editability, presence.
  useEffect(() => {
    const report = (status: EditorStatus, detail?: { reason?: CollabDenyReason; readOnly?: boolean }) =>
      propsRef.current.onStatusChange?.(status, detail);
    const onStatus = ({ status }: { status: string }) => {
      if (status === 'connecting') report('connecting');
      else if (status === 'connected') report('connected');
      else if (status === 'disconnected') report('disconnected');
    };
    const onSynced = ({ state }: { state: boolean }) => {
      if (!state) return;
      setSynced(true);
      report('synced', { readOnly: provider.authorizedScope === 'readonly' });
    };
    const onAuthenticated = ({ scope: granted }: { scope: string }) => {
      setDenied(null);
      setScope(granted === 'readonly' ? 'readonly' : 'read-write');
    };
    const onFailed = ({ reason }: { reason: string }) => {
      const value = (
        ['unauthorized', 'forbidden', 'not-found'].includes(reason) ? reason : 'forbidden'
      ) as CollabDenyReason;
      setDenied(value);
      report('denied', { reason: value });
    };
    const awareness = provider.awareness;
    const onAwareness = () => {
      if (!awareness) return;
      propsRef.current.onAwarenessChange?.(
        presenceUsers(awareness.getStates() as Map<number, Record<string, unknown>>, awareness.clientID),
      );
    };
    provider.on('status', onStatus);
    provider.on('synced', onSynced);
    provider.on('authenticated', onAuthenticated);
    provider.on('authenticationFailed', onFailed);
    awareness?.on('change', onAwareness);
    if (provider.isSynced) onSynced({ state: true });
    if (provider.isAuthenticated) onAuthenticated({ scope: provider.authorizedScope ?? 'read-write' });
    onAwareness();
    return () => {
      provider.off('status', onStatus);
      provider.off('synced', onSynced);
      provider.off('authenticated', onAuthenticated);
      provider.off('authenticationFailed', onFailed);
      awareness?.off('change', onAwareness);
    };
  }, [provider]);

  // onChange (empty-state launchers): rAF-debounced over local and remote updates.
  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const onUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        propsRef.current.onChange?.({ isEmpty: isEmptyBlocks(pmJsonToBlocks(editor.getJSON())) });
      });
    };
    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor]);

  // Handle + autofocus once the first sync made the document editable.
  const readyFired = useRef(false);
  useEffect(() => {
    if (!editor || !synced || readyFired.current) return;
    readyFired.current = true;
    const handle: EditorHandle = {
      editor,
      provider,
      focus: (position = 'end') => {
        editor.commands.focus(position);
      },
      isEmpty: () => isEmptyBlocks(pmJsonToBlocks(editor.getJSON())),
      getBlocks: () => pmJsonToBlocks(editor.getJSON()),
      insertBlocks: (blocks: Block[]) => {
        const json = blocksToPmJson(blocks);
        const empty = isEmptyBlocks(pmJsonToBlocks(editor.getJSON()));
        if (empty) editor.commands.setContent(json, { emitUpdate: true });
        else editor.commands.insertContentAt(editor.state.doc.content.size, json.content ?? []);
      },
      runInsertItem: (id) => runInsertItem(editor, id, pickImage),
      insertItems: availableItems,
      isEditable: () => editor.isEditable,
    };
    propsRef.current.onReady?.(handle);
  }, [editor, synced, provider, pickImage, availableItems]);

  // Autofocus once the document is editable (after the first sync and the server's grant).
  const autofocused = useRef(false);
  useEffect(() => {
    const autofocus = propsRef.current.autofocus;
    if (!editor || !editable || !autofocus || autofocused.current) return;
    autofocused.current = true;
    editor.commands.focus(autofocus === 'start' ? 'start' : 'end');
  }, [editor, editable]);

  // Hide the toolbar when focus leaves the editor (unless it moved into the toolbar itself).
  useEffect(() => {
    if (!editor) return;
    const onBlur = ({ event }: { event: FocusEvent }) => {
      const next = event.relatedTarget as HTMLElement | null;
      if (next?.closest?.('[data-testid="selection-toolbar"]')) return;
      setPointerSelection(false);
    };
    editor.on('blur', onBlur);
    return () => {
      editor.off('blur', onBlur);
    };
  }, [editor]);

  const editLink = useCallback(() => {
    const current = editorRef.current;
    const target = linkTarget;
    setLinkTarget(null);
    if (!current || !target) return;
    const pos = current.view.posAtDOM(target.element, 0);
    const range = getMarkRange(current.state.doc.resolve(pos), current.schema.marks.link as never);
    if (range) current.chain().focus().setTextSelection(range).run();
    setToolbarMode('link');
    setPointerSelection(true);
  }, [linkTarget]);

  const unlink = useCallback(() => {
    const current = editorRef.current;
    const target = linkTarget;
    setLinkTarget(null);
    if (!current || !target) return;
    const pos = current.view.posAtDOM(target.element, 0);
    const range = getMarkRange(current.state.doc.resolve(pos), current.schema.marks.link as never);
    if (range) current.chain().focus().setTextSelection(range).unsetLink().run();
  }, [linkTarget]);

  return (
    <div
      className={props.className}
      data-editor-state={denied ? `denied:${denied}` : synced ? (editable ? 'editable' : 'read-only') : 'syncing'}
      onMouseDown={(event) => {
        // A click in the body area outside the text (e.g. below the last block) puts the caret at the end.
        if (event.target === event.currentTarget && editor?.isEditable) {
          event.preventDefault();
          editor.commands.focus('end');
        }
      }}
    >
      <EditorContent editor={editor} />
      {editor ? (
        <>
          <SelectionToolbar
            key={toolbarMode}
            editor={editor}
            pointerSelection={pointerSelection}
            initialMode={toolbarMode}
            onDismiss={() => {
              setPointerSelection(false);
              setToolbarMode('main');
            }}
          />
          <SuggestionMenu store={suggestionStore} />
          {linkTarget ? (
            <LinkPopover
              target={linkTarget}
              editable={editable}
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

/** Remote caret: 2 px line in the peer colour with a name pill above it. */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const color = typeof user.color === 'string' && /^#[0-9a-f]{6}$/i.test(user.color) ? user.color : '#266DF0';
  const caret = document.createElement('span');
  caret.className = 'collaboration-carets__caret';
  caret.style.borderColor = color;
  caret.setAttribute('data-user', String(user.name ?? ''));
  const label = document.createElement('span');
  label.className = 'collaboration-carets__label';
  label.style.backgroundColor = color;
  label.textContent = String(user.name ?? '');
  caret.appendChild(label);
  return caret;
}
