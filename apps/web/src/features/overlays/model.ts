// Window manager and overlay router state (contract E4, CROSS-DOMAIN B.16; B system-ui §4; E README §2.2; D README
// §2.7). Pure functions over plain data so they are unit-tested without React or a router.
//
// Two kinds of surfaces:
//   - URL overlays, stacked: a record overlay (`?modal=record&id=<record>&object=<object>`), a note / template /
//     email window in modal mode (`?modal=note|note-template|email&id=<id>`) and the edit-task dialog
//     (`?command-menu-page=task&id=<task>`). The URL mirrors the top of the stack; lower layers stay mounted
//     underneath (a note opened from a record overlay closes back to the overlay). Back / forward reconcile the
//     stack with the URL.
//   - Detached windows: notes minimised to the dock (32 px bubble) or floating as the 456 × 556 panel pinned to the
//     bottom right ("Pin to screen"). They survive navigation and carry no URL params.

export interface RecordRef {
  entityDefinitionId: string;
  entityInstanceId: string;
}

/** The ordered records a record overlay steps through with K / J ("1 of 12 in [seed] All projects"). */
export interface RecordSequence {
  /** View or list title shown after "of N in". */
  label: string;
  records: RecordRef[];
}

/** `composer` = a message draft (`?modal=composer&id=<draft>`), `email` = the "View email" modal, `meeting` = "Meeting". */
export type WindowKind = 'note' | 'note-template' | 'email' | 'composer' | 'meeting';

export type OverlayEntry =
  | { type: 'record'; record: RecordRef; sequence?: RecordSequence }
  | { type: 'window'; kind: WindowKind; id: string }
  | { type: 'task'; id: string };

export type DetachedMode = 'floating' | 'minimized';

export interface DetachedWindow {
  kind: WindowKind;
  id: string;
  mode: DetachedMode;
}

export interface OverlayState {
  stack: OverlayEntry[];
  detached: DetachedWindow[];
}

export const EMPTY_OVERLAYS: OverlayState = { stack: [], detached: [] };

// ---- URL ------------------------------------------------------------------------------------------------------

/** Search params the overlay router owns. */
export const OVERLAY_PARAMS = ['modal', 'id', 'object', 'command-menu-page'] as const;

const WINDOW_KINDS: readonly string[] = ['note', 'note-template', 'email', 'composer', 'meeting'];

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** The overlay a URL asks for (null = none). */
export function parseOverlaySearch(search: Record<string, unknown>): OverlayEntry | null {
  const id = str(search.id);
  if (!id) return null;
  if (search['command-menu-page'] === 'task') return { type: 'task', id };
  const modal = str(search.modal);
  if (modal === 'record') {
    const object = str(search.object);
    return object ? { type: 'record', record: { entityDefinitionId: object, entityInstanceId: id } } : null;
  }
  if (modal && WINDOW_KINDS.includes(modal)) return { type: 'window', kind: modal as WindowKind, id };
  return null;
}

/** Overlay params for an entry (null = remove them all). */
export function overlayParams(entry: OverlayEntry | null): Record<string, string> {
  if (!entry) return {};
  if (entry.type === 'task') return { 'command-menu-page': 'task', id: entry.id };
  if (entry.type === 'record') {
    return { modal: 'record', id: entry.record.entityInstanceId, object: entry.record.entityDefinitionId };
  }
  return { modal: entry.kind, id: entry.id };
}

/** `searchStr` (with or without "?") with the overlay params replaced by those of `entry`; others are kept. */
export function withOverlayParams(searchStr: string, entry: OverlayEntry | null): string {
  const params = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr);
  for (const key of OVERLAY_PARAMS) params.delete(key);
  for (const [key, value] of Object.entries(overlayParams(entry))) params.set(key, value);
  const out = params.toString();
  return out ? `?${out}` : '';
}

// ---- identity -----------------------------------------------------------------------------------------------

export function sameRecord(a: RecordRef, b: RecordRef): boolean {
  return a.entityInstanceId === b.entityInstanceId && a.entityDefinitionId === b.entityDefinitionId;
}

/**
 * Same overlay as far as the URL can tell. A record overlay from the URL carries the object as given (an id, or an
 * api slug in hand-written links), so records compare by instance id.
 */
export function sameEntry(a: OverlayEntry, b: OverlayEntry): boolean {
  if (a.type === 'record' && b.type === 'record') return a.record.entityInstanceId === b.record.entityInstanceId;
  if (a.type === 'window' && b.type === 'window') return a.kind === b.kind && a.id === b.id;
  if (a.type === 'task' && b.type === 'task') return a.id === b.id;
  return false;
}

