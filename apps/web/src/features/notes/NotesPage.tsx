// Notes page `/$ws/notes` (BACKLOG 3.12; E README §2.1): header tabs, toolbar (Sorted by Creation date · list / grid ·
// View settings · + New note), favourites strip, then notes grouped by creation-date buckets in the viewer's zone and
// week start ("Created today 5") as 395 × 208 cards or as a table. Sort, layout, grouping and "Show favorites" are
// per user and browser.
import { type CreatedBucket, createdBucketOf, createdBucketRanges } from '@agentic-crm/contracts';
import { Button, Icon, Skeleton, Tooltip } from '@agentic-crm/ui';
import { Button as AriaButton } from 'react-aria-components';
import { usePersistentState } from '../../lib/storage';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useCalendar } from '../tasks/calendar';
import { type Note, useNotesList } from './data';
import { CREATED_BUCKET_LABEL } from './format';
import {
  FavoritesStrip,
  GroupHeader,
  IndexState,
  NotesHeader,
  type SortDirection,
  SortMenu,
  ViewSettingsMenu,
} from './indexParts';
import { openNewNote } from './NewNote';
import { NoteCard, NoteRow, NotesTableHead } from './NoteCards';
import * as s from './notesPage.css';

type Layout = 'grid' | 'list';

export interface NoteGroup {
  key: CreatedBucket | 'all';
  label: string;
  notes: Note[];
}

/** Notes in creation-date buckets (newest bucket first for descending sorts, oldest first for ascending). */
export function groupNotes(
  notes: Note[],
  groupBy: 'created' | 'none',
  calendar: { timeZone: string; weekStart: Parameters<typeof createdBucketRanges>[2] },
  direction: SortDirection,
  now: number = Date.now(),
): NoteGroup[] {
  if (groupBy === 'none') return notes.length ? [{ key: 'all', label: 'All notes', notes }] : [];
  const ranges = createdBucketRanges(now, calendar.timeZone, calendar.weekStart);
  const groups = new Map<CreatedBucket, Note[]>();
  for (const note of notes) {
    const key = createdBucketOf(note.createdAt, ranges);
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }
  const order = ranges.map((r) => r.key);
  if (direction === 'asc') order.reverse();
  return order
    .filter((k) => groups.has(k))
    .map((key) => ({ key, label: CREATED_BUCKET_LABEL[key], notes: groups.get(key) ?? [] }));
}

export function NotesPage() {
  useDocumentTitle('Notes');
  const calendar = useCalendar();
  const [layout, setLayout] = usePersistentState<Layout>('notes-list-view-mode', 'grid');
  const [direction, setDirection] = usePersistentState<SortDirection>('notes-sort-direction', 'desc');
  const [groupBy, setGroupBy] = usePersistentState<'created' | 'none'>('notes-group-by', 'created');
  const [showFavorites, setShowFavorites] = usePersistentState<boolean>('notes-show-favorites', true);
  const sort = direction === 'asc' ? 'created_at:asc' : 'created_at:desc';
  const notes = useNotesList({ sort, limit: 200 });
  const favorites = useNotesList({ sort, limit: 50, favoritesOnly: true }, showFavorites);
  const groups = groupNotes(notes.data?.notes ?? [], groupBy, calendar, direction);

  return (
    <>
      <NotesHeader active="notes" />
      <div className={s.page} data-testid="notes-page" data-layout={layout}>
        <div className={s.toolbar}>
          <SortMenu direction={direction} onChange={setDirection} />
          <span className={s.toolbarSpacer} />
          <div className={s.segmented} role="group" aria-label="Layout">
            <Tooltip content="View as a list of notes">
              <AriaButton
                className={s.segment}
                aria-label="View as a list of notes"
                aria-pressed={layout === 'list'}
                onPress={() => setLayout('list')}
                data-testid="notes-layout-list"
              >
                <Icon icon="viewList" size={16} />
              </AriaButton>
            </Tooltip>
            <Tooltip content="View as a grid of notes">
              <AriaButton
                className={s.segment}
                aria-label="View as a grid of notes"
                aria-pressed={layout === 'grid'}
                onPress={() => setLayout('grid')}
                data-testid="notes-layout-grid"
              >
                <Icon icon="viewGrid" size={16} />
              </AriaButton>
            </Tooltip>
          </div>
          <ViewSettingsMenu
            groupBy={groupBy}
            onGroupBy={setGroupBy}
            showFavorites={showFavorites}
            onShowFavorites={setShowFavorites}
          />
          <Button variant="primary" size={28} icon="add" onPress={() => openNewNote()} data-testid="new-note">
            New note
          </Button>
        </div>
        <div className={s.scroll}>
          {showFavorites && (
            <FavoritesStrip emptyText="Notes that you favorite will appear here">
              {favorites.data?.notes.length
                ? favorites.data.notes.map((n) => <NoteCard key={n.id} note={n} variant="favorite" />)
                : undefined}
            </FavoritesStrip>
          )}
          {notes.isError ? (
            <IndexState error text="Something went wrong trying to load notes. Refresh the page to try again." />
          ) : notes.isPending ? (
            <NotesSkeleton layout={layout} />
          ) : groups.length === 0 ? (
            <IndexState title="Notes" text="No notes yet! Create your first note to get started." />
          ) : layout === 'grid' ? (
            groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <GroupHeader label={g.label} count={g.notes.length} />
                <div className={s.grid}>
                  {g.notes.map((n) => (
                    <NoteCard key={n.id} note={n} />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className={s.table} role="table" aria-label="Notes">
              <NotesTableHead />
              {groups.map((g) => (
                <div key={g.key} role="rowgroup" aria-label={g.label}>
                  <div className={s.tableGroup} data-testid="notes-group">
                    {g.label}
                    <span className={s.count}>{g.notes.length}</span>
                  </div>
                  {g.notes.map((n) => (
                    <NoteRow key={n.id} note={n} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function NotesSkeleton({ layout }: { layout: Layout }) {
  if (layout === 'list') {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width={360} height={12} />
        ))}
      </div>
    );
  }
  return (
    <div className={s.grid} style={{ paddingTop: 52 }}>
      {[0, 1, 2].map((i) => (
        <div key={i} className={s.card} style={{ cursor: 'default' }}>
          <Skeleton width={140} height={10} />
          <div style={{ height: 16 }} />
          <Skeleton width={220} height={12} />
        </div>
      ))}
    </div>
  );
}
