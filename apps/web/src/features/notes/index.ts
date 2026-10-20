// Notes and note templates (BACKLOG 3.12, 3.14). E3 for the record page: <RecordNotesTab recordRef/>; plus the
// pieces the record overview reuses: note cards, the new-note flow and note windows (features/overlays).
export { ActorLabel, copyToClipboard } from './actors';
export {
  createNote,
  deleteNote,
  type Note,
  type NoteTemplate,
  noteKeys,
  useNote,
  useNotesList,
  useNoteTemplates,
} from './data';
export { NotePreview } from './editor/NotePreview';
export { type NewNoteOptions, openNewNote } from './NewNote';
export { NoteCard, NoteOptionsMenu, NoteRow } from './NoteCards';
export { NotesPage } from './NotesPage';
export { RecordNotesTab } from './RecordNotesTab';
export { TemplatesPage } from './TemplatesPage';
