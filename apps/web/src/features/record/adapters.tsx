// The one seam between the record page and its supporting features:
// E3 tab content features/notes RecordNotesTab, features/tasks RecordTasksTab, features/comments
// RecordCommentsPanel (320 px, focus on a deep-linked thread);
// E4 overlays features/overlays (note window, create-task dialog, record overlay, edit-task dialog);
// favourites features/favorites FavoriteStar / toggle;
// lists features/lists RecordListsSection (Lists section) and AddRecordToListDialog (Add to list).
// calls features/calls RecordCallsTab (Calls tab), the tab count and the activity call card;
// email / meetings features/email RecordEmailsTab, thread previews, "Compose email"; features/meetings
// NewMeetingDialog and the meetings behind timeline events.
// Everything else in features/record imports these features only through this file.
import { useCallback } from 'react';
import { useRecordTitle } from '../attributes';
import { ActivityCallCard, type CallListItem, RecordCallsTab, useCallsByMeetings, useRecordCallCount } from '../calls';
import { RecordCommentsPanel as CommentsPanel, useCommentCounts, useCommentDeepLink } from '../comments';
import { composeForRecord } from '../email';
import { useFavoriteToggle } from '../favorites';
import { openNewNote } from '../notes';
import { openNote, openTask } from '../overlays';
import { useWorkspace } from '../shell/workspaceContext';
import { openCreateTask } from '../tasks';
import { type RecordRef, useRecordPage } from './context';

export { formatCount, formatThreadDate, RecordEmailsTab, threadDisplay, useRecordThreadPreview } from '../email';
export { FavoriteStar } from '../favorites';
export { AddRecordToListDialog, openListsDialog } from '../lists/flows';
export { RecordListsSection } from '../lists/RecordListsSection';
export {
  isPast,
  type Meeting,
  NewMeetingDialog,
  participantCountLabel,
  timelineVerb,
  timeRangeLabel,
  useMeetingsById,
} from '../meetings';
export { RecordNotesTab } from '../notes';
export { openRecordOverlay, openWindow, type RecordOverlayContentProps, registerRecordOverlay } from '../overlays';
export { RecordTasksTab } from '../tasks';
export {
  ActivityCallCard,
  type CallListItem,
  openNote,
  openTask,
  RecordCallsTab,
  useCallsByMeetings,
  useRecordCallCount,
};

export interface RecordRefProps {
  recordRef: RecordRef;
}

/** The comments panel; a comment deep link (`?threadCommentId=…`) for this record focuses its thread. */
export function RecordCommentsPanel({ recordRef }: RecordRefProps) {
  const link = useRecordCommentLink(recordRef);
  return (
    <CommentsPanel
      recordRef={recordRef}
      focusThreadId={link?.threadId ?? null}
      focusCommentId={link?.commentId ?? null}
    />
  );
}

/** The deep-linked thread when it belongs to this record (opens the panel on load). */
export function useRecordCommentLink(recordRef: RecordRef) {
  const link = useCommentDeepLink();
  if (!link) return null;
  if (link.entityInstanceId && link.entityInstanceId !== recordRef.entityInstanceId) return null;
  return link;
}

/** Unresolved threads on the record: the top bar's "View comments" count. */
export function useRecordCommentCount(recordRef: RecordRef): number {
  const counts = useCommentCounts(recordRef.entityDefinitionId, [recordRef.entityInstanceId]);
  return counts.data?.counts[recordRef.entityInstanceId]?.unresolvedThreads ?? 0;
}

/** `n` / "New note": a new note linked to the record, opened in the note window. */
export function useNewNote(): (recordRef: RecordRef) => void {
  return useCallback((recordRef: RecordRef) => openNewNote({ record: recordRef }), []);
}

/** `t` / "New task": "Create task" with the record linked. */
export function useNewTask(): (recordRef: RecordRef) => void {
  return useCallback((recordRef: RecordRef) => openCreateTask({ records: [recordRef] }), []);
}

/** The header star and the "Add to favorites" item of Record actions share one toggle. */
export function useRecordFavorite(recordRef: RecordRef) {
  return useFavoriteToggle({
    favoriteType: 'record',
    targetId: recordRef.entityInstanceId,
    entityDefinitionId: recordRef.entityDefinitionId,
  });
}

/**
 * `c` / "Compose email": the composer opens addressed to the record's primary email address when it is a person,
 * else without a recipient.
 */
export function useComposeEmail(): () => void {
  const { workspace } = useWorkspace();
  const { recordRef, object, attributes } = useRecordPage();
  const { title } = useRecordTitle(recordRef.entityDefinitionId, recordRef.entityInstanceId);
  return useCallback(() => {
    void composeForRecord({
      workspace: { id: workspace.id, slug: workspace.slug },
      recordRef,
      object,
      attributes,
      name: title || null,
    });
  }, [workspace.id, workspace.slug, recordRef, object, attributes, title]);
}
