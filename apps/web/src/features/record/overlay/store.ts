// The record preview drawer opened from a table row's "Open preview" (BACKLOG 3.09; D README §2.7, C1 README §2.9):
// a floating panel over the view, no URL change, ↑ / ↓ through the view's loaded records. (The full record overlay
// is features/overlays' `openRecordOverlay`.)
import { useSyncExternalStore } from 'react';
import type { RecordSequence } from '../context';

export interface PreviewObject {
  id: string;
  apiSlug: string;
  entityType: string;
  singularNoun: string;
  pluralNoun: string;
}

export interface PreviewState {
  object: PreviewObject;
  recordId: string;
  sequence: RecordSequence;
}

let current: PreviewState | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

/** Opens (or retargets) the preview drawer. */
export function openRecordPreview(state: PreviewState): void {
  current = state;
  emit();
}

export function closeRecordPreview(): void {
  if (!current) return;
  current = null;
  emit();
}

export function useRecordPreview(): PreviewState | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}

/** The sequence a table hands over: the loaded ids of its snapshot (in view order). */
export function sequenceFromSnapshot(
  ids: readonly (string | undefined)[],
  total: number,
  title: string,
  returnTo: string,
): RecordSequence {
  return { ids: ids.filter((id): id is string => typeof id === 'string'), total, title, returnTo };
}
