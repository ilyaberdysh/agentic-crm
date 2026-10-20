// Help drawer state (system-ui §7): open / closed and the view ("help" or "shortcuts"), one per tab. Opened by `?`,
// the page-header Help buttons and the "Open help drawer" quick action.
import { useSyncExternalStore } from 'react';

export type HelpView = 'help' | 'shortcuts';

export interface HelpState {
  open: boolean;
  view: HelpView;
  /** Bumped on every open so the search field refocuses. */
  nonce: number;
}

let state: HelpState = { open: false, view: 'help', nonce: 0 };
const listeners = new Set<() => void>();

function set(next: HelpState): void {
  state = next;
  for (const l of listeners) l();
}

export function openHelpDrawer(view: HelpView = 'help'): void {
  set({ open: true, view, nonce: state.nonce + 1 });
}

export function setHelpView(view: HelpView): void {
  set({ ...state, view });
}

export function closeHelpDrawer(): void {
  if (state.open) set({ ...state, open: false });
}

export const helpStore = {
  get: (): HelpState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useHelpState(): HelpState {
  return useSyncExternalStore(helpStore.subscribe, helpStore.get, helpStore.get);
}
