// The command palette host, mounted once per workspace layout: the global shortcuts (⌘K,
// `/`, `e`), the frosted modal with the page on top of the stack, and the dialogs the palette launches when it closes.
import { Modal } from '@agentic-crm/ui';
import { NewRecordDialog } from '../attributes';
import { AddRecordFlow } from '../lists';
import { useAction } from '../shortcuts/catalog';
import { closePaletteFlow, usePaletteFlow } from './flows';
import {
  ChooseListPage,
  ChooseObjectPage,
  ChooseRecordPage,
  NoteTemplatesPage,
  RootPage,
  SearchPage,
  UpcomingMeetingsPage,
} from './pages';
import * as s from './palette.css';
import {
  closePalette,
  openPaletteView,
  openQuickActions,
  openSearch,
  type PaletteState,
  toggleQuickActions,
  topPage,
  usePaletteState,
} from './store';

function PaletteContent({ state }: { state: PaletteState }) {
  const page = topPage(state);
  const nested = state.stack.length > 1;
  const view = page.view;
  switch (view.id) {
    case 'root':
      return <RootPage page={page} />;
    case 'search':
      return <SearchPage page={page} nested={nested} />;
    case 'note-templates':
      return <NoteTemplatesPage page={page} />;
    case 'choose-record-for-note':
      return <ChooseRecordPage page={page} />;
    case 'choose-list':
      return <ChooseListPage page={page} nested={nested} />;
    case 'upcoming-meetings':
      return <UpcomingMeetingsPage page={page} />;
    case 'choose-object':
      return <ChooseObjectPage page={page} title={view.title} />;
  }
}

const TALL = new Set(['root', 'search', 'choose-record-for-note']);

function Flows() {
  const flow = usePaletteFlow();
  if (!flow) return null;
  if (flow.kind === 'new-record') {
    return (
      <NewRecordDialog
        key={flow.objectId + (flow.title ?? '')}
        entityDefinitionId={flow.objectId}
        initialTitle={flow.title}
        onClose={closePaletteFlow}
      />
    );
  }
  return <AddRecordFlow key={flow.list.id} list={flow.list} onClose={closePaletteFlow} />;
}

export function PaletteHost() {
  const state = usePaletteState();
  useAction('quick-actions', () => toggleQuickActions());
  useAction('search', () => openSearch());
  useAction('new-entry', () => openPaletteView({ id: 'choose-list' }));
  const page = topPage(state);
  return (
    <>
      <Modal
        isOpen={state.open}
        onOpenChange={(open) => !open && closePalette()}
        // Quick actions and Search are 748 px (frame included); the single-pane pages pushed from them are wider
        // (the capture of Note templates measures ≈ 806 px, the size of the create dialogs).
        size={TALL.has(page.view.id) ? 'palette' : 'large'}
        aria-label={page.view.id === 'search' ? 'Search records' : 'Quick actions'}
        isKeyboardDismissDisabled
        className={TALL.has(page.view.id) ? s.panelTall : s.panelAuto}
      >
        <PaletteContent state={state} />
      </Modal>
      <Flows />
    </>
  );
}

export { openQuickActions };
