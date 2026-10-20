// What the dock, favorites and breadcrumbs show for a note or template window: its title and parent record.
import { useObjectDefinition } from '../attributes/data/queries';
import { RecordAvatar, recordKind } from '../attributes/ui/primitives';
import type { RecordRef, WindowKind } from '../overlays/model';
import { useNote, useNoteTemplate } from './data';

export interface WindowSummary {
  title: string;
  record: RecordRef | null;
  isMissing: boolean;
}

export function useWindowSummary(kind: WindowKind, id: string): WindowSummary {
  const note = useNote(kind === 'note' ? id : null);
  const template = useNoteTemplate(kind === 'note-template' ? id : null);
  if (kind === 'note') {
    return {
      title: note.data?.title ?? '',
      record: note.data?.parentRecords[0] ?? null,
      isMissing: note.isError,
    };
  }
  if (kind === 'note-template') {
    return { title: template.data?.title ?? '', record: null, isMissing: template.isError };
  }
  return { title: '', record: null, isMissing: false };
}

/** The parent record's object as a 12 px mark (dock bubble corner badge). */
export function WindowBubbleBadge({ record }: { record: RecordRef }) {
  const definition = useObjectDefinition(record.entityDefinitionId);
  return <RecordAvatar kind={recordKind(definition)} size={12} />;
}
