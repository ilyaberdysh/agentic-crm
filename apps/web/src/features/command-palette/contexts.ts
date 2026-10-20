// Context actions (command-palette.md §3.2 categories 1–6, §3.3 last paragraph): pages and records register actions
// that appear in the palette while they are mounted, in a section named after the context — the open record page
// ("Add to list", "Add to favorites"…), the focused table row (its record actions). The most recently registered
// context comes first.
import type { IconName } from '@agentic-crm/ui';
import { useEffect, useSyncExternalStore } from 'react';
import type { PaletteView } from './store';

/** What an action may do to the palette when it runs. */
export interface PaletteApi {
  close: () => void;
  push: (view: PaletteView, query?: string) => void;
}

export interface PaletteAction {
  id: string;
  title: string;
  keywords?: readonly string[];
  icon: IconName;
  /** Footer primary button label ("Create", "Open", "Search records"…). */
  gesture: string;
  /** Shortcut hint shown as key caps on the right (engine string: `/`, `t`, `mod+j`). */
  hint?: string;
  /** Tertiary text after the title ("Attio API documentation"). */
  description?: string;
  /** Listed only while the query matches (Attio visibility 0: theme switches, easter eggs). */
  searchOnly?: boolean;
  /** Opens a new tab: shows ↗ after the title. */
  external?: boolean;
  /** Runs the action; the palette closes first unless `keepOpen`. Pages push a view through `api.push`. */
  run: (api: PaletteApi) => void | Promise<void>;
  keepOpen?: boolean;
}

export interface PaletteContext {
  /** Stable id of the context ("record-page", "table-row"). */
  id: string;
  /** Section header (the record's name, "Companies"…). */
  title: string;
  actions: readonly PaletteAction[];
}

let contexts: readonly PaletteContext[] = [];
const listeners = new Set<() => void>();

function set(next: readonly PaletteContext[]): void {
  contexts = next;
  for (const l of listeners) l();
}

/** Registers (or replaces, by id) a context; returns the unregister function. */
export function registerPaletteContext(context: PaletteContext): () => void {
  set([context, ...contexts.filter((c) => c.id !== context.id)]);
  return () => set(contexts.filter((c) => c !== context));
}

export function usePaletteContexts(): readonly PaletteContext[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => contexts,
    () => contexts,
  );
}

/** Registers `context` while the component is mounted (memoise it: it re-registers when the object changes). */
export function usePaletteContext(context: PaletteContext | null): void {
  useEffect(() => (context ? registerPaletteContext(context) : undefined), [context]);
}
