// Mounted once in the app shell (E4). Keeps the overlay store and the URL in step (B system-ui §4: overlays open on
// top of any path via `?modal=…&id=…` / `?command-menu-page=task&id=…`; closing removes the params) and renders the
// layers: record overlay, note / template modal, edit-task dialog, the floating panel and the dock.
import { useRouter, useRouterState } from '@tanstack/react-router';
import { type ComponentType, useEffect, useSyncExternalStore } from 'react';
import { openComposer } from '../composer/open';
import { NewNoteHost, openNewNote } from '../notes/NewNote';
import { NoteWindow } from '../notes/NoteWindow';
import { TemplateWindow } from '../notes/TemplateWindow';
import { useAction } from '../shortcuts/catalog';
import { CreateTaskHost, EditTaskDialog, openCreateTask } from '../tasks/TaskDialog';
import { Dock } from './Dock';
import { type OverlayEntry, parseOverlaySearch, type WindowKind, withOverlayParams } from './model';
import { RecordOverlayLayer } from './RecordOverlay';
import {
  getWindowContent,
  getWindowOptions,
  registryVersion,
  subscribeRegistry,
  type WindowContentProps,
} from './registry';
import { closeOverlay, openNote, openRecordOverlay, overlayStore, useOverlayState } from './store';
import { FloatingWindowShell, ModalWindowShell } from './WindowShell';

const BUILT_IN: Partial<Record<WindowKind, ComponentType<WindowContentProps>>> = {
  note: NoteWindow,
  'note-template': TemplateWindow,
};

function windowContent(kind: WindowKind): ComponentType<WindowContentProps> | undefined {
  return BUILT_IN[kind] ?? getWindowContent(kind);
}

const WINDOW_LABEL: Record<WindowKind, string> = {
  note: 'Note',
  'note-template': 'Note template',
  email: 'View email',
  composer: 'Compose email',
  meeting: 'Meeting',
};

function Layer({ entry, isTop }: { entry: OverlayEntry; isTop: boolean }) {
  if (entry.type === 'record') return <RecordOverlayLayer entry={entry} isTop={isTop} />;
  if (entry.type === 'task') return <EditTaskDialog taskId={entry.id} onClose={() => closeOverlay(entry)} />;
  const Content = windowContent(entry.kind);
  if (!Content) return null;
  const options = getWindowOptions(entry.kind);
  return (
    <ModalWindowShell
      label={WINDOW_LABEL[entry.kind]}
      isTop={isTop}
      fit={options.fit}
      dimmed={options.dimmed}
      onClose={() => closeOverlay(entry)}
    >
      <Content id={entry.id} mode="modal" />
    </ModalWindowShell>
  );
}

// Dev builds: the E4 API on window for e2e and manual checks (the record page wires the real triggers).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __overlays: unknown }).__overlays = { openRecordOverlay, openNote, store: overlayStore };
}

export function OverlayHost() {
  const router = useRouter();
  const search = useRouterState({ select: (st) => st.location.search }) as unknown as Record<string, unknown>;
  const state = useOverlayState();
  useSyncExternalStore(subscribeRegistry, registryVersion, registryVersion);

  useEffect(() => {
    overlayStore.setNavigator((entry, { replace }) => {
      const location = router.state.location;
      const href = `${location.pathname}${withOverlayParams(location.searchStr, entry)}${location.hash ? `#${location.hash}` : ''}`;
      void router.navigate({ href, replace });
    });
    return () => overlayStore.setNavigator(null);
  }, [router]);

  const fromUrl = parseOverlaySearch(search);
  const urlKey = JSON.stringify(fromUrl);
  useEffect(() => {
    overlayStore.syncFromUrl(fromUrl);
  }, [urlKey]);

  // `n` new note (Choose record outside a record page) and `t` new task (E README §3.4); a record page binds its own
  // `n` / `t` later and wins (last mounted).
  useAction('new-note', () => openNewNote());
  useAction('new-task', () => openCreateTask());
  // `c` Create a new email (F composer §1): a record page binds its own and wins (last mounted).
  useAction('new-email', () => openComposer());

  const floating = state.detached.find((w) => w.mode === 'floating');
  const FloatingContent = floating ? windowContent(floating.kind) : undefined;
  return (
    <>
      {state.stack.map((entry, i) => (
        <Layer
          key={entry.type === 'window' ? `window:${entry.kind}:${entry.id}` : entry.type}
          entry={entry}
          isTop={i === state.stack.length - 1}
        />
      ))}
      {floating && FloatingContent && (
        <FloatingWindowShell label={WINDOW_LABEL[floating.kind]}>
          <FloatingContent key={floating.id} id={floating.id} mode="floating" />
        </FloatingWindowShell>
      )}
      <Dock windows={state.detached} />
      <CreateTaskHost />
      <NewNoteHost />
    </>
  );
}
