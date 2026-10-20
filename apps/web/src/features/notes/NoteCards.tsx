// Note card (395 × 208) and list row of the notes index, record Notes tab and favourites strip (E README §2.1;
// evidence E/notes-page-grid.png, notes-page-list.png): parent-record chip, ⋮ "Note options" on hover (Create template
// from note · Copy link · Run workflow · Delete note), title, clipped rich preview with a fade, divider, creator and a
// relative date. Rows: title + first line, Created by, Record, Meeting, Created at, hover ★ and ⋮.
import { AlertDialog, Icon, IconButton, Menu, MenuItem, MenuSeparator, MenuTrigger, toast } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorEnvelopeOf } from '../../data/trpc';
import { RecordChip } from '../attributes/ui/primitives';
import { FavoriteStar } from '../favorites/FavoriteStar';
import { closeWindow, openNote, openNoteTemplate } from '../overlays/store';
import { useCalendar } from '../tasks/calendar';
import { ActorLabel, copyToClipboard } from './actors';
import { createTemplateFromNote, deleteNote, type Note, useWorkspaceRef } from './data';
import { firstLine } from './editor/markdown';
import { NotePreview } from './editor/NotePreview';
import { relativeDay } from './format';
import * as s from './notesPage.css';

/** ⋮ "Note options" of cards and rows, with the delete confirmation (no undo). */
export function NoteOptionsMenu({ note, className }: { note: Note; className?: string }) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const onAction = async (key: React.Key) => {
    if (key === 'template') {
      try {
        toast({ title: 'Creating template...' });
        const template = await createTemplateFromNote(client, ws, note.id);
        openNoteTemplate(template.id);
      } catch (error) {
        toast.error({ title: 'Failed to create the template', description: errorEnvelopeOf(error).message });
      }
    }
    if (key === 'copy') void copyToClipboard(`${window.location.origin}/${ws.slug}/note/${note.id}`);
    if (key === 'workflow') toast({ title: 'Workflows arrive in a later slice' });
    if (key === 'delete') setConfirm(true);
  };
  return (
    <>
      <MenuTrigger>
        <IconButton icon="moreVertical" aria-label="Note options" size={20} className={className} />
        <Menu aria-label="Note options" placement="bottom end" width={240} onAction={(k) => void onAction(k)}>
          <MenuItem id="template" icon="noteTemplate">
            Create template from note
          </MenuItem>
          <MenuItem id="copy" icon="link">
            Copy link
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
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Are you sure?"
        description="Permanently delete this note?"
        confirmLabel="Confirm"
        onConfirm={async () => {
          try {
            await deleteNote(client, ws, note.id);
            closeWindow('note', note.id);
            toast({ title: 'Note deleted' });
          } catch (error) {
            toast.error({ title: 'Failed to delete the note', description: errorEnvelopeOf(error).message });
          }
        }}
      />
    </>
  );
}

function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export function NoteCard({ note, variant = 'grid' }: { note: Note; variant?: 'grid' | 'favorite' }) {
  const calendar = useCalendar();
  const parent = note.parentRecords[0];
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${s.card} ${variant === 'favorite' ? s.cardFavorite : ''}`}
      data-testid="note-card"
      data-note-id={note.id}
      onClick={() => openNote(note.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openNote(note.id);
      }}
    >
      <div className={s.cardTop}>
        {parent && (
          <span className={s.cardRecord} onClick={stop} onKeyDown={stop}>
            <RecordChip entityDefinitionId={parent.entityDefinitionId} entityInstanceId={parent.entityInstanceId} />
          </span>
        )}
        <span className={s.cardTopSpacer} />
        <span onClick={stop} onKeyDown={stop}>
          <NoteOptionsMenu note={note} className={s.cardMenu} />
        </span>
      </div>
      <p className={s.cardTitle}>{note.title || 'Untitled note'}</p>
      <div className={s.cardPreview}>
        <NotePreview
          content={note.content}
          compact
          maxBlocks={variant === 'favorite' ? 4 : 6}
          emptyText="This note has no content."
          emptyClassName={s.cardEmpty}
        />
      </div>
      <div className={s.cardFooter}>
        <ActorLabel actor={note.createdBy} size={16} />
        <span className={s.cardDate}>{relativeDay(note.createdAt, calendar.timeZone, calendar.locale)}</span>
      </div>
    </div>
  );
}

export function NotesTableHead() {
  return (
    <div className={`${s.tableRow} ${s.tableHead}`} role="row">
      <span className={s.headCell} role="columnheader">
        Note
      </span>
      <span className={s.headCell} role="columnheader">
        <HeadIcon icon="user" />
        Created by
      </span>
      <span className={s.headCell} role="columnheader">
        <HeadIcon icon="record" />
        Record
      </span>
      <span className={s.headCell} role="columnheader">
        <HeadIcon icon="calendar" />
        Meeting
      </span>
      <span className={s.headCell} role="columnheader">
        <HeadIcon icon="clock" />
        Created at
      </span>
    </div>
  );
}

function HeadIcon({ icon }: { icon: Parameters<typeof Icon>[0]['icon'] }) {
  return <Icon icon={icon} size={14} className={s.headIcon} />;
}

export function NoteRow({ note }: { note: Note }) {
  const calendar = useCalendar();
  const parent = note.parentRecords[0];
  const isFavorite = note.favoriteId !== null;
  return (
    <div
      role="row"
      tabIndex={0}
      className={`${s.tableRow} ${s.dataRow}`}
      data-testid="note-row"
      data-note-id={note.id}
      onClick={() => openNote(note.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openNote(note.id);
      }}
    >
      <span className={`${s.cell} ${s.noteCell}`} role="cell">
        <span className={s.rowTitle}>{note.title || 'Untitled note'}</span>
        <span className={s.rowPreview}>{firstLine(note.content)}</span>
      </span>
      <span className={s.cell} role="cell">
        <ActorLabel actor={note.createdBy} size={16} />
      </span>
      <span className={s.cell} role="cell" onClick={stop} onKeyDown={stop}>
        {parent && (
          <RecordChip entityDefinitionId={parent.entityDefinitionId} entityInstanceId={parent.entityInstanceId} />
        )}
      </span>
      <span className={s.cell} role="cell" />
      <span className={s.cell} role="cell">
        {relativeDay(note.createdAt, calendar.timeZone, calendar.locale)}
      </span>
      <span className={s.rowActions} onClick={stop} onKeyDown={stop}>
        <FavoriteStar
          favoriteType="note"
          targetId={note.id}
          size={20}
          className={isFavorite ? undefined : s.rowHoverOnly}
        />
        <NoteOptionsMenu note={note} className={s.rowHoverOnly} />
      </span>
    </div>
  );
}
