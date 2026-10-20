// Content the overlay host renders but does not own. The record page (features/record, S3-RECORD) registers the body
// of the record overlay; email windows will register later. Registration happens at module load of the
// owning feature; the host re-renders when a renderer arrives.
import type { IconGlyph, IconName } from '@agentic-crm/ui';
import type { ComponentType, ReactNode } from 'react';
import type { RecordRef } from './model';

export interface RecordOverlayContentProps {
  record: RecordRef;
  /**
   * The overlay's left top-bar controls: close ×, previous ↑, next ↓  and "n of N in ‹view›". The record page
   * renders it where its breadcrumb would be, followed by its own right-side controls.
   */
  navigation: ReactNode;
  close: () => void;
}

export interface WindowContentProps {
  id: string;
  mode: 'modal' | 'floating';
}

/** What the dock bubble and the window label show for a window (its title and the record it belongs to). */
export interface WindowSummary {
  title: string;
  record: RecordRef | null;
  isMissing: boolean;
}

/** How a window kind is framed and shown in the dock (all optional; the default is the note window's). */
export interface WindowOptions {
  /** Modal frame wraps its content (the content sets the size) instead of the 968 × 670 note frame. */
  fit?: boolean;
  /** Dim the page behind the modal (composer, email and meeting dialogs). */
  dimmed?: boolean;
  /** Dock bubble icon. */
  icon?: IconName | IconGlyph;
  /** Title / record of a window for the dock bubble (a hook: called once per bubble, always for the same kind). */
  useSummary?: (id: string) => WindowSummary;
  /** Fallback bubble title while the summary has none. */
  untitled?: string;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let recordContent: ComponentType<RecordOverlayContentProps> | null = null;
const windowContent = new Map<string, ComponentType<WindowContentProps>>();
const windowOptions = new Map<string, WindowOptions>();

/** S3-RECORD: `registerRecordOverlay(RecordOverlayPage)` once, from features/record. */
export function registerRecordOverlay(component: ComponentType<RecordOverlayContentProps>): void {
  recordContent = component;
  for (const l of listeners) l();
}

/** Window bodies by kind (`email`, `composer`, `meeting`); notes and templates are built in. */
export function registerWindowContent(
  kind: string,
  component: ComponentType<WindowContentProps>,
  options: WindowOptions = {},
): void {
  windowContent.set(kind, component);
  windowOptions.set(kind, options);
  for (const l of listeners) l();
}

export function getWindowOptions(kind: string): WindowOptions {
  return windowOptions.get(kind) ?? {};
}

export function getRecordOverlayContent(): ComponentType<RecordOverlayContentProps> | null {
  return recordContent;
}

export function getWindowContent(kind: string): ComponentType<WindowContentProps> | undefined {
  return windowContent.get(kind);
}

export function subscribeRegistry(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let version = 0;
subscribeRegistry(() => {
  version++;
});
export const registryVersion = () => version;
