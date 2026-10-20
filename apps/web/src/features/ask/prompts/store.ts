// Which prompts modal is open (BACKLOG 10.03): the "Browse prompts" gallery (with a curated prompt's detail), the "Create
// prompt" dialog (Generate / Advanced) and "Edit prompt". Opened from the composer's Insert prompt menu, Settings →
// Ask AI → Prompts and the gallery itself; the modals are mounted once by PromptsHost.
import { useSyncExternalStore } from 'react';

export type PromptsModal =
  | { kind: 'gallery'; promptId: string | null }
  | { kind: 'create' }
  | { kind: 'edit'; promptId: string };

let state: PromptsModal | null = null;
const listeners = new Set<() => void>();

function set(next: PromptsModal | null): void {
  state = next;
  for (const l of listeners) l();
}

export const promptsUi = {
  get: (): PromptsModal | null => state,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const usePromptsModal = (): PromptsModal | null =>
  useSyncExternalStore(promptsUi.subscribe, promptsUi.get, promptsUi.get);

export const openPromptsGallery = (promptId: string | null = null): void => set({ kind: 'gallery', promptId });
export const openCreatePrompt = (): void => set({ kind: 'create' });
export const openEditPrompt = (promptId: string): void => set({ kind: 'edit', promptId });
export const closePromptsModal = (): void => set(null);
