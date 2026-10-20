// Registers the composer with the overlay host at module load: the window body (modal / pinned), its dock bubble
// (the draft's subject as the tooltip) and the session wiring behind `openComposer`.
import type { WindowSummary } from '../overlays';
import { registerWindowContent } from '../overlays';
import { ComposerWindow } from './ComposerWindow';
import { useDraft } from './data';
import { ComposeGlyph } from './glyphs';
import { setComposerStarter } from './open';
import { ensureSession, useDraftSubject, watchOverlays } from './sessions';

function useComposerSummary(id: string): WindowSummary {
  const live = useDraftSubject(id);
  // Without a live session (reloaded page, bubble restored from the session) the title comes from the server.
  const stored = useDraft(live ? null : id);
  const title = live || stored.data?.subject.text || '';
  return { title, record: null, isMissing: stored.isError };
}

registerWindowContent('composer', ComposerWindow, {
  fit: true,
  dimmed: true,
  icon: ComposeGlyph,
  untitled: 'New email',
  useSummary: useComposerSummary,
});
setComposerStarter((id, seed) => {
  ensureSession(id, seed);
});
watchOverlays();
