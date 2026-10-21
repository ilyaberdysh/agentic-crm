// Note window body: top bar (parent record breadcrumb or "Note" when floating; Minimize ·
// Pin to screen / Expand · Close), header row (presence, "Copy link", ⋮ Note options), the 704 px document column
// (title with debounced autosave, parent-record chips, "Link a meeting"), the body editor (E1 adapter) with the empty
// note's template launcher, and the "+" insert button. Delete asks "Are you sure?" and has no undo.
import {
  type Block,
  type EditorHandle,
  InsertMenuButton,
  markdownToBlocks,
  PresenceAvatars,
  type PresenceUser,
} from '@agentic-crm/editor';
import {
  AlertDialog,
  Button,
  cx,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Spinner,
  toast,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { errorEnvelopeOf } from '../../data/trpc';
import { useObjectDefinition, useRecordTitle } from '../attributes/data/queries';
import { RecordAvatar, recordKind, recordPath } from '../attributes/ui/primitives';
import { useFavoriteToggle } from '../favorites/data';
import type { RecordRef } from '../overlays/model';
import type { WindowContentProps } from '../overlays/registry';
import { closeWindow, openNoteTemplate } from '../overlays/store';
import { WindowControls, WindowTopBar, windowStyles } from '../overlays/WindowShell';
import { useWorkspace } from '../shell/workspaceContext';
import { copyToClipboard } from './actors';
import {
  applyTemplate,
  createTemplate,
  createTemplateFromNote,
  deleteNote,
  updateNoteTitle,
  useNote,
  useWorkspaceRef,
} from './data';
import { BodyEditor } from './editor/BodyEditor';
import { type LauncherKey, TemplateLauncher } from './TemplateLauncher';
import { useAutosave } from './useAutosave';
import * as s from './window.css';

/** Parent record as the breadcrumb / meta chip shows it: object mark + record name. */
export function ParentRecordChip({ record, asLink = true }: { record: RecordRef; asLink?: boolean }) {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const { title, definition } = useRecordTitle(record.entityDefinitionId, record.entityInstanceId);
  const href = recordPath(workspace.slug, definition, record.entityInstanceId);
  const content = (
    <>
      <RecordAvatar kind={recordKind(definition)} size={16} />
      <span className={s.chipText}>{title || 'Untitled record'}</span>
    </>
  );
  if (!asLink || !href) return <span className={s.crumbChip}>{content}</span>;
  return (
    <AriaButton className={s.metaChip} onPress={() => void navigate({ href })} data-testid="note-record-chip">
      {content}
    </AriaButton>
  );
}

/** The template body as editor blocks (the flat projection, else its markdown). */
export function templateBlocks(content: { blocks: unknown[] | null; markdown: string | null } | undefined): Block[] {
  if (content?.blocks && content.blocks.length > 0) return content.blocks as Block[];
  return markdownToBlocks(content?.markdown ?? '');
}

export function NoteWindow({ id, mode }: WindowContentProps) {
  const note = useNote(id);
  if (note.isPending) {
    return (
      <>
        <WindowTopBar mode={mode} start={null} controls={<WindowControls kind="note" id={id} mode={mode} />} />
        <div className={s.state}>
          <Spinner size={16} />
        </div>
      </>
    );
  }
  if (note.isError || !note.data) {
    return (
      <>
        <WindowTopBar mode={mode} start={null} controls={<WindowControls kind="note" id={id} mode={mode} />} />
        <div className={s.state} data-testid="note-not-found">
          <span className={s.stateTitle}>Note not found</span>
          <span className={s.stateText}>This note may have been deleted</span>
        </div>
      </>
    );
  }
  return <NoteWindowBody key={note.data.id} note={note.data} mode={mode} />;
}

function NoteWindowBody({
  note,
  mode,
}: {
  note: NonNullable<ReturnType<typeof useNote>['data']>;
  mode: 'modal' | 'floating';
}) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const [editor, setEditor] = useState<EditorHandle | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  editorRef.current = editor;
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [bodyEmpty, setBodyEmpty] = useState(false);
  // Launcher keyboard bridge: the editor forwards ↑ / ↓ / Enter while the body is empty.
  const launcherKeys = useRef<((key: LauncherKey) => boolean) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const favorite = useFavoriteToggle({ favoriteType: 'note', targetId: note.id });
  const primary = note.parentRecords[0] ?? null;
  const primaryDefinition = useObjectDefinition(primary?.entityDefinitionId ?? null);

  const title = useAutosave(note.title, (value) => updateNoteTitle(client, ws, note.id, value), {
    onError: (error) => toast.error({ title: 'Failed to save the title', description: errorEnvelopeOf(error).message }),
  });

  const onChange = useCallback((state: { isEmpty: boolean }) => setBodyEmpty(state.isEmpty), []);

  const useTemplate = async (templateId: string) => {
    try {
      const out = await applyTemplate(client, ws, note.id, templateId);
      title.reset(out.note.title);
      // The open editor holds the live document: insert the body here even when the server also copied it into
      // the (never stored) document, so the in-memory copy and the stored one agree.
      editor?.insertBlocks(templateBlocks(out.template.content));
      editor?.focus('end');
    } catch (error) {
      toast.error({ title: 'Failed to use the template', description: errorEnvelopeOf(error).message });
    }
  };

  const newTemplate = async () => {
    try {
      const template = await createTemplate(client, ws, { title: '' });
      openNoteTemplate(template.id);
    } catch (error) {
      toast.error({ title: 'Failed to create the template', description: errorEnvelopeOf(error).message });
    }
  };

  const onAction = async (key: React.Key) => {
    if (key === 'favorite') favorite.toggle();
    if (key === 'template') {
      try {
        toast({ title: 'Creating template...' });
        await title.flush();
        const template = await createTemplateFromNote(client, ws, note.id);
        openNoteTemplate(template.id);
      } catch (error) {
        toast.error({ title: 'Failed to create the template', description: errorEnvelopeOf(error).message });
      }
    }
    if (key === 'workflow') toast({ title: 'Workflows arrive in a later slice' });
    if (key === 'delete') setConfirmDelete(true);
  };

  const remove = async () => {
    try {
      title.cancel();
      await deleteNote(client, ws, note.id);
      closeWindow('note', note.id);
      toast({ title: 'Note deleted' });
    } catch (error) {
      toast.error({ title: 'Failed to delete the note', description: errorEnvelopeOf(error).message });
    }
  };

  const start =
    mode === 'floating' ? (
      <span className={windowStyles.topBarLabel}>
        <Icon icon="notes" size={16} />
        Note
      </span>
    ) : primary ? (
      <span className={s.crumbChip} data-testid="note-breadcrumb">
        <RecordAvatar kind={recordKind(primaryDefinition)} size={16} />
        <BreadcrumbTitle record={primary} />
      </span>
    ) : null;

  return (
    <div className={s.body} data-testid="note-window" data-note-id={note.id} data-mode={mode}>
      <WindowTopBar mode={mode} start={start} controls={<WindowControls kind="note" id={note.id} mode={mode} />} />
      <div className={s.headerRow}>
        {presence.length > 0 && <PresenceAvatars users={presence} size={20} />}
        <Button
          variant="ghost"
          size={28}
          icon="link"
          onPress={() => void copyToClipboard(`${window.location.origin}/${ws.slug}/note/${note.id}`)}
        >
          Copy link
        </Button>
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="Note options" size={28} />
          <Menu aria-label="Note options" placement="bottom end" width={240} onAction={(key) => void onAction(key)}>
            <MenuItem id="favorite" icon={favorite.isFavorite ? 'favoriteRemove' : 'favorite'}>
              {favorite.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            </MenuItem>
            <MenuItem id="template" icon="noteTemplate">
              Create template from note
            </MenuItem>
            <MenuItem id="workflow" icon="workflows">
              Run workflow
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="delete" icon="delete" variant="danger">
              Delete note
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <div className={s.scroll}>
        <div className={cx(s.column, mode === 'floating' && s.columnFloating)}>
          <textarea
            className={cx(s.title, mode === 'floating' && s.titleFloating)}
            value={title.value}
            placeholder="Untitled note"
            aria-label="Note title"
            rows={1}
            onChange={(e) => title.set(e.target.value.replace(/\n/g, ' '))}
            onBlur={() => void title.flush()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                editor?.focus('start');
              }
            }}
            data-testid="note-title"
          />
          <div className={s.meta}>
            {note.parentRecords.map((r) => (
              <ParentRecordChip key={r.entityInstanceId} record={r} />
            ))}
            <AriaButton
              className={cx(s.metaChip, s.metaChipMuted)}
              onPress={() => toast({ title: 'Meetings arrive with calendar sync' })}
            >
              <Icon icon="calendar" size={16} />
              Link a meeting
            </AriaButton>
          </div>
          <div className={s.editor}>
            <BodyEditor
              documentId={note.documentId}
              docType="note"
              placeholder="Start typing, or pick a template (use ↑↓ to navigate)"
              onReady={(handle) => {
                setEditor(handle);
                setBodyEmpty(handle.isEmpty());
              }}
              onStatusChange={(status) => {
                // The body is known once the first sync completes (the editor is read-only until then).
                if (status === 'synced') {
                  requestAnimationFrame(() => setBodyEmpty(editorRef.current?.isEmpty() ?? false));
                }
              }}
              onChange={onChange}
              onAwarenessChange={setPresence}
              onLauncherKey={(key) => launcherKeys.current?.(key) ?? false}
            />
            {bodyEmpty && (
              <TemplateLauncher
                onPick={(id) => void useTemplate(id)}
                onCreate={() => void newTemplate()}
                keysRef={launcherKeys}
              />
            )}
          </div>
        </div>
      </div>
      {mode === 'floating' ? (
        <div className={s.footerBar}>
          <InsertMenuButton handle={editor} />
        </div>
      ) : (
        <div className={s.insertButton}>
          <InsertMenuButton handle={editor} />
        </div>
      )}
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Are you sure?"
        description="Permanently delete this note?"
        confirmLabel="Confirm"
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function BreadcrumbTitle({ record }: { record: RecordRef }) {
  const { title } = useRecordTitle(record.entityDefinitionId, record.entityInstanceId);
  return <span className={s.chipText}>{title || 'Untitled record'}</span>;
}
