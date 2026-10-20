// One board state per page: the view bar's "View settings", the filter bar's collapse toggles and the board itself
// read the same controller (config writes, per-browser prefs, selection), provided by <KanbanProvider>.
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { ViewDraft } from '../views';
import { type BoardPrefs, useBoardPrefs } from './prefs';
import { type Board, type BoardDefinition, useBoard } from './useBoard';

export interface Kanban {
  board: Board;
  prefs: BoardPrefs;
}

const KanbanContext = createContext<Kanban | null>(null);

export function useKanban(definition: BoardDefinition, draft: ViewDraft): Kanban {
  const board = useBoard(definition, draft);
  const prefs = useBoardPrefs(board.workspace.id, board.view.id);
  return useMemo(() => ({ board, prefs }), [board, prefs]);
}

/** Provides the board of a kanban view to <KanbanViewSettings>, <KanbanToggles> and <KanbanBoard> below it. */
export function KanbanProvider({
  definition,
  draft,
  children,
}: {
  definition: BoardDefinition;
  draft: ViewDraft;
  children: ReactNode;
}) {
  const kanban = useKanban(definition, draft);
  return <KanbanContext.Provider value={kanban}>{children}</KanbanContext.Provider>;
}

export function useKanbanContext(): Kanban | null {
  return useContext(KanbanContext);
}
