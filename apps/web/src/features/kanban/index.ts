// Kanban feature (BACKLOG 4.05, 4.06; C2 kanban.md K1–K9) — boards for object and list kanban views.
//
//   const draft = useViewDraft(viewId);                       // features/views
//   <KanbanProvider definition={objectOrListDefinition} draft={draft}>
//     <KanbanViewSettings onEditAttribute=… onCreateAttribute=… />   // view bar "View settings" for kanban views
//     <KanbanFilterBar draft={draft} onNavigate=… />              // Sort / Filter / Save … + collapse toggles
//     <KanbanBoard definition=… draft={draft} onAddCard=… onEditCard=… addLabel="Add Deal" />
//   </KanbanProvider>
// <KanbanBoard> alone also works (it provides its own state). For a list, `definition` is the list's entry definition
// (entityType `collection-entry`, id = list id); cards are entries titled by their parent record; grouping may go
// through `parent_record`. Server calls live in ./data (kanban.columns / columnChunk / move / timeInStage, views.update).
export { type Kanban, KanbanProvider, useKanban, useKanbanContext } from './context';
export { KanbanBoard, type KanbanBoardProps } from './KanbanBoard';
export { KanbanFilterBar, KanbanToggles } from './KanbanToolbar';
export { KanbanViewSettings, type KanbanViewSettingsProps } from './KanbanViewSettings';
export type { Board, BoardDefinition } from './useBoard';
