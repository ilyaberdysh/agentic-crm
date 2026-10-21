// Palette state: one per tab, outside React so any feature can open it. The modal is a
// stack of pages ("Mimir" pages): the root Quick actions page, the Search records page and the pages pushed from them
// (Note templates, Choose record, Choose list, Upcoming meetings, Choose object). The stack remembers each page's
// query and highlight while the user navigates back.
import { useSyncExternalStore } from 'react';

export type PaletteView =
  | { id: 'root' }
  | { id: 'search' }
  | { id: 'note-templates' }
  | { id: 'choose-record-for-note' }
  | { id: 'choose-list' }
  | { id: 'upcoming-meetings' }
  /** Choose the object for a new record; `title` prefills the record's name. */
  | { id: 'choose-object'; title: string };

export type PaletteViewId = PaletteView['id'];

export interface PalettePage {
  view: PaletteView;
  query: string;
  /** Key of the highlighted row (null = the first one). */
  highlightKey: string | null;
}

export interface PaletteState {
  open: boolean;
  stack: PalettePage[];
  /** Bumped on every open: focus and animations restart. */
  nonce: number;
}

const page = (view: PaletteView, query = ''): PalettePage => ({ view, query, highlightKey: null });

let state: PaletteState = { open: false, stack: [page({ id: 'root' })], nonce: 0 };
const listeners = new Set<() => void>();

function set(next: PaletteState): void {
  state = next;
  for (const l of listeners) l();
}

export const paletteStore = {
  get: (): PaletteState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function usePaletteState(): PaletteState {
  return useSyncExternalStore(paletteStore.subscribe, paletteStore.get, paletteStore.get);
}

/** The page on top of the stack. */
export function topPage(s: PaletteState = state): PalettePage {
  return s.stack[s.stack.length - 1] as PalettePage;
}

/** ⌘K, the sidebar Search button, the help drawer card: Quick actions on a fresh stack. */
export function openQuickActions(): void {
  set({ open: true, stack: [page({ id: 'root' })], nonce: state.nonce + 1 });
}

/** `/`: the Search records modal (optionally prefilled — the `/search?q=` redirect). */
export function openSearch(query = ''): void {
  set({ open: true, stack: [page({ id: 'search' }, query)], nonce: state.nonce + 1 });
}

/** Opens one page directly (`e` → Choose list): no Quick actions underneath. */
export function openPaletteView(view: PaletteView): void {
  set({ open: true, stack: [page(view)], nonce: state.nonce + 1 });
}

export function closePalette(): void {
  if (!state.open) return;
  set({ ...state, open: false });
}

/** Pushes a page above the current one (the current page keeps its query and highlight). */
export function pushPage(view: PaletteView, query = ''): void {
  set({ ...state, stack: [...state.stack, page(view, query)] });
}

/** Back: pops the top page; the root page closes the palette. */
export function popPage(): void {
  if (state.stack.length <= 1) closePalette();
  else set({ ...state, stack: state.stack.slice(0, -1) });
}

/** Back to the page at `index` of the stack (breadcrumb click). */
export function popToPage(index: number): void {
  if (index < 0 || index >= state.stack.length - 1) return;
  set({ ...state, stack: state.stack.slice(0, index + 1) });
}

function updateTop(patch: Partial<PalettePage>): void {
  const stack = state.stack.slice();
  const top = stack[stack.length - 1] as PalettePage;
  stack[stack.length - 1] = { ...top, ...patch };
  set({ ...state, stack });
}

export function setQuery(query: string): void {
  // A new query restarts the highlight at the first row.
  updateTop({ query, highlightKey: null });
}

export function setHighlightKey(highlightKey: string | null): void {
  updateTop({ highlightKey });
}

/**
 * ⌘K while the palette is open: the frame may claim it (open the Actions menu of the highlighted record);
 * otherwise it closes the modal.
 */
let modKClaim: (() => boolean) | null = null;
export function claimModK(handler: (() => boolean) | null): void {
  modKClaim = handler;
}

export function toggleQuickActions(): void {
  if (!state.open) {
    openQuickActions();
    return;
  }
  if (modKClaim?.()) return;
  closePalette();
}

// Dev builds: the store on window for e2e and manual checks.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __palette: unknown }).__palette = paletteStore;
}
