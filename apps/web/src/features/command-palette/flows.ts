// Dialogs the palette launches after it closes ("Add Company", 'Create "x" as record', "Add to list"): one request at
// a time, rendered by <PaletteHost> (CommandPalette.tsx) outside the palette modal.
import { useSyncExternalStore } from 'react';
import type { List } from '../lists/data';

export type PaletteFlow =
  | { kind: 'new-record'; objectId: string; title?: string }
  | { kind: 'add-to-list'; list: List };

let flow: PaletteFlow | null = null;
const listeners = new Set<() => void>();

export function openPaletteFlow(next: PaletteFlow): void {
  flow = next;
  for (const l of listeners) l();
}

export function closePaletteFlow(): void {
  flow = null;
  for (const l of listeners) l();
}

export function usePaletteFlow(): PaletteFlow | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => flow,
    () => null,
  );
}
