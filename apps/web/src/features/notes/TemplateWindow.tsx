// Note template editor (E README §2.5; evidence E/template-editor.png): note window chrome with the template title as
// breadcrumb and only Close, the peach "You are editing a template" banner (ⓘ help, presence, ⋮ Add to favorites |
// Delete template), title "Untitled Template" (title and header title saved together, debounced) and the body
// ("Start typing..."), saved continuously through Yjs.
import { type EditorHandle, InsertMenuButton, PresenceAvatars, type PresenceUser } from '@agentic-crm/editor';
import {
  AlertDialog,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Spinner,
  Tooltip,
  toast,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorEnvelopeOf } from '../../data/trpc';
import { useFavoriteToggle } from '../favorites/data';
import type { WindowContentProps } from '../overlays/registry';
import { closeWindow } from '../overlays/store';
import { WindowControls, WindowTopBar, windowStyles } from '../overlays/WindowShell';
import { deleteTemplate, type NoteTemplate, updateTemplateTitle, useNoteTemplate, useWorkspaceRef } from './data';
import { BodyEditor } from './editor/BodyEditor';
import { useAutosave } from './useAutosave';
import * as s from './window.css';

export function TemplateWindow({ id, mode }: WindowContentProps) {
  const template = useNoteTemplate(id);
  if (template.isPending || template.isError || !template.data) {
    return (
      <>
        <WindowTopBar mode={mode} start={null} controls={<WindowControls kind="note-template" id={id} mode={mode} />} />
        <div className={s.state}>
          {template.isPending ? (
            <Spinner size={16} />
          ) : (
            <>
              <span className={s.stateTitle}>Note template not found</span>
              <span className={s.stateText}>This template may have been deleted</span>
            </>
          )}
        </div>
      </>
    );
  }
  return <TemplateWindowBody key={template.data.id} template={template.data} mode={mode} />;
}

function TemplateWindowBody({ template, mode }: { template: NoteTemplate; mode: 'modal' | 'floating' }) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const [editor, setEditor] = useState<EditorHandle | null>(null);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const favorite = useFavoriteToggle({ favoriteType: 'note-template', targetId: template.id });
  const title = useAutosave(template.title, (value) => updateTemplateTitle(client, ws, template.id, value), {
    onError: (error) => toast.error({ title: 'Failed to save the title', description: errorEnvelopeOf(error).message }),
  });

  const remove = async () => {
    try {
      title.cancel();
      await deleteTemplate(client, ws, template.id);
      closeWindow('note-template', template.id);
      toast({ title: 'Template deleted' });
    } catch (error) {
      toast.error({ title: 'Failed to delete the template', description: errorEnvelopeOf(error).message });
    }
  };

  return (
    <div className={s.body} data-testid="template-window" data-template-id={template.id}>
      <WindowTopBar
        mode={mode}
        start={<span className={windowStyles.topBarLabel}>{title.value || 'Untitled Template'}</span>}
        controls={<WindowControls kind="note-template" id={template.id} mode={mode} />}
      />
      <div className={s.banner} data-testid="template-banner">
        You are editing a template
        <Tooltip content="Changes to a template do not affect notes already created from it">
          <span className={s.bannerInfo} tabIndex={-1}>
            <Icon icon="info" size={16} />
          </span>
        </Tooltip>
        <span className={s.bannerSpacer} />
        {presence.length > 0 && <PresenceAvatars users={presence} size={20} />}
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="Template options" size={28} />
          <Menu
            aria-label="Template options"
            placement="bottom end"
            width={220}
            onAction={(key) => {
              if (key === 'favorite') favorite.toggle();
              if (key === 'delete') setConfirmDelete(true);
            }}
          >
            <MenuItem id="favorite" icon={favorite.isFavorite ? 'favoriteRemove' : 'favorite'}>
              {favorite.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="delete" icon="delete" variant="danger">
              Delete template
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <div className={s.scroll}>
        <div className={`${s.column} ${s.columnTemplate}`}>
          <textarea
            className={s.title}
            value={title.value}
            placeholder="Untitled Template"
            aria-label="Template title"
            rows={1}
            onChange={(e) => title.set(e.target.value.replace(/\n/g, ' '))}
            onBlur={() => void title.flush()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                editor?.focus('start');
              }
            }}
            data-testid="template-title"
          />
          <div className={s.editor}>
            <BodyEditor
              documentId={template.documentId}
              docType="note-template"
              placeholder="Start typing..."
              onReady={setEditor}
              onAwarenessChange={setPresence}
            />
          </div>
        </div>
      </div>
      <div className={s.insertButton}>
        <InsertMenuButton handle={editor} />
      </div>
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Are you sure?"
        description="Are you sure you want to permanently delete this template?"
        confirmLabel="Confirm"
        onConfirm={() => void remove()}
      />
    </div>
  );
}
