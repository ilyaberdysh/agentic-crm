// E3: a record's Notes tab (D README §2.9 "Notes"; E README §2.1 cards): 52 px header "Notes" + "Create note", then
// the record's notes as cards, newest first. Empty: "No notes" / "Create your first note to get started."
import { Button, Icon, Spinner } from '@agentic-crm/ui';
import type { RecordRef } from '../overlays/model';
import * as tasks from '../tasks/tasks.css';
import { useNotesList } from './data';
import { openNewNote } from './NewNote';
import { NoteCard } from './NoteCards';
import * as s from './notesPage.css';

export function RecordNotesTab({ recordRef }: { recordRef: RecordRef }) {
  const notes = useNotesList({ record: recordRef, sort: 'created_at:desc', limit: 200 });
  const list = notes.data?.notes ?? [];
  return (
    <section data-testid="record-notes-tab" aria-label="Notes">
      <div className={tasks.tabHeader}>
        <h2 className={tasks.tabTitle}>Notes</h2>
        <Button variant="secondary" size={28} icon="add" onPress={() => openNewNote({ record: recordRef })}>
          Create note
        </Button>
      </div>
      {notes.isPending ? (
        <div className={tasks.empty}>
          <Spinner size={16} />
        </div>
      ) : list.length === 0 ? (
        <div className={tasks.empty} data-testid="record-notes-empty">
          <Icon icon="notes" size={20} />
          <span className={tasks.emptyTitle}>No notes</span>
          <span className={tasks.emptyText}>Create your first note to get started.</span>
          <Button variant="secondary" size={28} icon="add" onPress={() => openNewNote({ record: recordRef })}>
            New note
          </Button>
        </div>
      ) : (
        <div className={s.grid} style={{ padding: '0 20px 20px' }}>
          {list.map((n) => (
            <NoteCard key={n.id} note={n} />
          ))}
        </div>
      )}
    </section>
  );
}