export const topOf = (state: OverlayState): OverlayEntry | null => state.stack[state.stack.length - 1] ?? null;

// ---- reconcile with the URL ---------------------------------------------------------------------------------

/**
 * The stack after the URL changed to `entry`: an entry already in the stack becomes the top (layers above it were
 * closed by Back); a new one is pushed above the existing layers; no overlay in the URL closes every layer. A
 * window shown as a modal is never also detached.
 */
export function reconcile(state: OverlayState, entry: OverlayEntry | null): OverlayState {
  if (!entry) return state.stack.length === 0 ? state : { ...state, stack: [] };
  const index = state.stack.findIndex((e) => sameEntry(e, entry));
  if (index >= 0)
    return index === state.stack.length - 1 ? state : { ...state, stack: state.stack.slice(0, index + 1) };
  // Only one layer of each type: a new record replaces the record layer (and everything above it), etc.
  const sameType = state.stack.findIndex((e) => e.type === entry.type);
  const base = sameType >= 0 ? state.stack.slice(0, sameType) : state.stack;
  return {
    stack: [...base, entry],
    detached:
      entry.type === 'window'
        ? state.detached.filter((w) => !(w.kind === entry.kind && w.id === entry.id))
        : state.detached,
  };
}

// ---- operations (the URL follows the new top) -------------------------------------------------------------------

/** Opens an overlay on top (re-opening an existing layer brings it to the top). */
export function openEntry(state: OverlayState, entry: OverlayEntry): OverlayState {
  return reconcile(state, entry);
}

/** Closes one layer (or a detached window). */
export function closeEntry(state: OverlayState, entry: OverlayEntry): OverlayState {
  const stack = state.stack.filter((e) => !sameEntry(e, entry));
  const detached =
    entry.type === 'window'
      ? state.detached.filter((w) => !(w.kind === entry.kind && w.id === entry.id))
      : state.detached;
  return stack.length === state.stack.length && detached.length === state.detached.length ? state : { stack, detached };
}

/** Modal → dock (Minimize), or floating → dock. The window leaves the stack; newest bubbles go last. */
export function detachWindow(state: OverlayState, kind: WindowKind, id: string, mode: DetachedMode): OverlayState {
  const isThis = (w: { kind: WindowKind; id: string }) => w.kind === kind && w.id === id;
  const stack = state.stack.filter((e) => !(e.type === 'window' && isThis(e)));
  // A bubble keeps its place in the dock when only its mode changes; new bubbles go last.
  let detached: DetachedWindow[] = state.detached.some(isThis)
    ? state.detached.map((w) => (isThis(w) ? { ...w, mode } : w))
    : [...state.detached, { kind, id, mode }];
  // One floating panel at a time: floating another sends the current one back to the dock.
  if (mode === 'floating') {
    detached = detached.map((w) => (!isThis(w) && w.mode === 'floating' ? { ...w, mode: 'minimized' } : w));
  }
  return { stack, detached };
}

/** Floating panel or dock bubble → modal again ("Expand"). */
export function expandWindow(state: OverlayState, kind: WindowKind, id: string): OverlayState {
  return reconcile(
    { ...state, detached: state.detached.filter((w) => !(w.kind === kind && w.id === id)) },
    { type: 'window', kind, id },
  );
}

/** Removes every trace of an item (deleted note, deleted template). */
export function forgetWindow(state: OverlayState, kind: WindowKind, id: string): OverlayState {
  return closeEntry(state, { type: 'window', kind, id });
}

// ---- record overlay navigation (K / J) ------------------------------------------------------------------------

export interface SequencePosition {
  index: number;
  total: number;
  previous: RecordRef | null;
  next: RecordRef | null;
}

/** Where `record` sits in its sequence (null when it is not part of one). */
export function sequencePosition(sequence: RecordSequence | undefined, record: RecordRef): SequencePosition | null {
  if (!sequence) return null;
  const index = sequence.records.findIndex((r) => r.entityInstanceId === record.entityInstanceId);
  if (index < 0) return null;
  return {
    index,
    total: sequence.records.length,
    previous: sequence.records[index - 1] ?? null,
    next: sequence.records[index + 1] ?? null,
  };
}

/** Moves the record layer to another record of its sequence (K / J replace-navigate, keeping the sequence). */
export function stepRecord(state: OverlayState, to: RecordRef): OverlayState {
  const index = state.stack.findIndex((e) => e.type === 'record');
  const current = state.stack[index];
  if (!current || current.type !== 'record') return state;
  const stack = state.stack.slice(0, index);
  return { ...state, stack: [...stack, { type: 'record', record: to, sequence: current.sequence }] };
}
