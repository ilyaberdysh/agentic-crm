// Kanban board icons (slice 4, C2 kanban.md K2–K8): stage menu, board toggles and card footer → Lucide glyphs.
// Kept in their own map (spread into iconMap) so parallel slices add icons without touching the same lines.
import {
  AlignJustify,
  Columns2,
  FoldHorizontal,
  MessagesSquare,
  PartyPopper,
  Square,
  Tally3,
  UnfoldHorizontal,
} from 'lucide-react';
import type { IconGlyph } from './types';

export const kanbanIconMap = {
  /** Stage menu "Confetti" switch. */
  confetti: PartyPopper,
  /** Stage menu "Collapse stage". */
  collapseStage: FoldHorizontal,
  expandStage: UnfoldHorizontal,
  /** Board toggles: "Collapse columns" / "Expand columns", "Collapse cards" / "Expand cards". */
  columnsCollapsed: Tally3,
  columnsExpanded: Columns2,
  cardsCollapsed: AlignJustify,
  cardsExpanded: Square,
  /** Card footer comment counter (two bubbles). */
  comments: MessagesSquare,
} satisfies Record<string, IconGlyph>;
