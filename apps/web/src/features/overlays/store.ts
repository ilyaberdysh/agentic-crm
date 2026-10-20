// The overlay store (E4): one per tab, outside React so any feature (a table row, a sidebar favorite, a toast
// action) can open a note or a record overlay. <OverlayHost> mounts once in the app shell: it reconciles the store
// with the URL on every location change and lends the store a navigator so that the URL follows the top layer.
// Detached windows (dock bubbles, the floating panel) are kept in sessionStorage so they survive a reload of the tab.
import { useSyncExternalStore } from 'react';
import {
  closeEntry,
  type DetachedMode,
  detachWindow,
  EMPTY_OVERLAYS,
  expandWindow,
  type OverlayEntry,
  type OverlayState,
  openEntry,
  type RecordRef,
  type RecordSequence,
  reconcile,
  stepRecord,
  topOf,
  type WindowKind,
} from './model';

/** Moves the URL to the overlay params of `entry` (null = none) on the current path. */
export type OverlayNavigator = (entry: OverlayEntry | null, options: { replace: boolean }) => void;

const SESSION_KEY = 'ar:overlay-windows';

function loadDetached(): OverlayState['detached'] {
  try {
    const raw = typeof window === 'undefined' ? null : window.sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as OverlayState['detached']) : [];
    return Array.isArray(parsed) ? parsed.filter((w) => w && typeof w.id === 'string') : [];
  } catch {
    return [];
  }
}

function saveDetached(detached: OverlayState['detached']): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(detached));
  } catch {
    // storage disabled: windows are not restored after a reload
  }
}

export class OverlayStore {
  private state: OverlayState;
  private listeners = new Set<() => void>();
  private navigator: OverlayNavigator | null = null;

  constructor(initial: OverlayState = { ...EMPTY_OVERLAYS, detached: loadDetached() }) {
    this.state = initial;
  }

  getState = (): OverlayState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Set by <OverlayHost>; without it (tests, before mount) only the state changes. */
  setNavigator(navigator: OverlayNavigator | null): void {
    this.navigator = navigator;
  }

  private set(next: OverlayState): void {
    if (next === this.state) return;
    const detachedChanged = next.detached !== this.state.detached;
    this.state = next;
    if (detachedChanged) saveDetached(next.detached);
    for (const l of this.listeners) l();
  }

  /** Applies an operation and moves the URL when the top layer changed (push for opens, replace otherwise). */
  private apply(next: OverlayState, mode: 'push' | 'replace'): void {
    const before = topOf(this.state);
    this.set(next);
    const after = topOf(next);
    // Entries are immutable: a different object on top means a different overlay (or a record step).
    if (before !== after) this.navigator?.(after, { replace: mode === 'replace' || after === null });
  }

  /** The URL changed (navigation, Back / Forward, a pasted link). */
  syncFromUrl(entry: OverlayEntry | null): void {
    this.set(reconcile(this.state, entry));
  }

  open(entry: OverlayEntry): void {
    this.apply(openEntry(this.state, entry), 'push');
  }

  close(entry: OverlayEntry): void {
    this.apply(closeEntry(this.state, entry), 'replace');
  }

  closeTop(): void {
    const top = topOf(this.state);
    if (top) this.close(top);
  }

  detach(kind: WindowKind, id: string, mode: DetachedMode): void {
    this.apply(detachWindow(this.state, kind, id, mode), 'replace');
  }

  expand(kind: WindowKind, id: string): void {
    this.apply(expandWindow(this.state, kind, id), 'push');
  }

  stepRecord(to: RecordRef): void {
    this.apply(stepRecord(this.state, to), 'replace');
  }
}

export const overlayStore = new OverlayStore();

export function useOverlayState(): OverlayState {
  return useSyncExternalStore(overlayStore.subscribe, overlayStore.getState, overlayStore.getState);
}

// ---- public API (re-exported from ./index) ----------------------------------------------------------------------

export interface OpenWindowOptions {
  /** `modal` (default, URL `?modal=…&id=…`), `floating` (pinned panel) or `minimized` (dock bubble). */
  mode?: 'modal' | DetachedMode;
}

/** Opens a note window (`?modal=note&id=…` in modal mode). */
export function openNote(noteId: string, options: OpenWindowOptions = {}): void {
  openWindow('note', noteId, options);
}

/** Opens the note template editor (`?modal=note-template&id=…`). */
export function openNoteTemplate(templateId: string): void {
  openWindow('note-template', templateId, {});
}

export function openWindow(kind: WindowKind, id: string, { mode = 'modal' }: OpenWindowOptions): void {
  if (mode === 'modal') overlayStore.open({ type: 'window', kind, id });
  else overlayStore.detach(kind, id, mode);
}

/**
 * Opens a record as a full-viewport overlay above the current page (D README §2.7; `?modal=record&id=…&object=…`).
 * `list` is the ordered records of the originating view: the overlay shows "n of N in ‹label›" and K / J step
 * through it.
 */
export function openRecordOverlay(record: RecordRef, options: { list?: RecordSequence } = {}): void {
  overlayStore.open({ type: 'record', record, sequence: options.list });
}

/** Opens the edit-task dialog (`?command-menu-page=task&id=…`). */
export function openTask(taskId: string): void {
  overlayStore.open({ type: 'task', id: taskId });
}

export function closeOverlay(entry: OverlayEntry): void {
  overlayStore.close(entry);
}

export function closeWindow(kind: WindowKind, id: string): void {
  overlayStore.close({ type: 'window', kind, id });
}

export function minimizeWindow(kind: WindowKind, id: string): void {
  overlayStore.detach(kind, id, 'minimized');
}

/** "Pin to screen": the 456 × 556 panel at the bottom right; the page underneath stays interactive. */
export function floatWindow(kind: WindowKind, id: string): void {
  overlayStore.detach(kind, id, 'floating');
}

export function expandToModal(kind: WindowKind, id: string): void {
  overlayStore.expand(kind, id);
}
