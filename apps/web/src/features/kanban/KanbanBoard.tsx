// <KanbanBoard> renders an object's or list's kanban view.
// <KanbanBoard definition={object | list entry definition} draft={useViewDraft(viewId)} />
// Columns = the grouping attribute's live stages (own status/select, or the parent record's through `parent_record`),
// "No stage" first and "Add stage" last; cards drag between columns with dnd-kit (pointer: 4 px to start; keyboard:
// Space/Enter to pick up, ←/→ between columns, Space/Enter to drop, Esc to cancel; live-region announcements; edge
// auto-scroll; the floating card settles into its new slot). A drop moves the card optimistically to the top of the
// destination (in-column order is not persisted) and writes the stage; the next refetch restores the sorted order.
// Stage headers reorder columns by their ⋮⋮ handle (the attribute's option order). Confetti on celebration stages.
import { rankBetween } from '@agentic-crm/contracts';
import { Button, ErrorState, Icon, toast } from '@agentic-crm/ui';
import {
  type Announcements,
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  defaultDropAnimationSideEffects,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { errorEnvelopeOf } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { NewRecordDialog } from '../attributes';
import { ChooseRecordDialog } from '../notes/ChooseRecordDialog';
import { EmptyIllustration } from '../record/ui/EmptyIllustration';
import type { ViewDraft } from '../views';
import { Card } from './Card';
import { Column, cardDragId, columnDropId } from './Column';
import { type Kanban, KanbanProvider, useKanbanContext } from './context';
import { addListEntry, createStage, stageValueInput, updateStage } from './data';
import { EditCardDialog } from './EditCardDialog';
import * as s from './kanban.css';
import { adjacentColumn, type BoardStage, NO_STAGE, reorderTarget, type StageKey } from './model';
import { STAGE_SWATCHES } from './StageMenu';
import type { Board, BoardDefinition } from './useBoard';

export interface KanbanBoardProps {
  /** The object, or the list's entry definition (entityType `collection-entry`). */
  definition: BoardDefinition;
  draft: ViewDraft;
  /** Header "+" / empty-state add: the list page passes its add-to-list form; objects default to "Create record". */
  onAddCard?: (stage: { stageId: string | null; groupBy: ViewDraft['view']['kanbanPivotPath'] }) => void;
  /** Card pencil: the list page passes its "Edit entry" dialog; default: the built-in edit dialog. */
  onEditCard?: (cardId: string) => void;
  /** "Add {parent singular}" on lists with one parent object; default "New {singular}" / "Add record". */
  addLabel?: string;
  /** "Import CSV" in the empty state. */
  onImport?: () => void;
}

type ActiveDrag =
  | { type: 'card'; cardId: string; column: StageKey; height: number; width: number }
  | { type: 'column'; key: StageKey; height: number };

const INSTRUCTIONS =
  'To pick up a Kanban card or column, press space or enter. Use the arrow keys to move it, then press space or enter to drop it, or escape to cancel.';

const dropAnimation: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0' } } }),
};

const keyOfDropId = (id: UniqueIdentifier | undefined | null): StageKey | null =>
  typeof id === 'string' && id.startsWith('column:') ? id.slice('column:'.length) : null;

/** Only the card itself starts a keyboard drag (Enter on its title link or buttons keeps their meaning). */
class CardKeyboardSensor extends KeyboardSensor {
  static activators = [
    {
      eventName: 'onKeyDown' as const,
      handler: (
        event: ReactKeyboardEvent,
        options: Parameters<(typeof KeyboardSensor.activators)[number]['handler']>[1],
        context: Parameters<(typeof KeyboardSensor.activators)[number]['handler']>[2],
      ) => {
        if (event.target !== event.currentTarget) return false;
        return (KeyboardSensor.activators[0] as (typeof KeyboardSensor.activators)[number]).handler(
          event,
          options,
          context,
        );
      },
    },
  ];
}

export function KanbanBoard(props: KanbanBoardProps) {
  const kanban = useKanbanContext();
  if (kanban) return <BoardView {...props} kanban={kanban} />;
  return (
    <KanbanProvider definition={props.definition} draft={props.draft}>
      <ProvidedBoard {...props} />
    </KanbanProvider>
  );
}

function ProvidedBoard(props: KanbanBoardProps) {
  const kanban = useKanbanContext() as Kanban;
  return <BoardView {...props} kanban={kanban} />;
}

function BoardView({
  definition,
  onAddCard,
  onEditCard,
  addLabel,
  onImport,
  kanban,
}: KanbanBoardProps & { kanban: Kanban }) {
  const { board, prefs } = kanban;
  const [active, setActive] = useState<ActiveDrag | null>(null);
  const [overKey, setOverKey] = useState<StageKey | null>(null);
  const [creating, setCreating] = useState<BoardStage | null>(null);
  const [choosing, setChoosing] = useState<BoardStage | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const isList = definition.entityType === 'collection-entry';
  const label = addLabel ?? (isList ? 'Add record' : `New ${definition.singularNoun}`);
  const order = useMemo(() => board.columns.map((c) => c.key), [board.columns]);
  const orderRef = useRef(order);
  orderRef.current = order;
  const boardRef = useRef(board);
  boardRef.current = board;

  // ---- sensors ----------------------------------------------------------------------------------------------------
  const coordinateGetter = useCallback<KeyboardCoordinateGetter>((event, { context }) => {
    const { active: a, over, collisionRect, droppableRects } = context;
    if (!a || !collisionRect) return undefined;
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') {
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') event.preventDefault();
      return undefined;
    }
    const data = a.data.current as { type: string; column?: StageKey; key?: StageKey } | undefined;
    const currentKey = keyOfDropId(over?.id) ?? data?.column ?? data?.key ?? null;
    if (!currentKey) return undefined;
    let next = adjacentColumn(orderRef.current, currentKey, event.code);
    if (data?.type === 'column' && next === NO_STAGE) next = null;
    if (!next) return undefined;
    const rect = droppableRects.get(columnDropId(next));
    if (!rect) return undefined;
    event.preventDefault();
    return {
      x: rect.left + rect.width / 2 - collisionRect.width / 2,
      y: data?.type === 'column' ? rect.top : rect.top + 52,
    };
  }, []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(CardKeyboardSensor, { coordinateGetter }),
  );

  const collision = useCallback<CollisionDetection>((args) => {
    const type = (args.active.data.current as { type?: string } | undefined)?.type;
    const targets = args.droppableContainers.filter((c) => {
      const key = keyOfDropId(c.id);
      return key !== null && !(type === 'column' && key === NO_STAGE);
    });
    const within = pointerWithin({ ...args, droppableContainers: targets });
    return within.length > 0 ? within : closestCenter({ ...args, droppableContainers: targets });
  }, []);

  // ---- announcements (K8 live region) --------------------------------------------------------------------------------
  const titleOf = (key: StageKey | null) => (key ? (boardRef.current.stageByKey.get(key)?.title ?? 'No stage') : '');
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => {
      const d = a.data.current as { type: string; column?: StageKey; key?: StageKey };
      return d.type === 'card'
        ? `Picked up card from ${titleOf(d.column ?? null)}.`
        : `Picked up column ${titleOf(d.key ?? null)}.`;
    },
    onDragOver: ({ active: a, over }) => {
      const d = a.data.current as { type: string };
      const key = keyOfDropId(over?.id);
      if (!key) return undefined;
      return d.type === 'card' ? `Card is over ${titleOf(key)}.` : `Column is over ${titleOf(key)}.`;
    },
    onDragEnd: ({ active: a, over }) => {
      const d = a.data.current as { type: string; key?: StageKey };
      const key = keyOfDropId(over?.id);
      if (d.type === 'card') return key ? `Dropped card in ${titleOf(key)}.` : 'Cancelled dragging card.';
      return key ? `Dropped column ${titleOf(d.key ?? null)} over ${titleOf(key)}.` : 'Cancelled dragging column.';
    },
    onDragCancel: ({ active: a }) =>
      (a.data.current as { type: string }).type === 'card' ? 'Cancelled dragging card.' : 'Cancelled dragging column.',
  };

  // ---- drag handlers ------------------------------------------------------------------------------------------------------
  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as { type: string; cardId?: string; column?: StageKey; key?: StageKey };
    const rect = e.active.rect.current.initial;
    if (d.type === 'card' && d.cardId && d.column)
      setActive({
        type: 'card',
        cardId: d.cardId,
        column: d.column,
        height: rect?.height ?? 74,
        width: rect?.width ?? 246,
      });
    else if (d.type === 'column' && d.key) setActive({ type: 'column', key: d.key, height: rect?.height ?? 36 });
    setOverKey(null);
  };
  const onDragOver = (e: DragOverEvent) => setOverKey(keyOfDropId(e.over?.id));
  const onDragEnd = (e: DragEndEvent) => {
    const current = active;
    setActive(null);
    setOverKey(null);
    const to = keyOfDropId(e.over?.id);
    if (!current || !to) return;
    if (current.type === 'card') {
      if (to === current.column) return;
      const ids = board.selection.has(current.cardId) ? [...board.selection] : [current.cardId];
      board.move(ids, to);
      if (ids.length > 1) board.clearSelection();
      return;
    }
    const target = reorderTarget(order, current.key, to);
    const attribute = board.groupAttribute;
    if (!target || !attribute) return;
    const rankOf = (key: StageKey | null) => (key ? (board.stageByKey.get(key)?.sortOrder ?? null) : null);
    let sortOrder: string;
    try {
      sortOrder = rankBetween(rankOf(target.before), rankOf(target.after), { jitter: true });
    } catch {
      return;
    }
    updateStage(board.workspace, attribute, current.key, { sortOrder }).catch((error) =>
      toast.error({ title: 'Failed to move stage', description: errorEnvelopeOf(error).message }),
    );
  };
  const onDragCancel = () => {
    setActive(null);
    setOverKey(null);
  };

  // ---- add / edit ---------------------------------------------------------------------------------------------------------
  const groupBy = board.groupBy;
  const ownStage = Boolean(groupBy && groupBy.length === 1);
  const addCard = useCallback(
    (stage: BoardStage) => {
      if (onAddCard) onAddCard({ stageId: stage.id, groupBy });
      else if (isList) setChoosing(stage);
      else setCreating(stage);
    },
    [onAddCard, groupBy, isList],
  );
  const editCard = useCallback(
    (cardId: string) => (onEditCard ? onEditCard(cardId) : setEditing(cardId)),
    [onEditCard],
  );

  // ---- render -------------------------------------------------------------------------------------------------------------
  if (!groupBy || (board.schema && !board.groupAttribute)) {
    return (
      <div className={s.boardRoot}>
        <div className={s.emptyState}>
          <Icon icon="kanban" size={24} />
          <h3 className={s.emptyTitle}>Choose status attribute</h3>
          <p className={s.emptyText}>
            Which status attribute would you like to use for this kanban view? Your records will be grouped based on
            this attribute.
          </p>
        </div>
      </div>
    );
  }
  if (board.error && board.isLoading === false && Object.values(board.data).every((c) => !c.page)) {
    return (
      <div className={s.boardRoot}>
        <ErrorState
          message={errorEnvelopeOf(board.error).message ?? "Couldn't load this board"}
          actions={
            <Button variant="secondary" size={28} onPress={board.refresh}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const allCollapsed = board.columns.length > 0 && board.columns.every((c) => prefs.isCollapsed(c.key));
  const emptyBoard = board.isEmpty;
  return (
    <div className={s.boardRoot} data-testid="kanban-board" data-view-id={board.view.id}>
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
        autoScroll={{ threshold: { x: 0.12, y: 0.15 }, acceleration: 14 }}
        accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div
          className={s.boardScroller}
          data-testid="kanban-scroller"
          style={emptyBoard ? { display: 'flex', flexDirection: 'column' } : undefined}
        >
          <div className={`${s.boardRow}${emptyBoard ? ` ${s.boardRowEmpty}` : ''}`} style={{ position: 'relative' }}>
            {board.columns.map((stage) => (
              <Column
                key={stage.key}
                board={board}
                stage={stage}
                prefs={prefs}
                draggingCardId={active?.type === 'card' ? active.cardId : null}
                draggingHeight={active?.type === 'card' ? active.height : 0}
                isDropTarget={
                  overKey === stage.key &&
                  active !== null &&
                  (active.type === 'card' ? active.column !== stage.key : active.key !== stage.key)
                }
                isColumnDragging={active?.type === 'column' && active.key === stage.key}
                addLabel={label}
                onAddCard={addCard}
                onEditCard={editCard}
                emptyBoard={emptyBoard}
                hideFooter={emptyBoard}
              />
            ))}
            {board.groupAttribute && <AddStage board={board} compact={allCollapsed} />}
            {emptyBoard && <div className={s.emptyFade} />}
          </div>
          {emptyBoard && (
            <div className={s.emptyState} data-testid="kanban-empty">
              <EmptyIllustration icon="record" />
              <h3 className={s.emptyTitle}>No records yet</h3>
              <p className={s.emptyText}>Create a record to get started with this view.</p>
              <div className={s.emptyActions}>
                {onImport && (
                  <Button variant="secondary" size={28} icon="upload" onPress={onImport}>
                    Import CSV
                  </Button>
                )}
                <Button
                  variant="primary"
                  size={28}
                  icon="add"
                  onPress={() => {
                    const first = board.columns.find((c) => c.key !== NO_STAGE);
                    if (first) addCard(first);
                  }}
                >
                  {label}
                </Button>
              </div>
            </div>
          )}
        </div>
        {createPortal(
          <DragOverlay dropAnimation={dropAnimation} zIndex={2000}>
            {active?.type === 'card' ? (
              <div style={{ width: active.width }}>
                <Card
                  board={board}
                  cardId={active.cardId}
                  column={board.stageByKey.get(active.column) ?? (board.columns[0] as BoardStage)}
                  overlay
                  collapsed={prefs.cardMode === 'collapsed'}
                  hideEmpty={prefs.hideEmpty}
                />
                {board.selection.has(active.cardId) && board.selection.size > 1 && (
                  <span
                    className={s.countPill}
                    style={{ position: 'absolute', top: -8, right: -8, height: 20, minWidth: 20 }}
                  >
                    {board.selection.size}
                  </span>
                )}
              </div>
            ) : active?.type === 'column' ? (
              <ColumnGhost board={board} stageKey={active.key} />
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      {board.selection.size > 0 && <SelectionBar board={board} />}
      {creating && board.groupAttribute && (
        <NewRecordDialog
          entityDefinitionId={definition.id}
          onClose={() => setCreating(null)}
          onCreated={() => board.refresh()}
          navigateOnCreate={false}
          initialValues={
            ownStage && creating.id && board.groupKind
              ? { [board.groupAttribute.id]: [{ value: stageValueInput(board.groupKind, creating.id) }] }
              : undefined
          }
        />
      )}
      {choosing && groupBy && board.groupKind && (
        <ChooseRecordDialog
          title={label}
          onClose={() => setChoosing(null)}
          onPick={(record) => {
            const stage = choosing;
            setChoosing(null);
            addListEntry(board.workspace, definition.id, record, {
              groupBy,
              kind: board.groupKind ?? 'pipeline',
              stageId: stage.id,
            })
              .then(() => board.refresh())
              .catch((error) =>
                toast.error({ title: 'Failed to add to list', description: errorEnvelopeOf(error).message }),
              );
          }}
        />
      )}
      {editing && <EditCardDialog board={board} cardId={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ColumnGhost({ board, stageKey }: { board: Board; stageKey: StageKey }) {
  const stage = board.stageByKey.get(stageKey);
  if (!stage) return null;
  return (
    <div className={s.column} style={{ width: 268, height: 120, boxShadow: 'var(--ar-elevation-e2)' }}>
      <div className={s.header}>
        <span className={s.headerTitle}>{stage.title}</span>
        <span className={s.countPill} style={{ marginLeft: 6 }}>
          {board.data[stageKey]?.total ?? 0}
        </span>
      </div>
    </div>
  );
}

/** "Add stage" after the last column: an inline draft column with "New stage name". */
function AddStage({ board, compact }: { board: Board; compact: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attribute = board.groupAttribute;
  const submit = () => {
    if (draft === null || !attribute) return;
    const title = draft.trim();
    if (!title) {
      setError('Stage name is required');
      return;
    }
    if (board.stages.some((st) => st.title.toLowerCase() === title.toLowerCase())) {
      setError('This name is already in use');
      return;
    }
    const last = board.stages[board.stages.length - 1];
    let sortOrder: string | undefined;
    try {
      sortOrder = rankBetween(last?.sortOrder ?? null, null, { jitter: true });
    } catch {
      sortOrder = undefined;
    }
    const used = new Set(board.stages.map((st) => st.color));
    const swatches =
      attribute.type === 'pipeline' ? STAGE_SWATCHES : STAGE_SWATCHES.map((c) => c.replace('block_', 'pastel_'));
    const color = swatches.find((c) => !used.has(c)) ?? (swatches[0] as string);
    setDraft(null);
    setError(null);
    createStage(board.workspace, attribute, { id: newId(), title, color, ...(sortOrder ? { sortOrder } : {}) }).catch(
      (e) =>
        toast.error({
          title: attribute.type === 'pipeline' ? 'Failed to create pipeline stage' : 'Failed to create option',
          description: errorEnvelopeOf(e).message,
        }),
    );
  };
  if (draft === null) {
    return (
      <button
        type="button"
        className={s.addStage}
        aria-label="Add stage"
        data-testid="kanban-add-stage"
        style={compact ? undefined : { marginTop: 0 }}
        onClick={() => setDraft('')}
      >
        <Icon icon="add" size={16} />
      </button>
    );
  }
  return (
    <div className={`${s.column} ${s.addStageColumn}`} style={{ width: 268, flex: 'none' }}>
      <input
        className={s.stageInput}
        placeholder="New stage name"
        aria-label="New stage name"
        data-invalid={error ? '' : undefined}
        autoFocus
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setDraft(null);
            setError(null);
          }
        }}
        onBlur={() => {
          if (!draft.trim()) {
            setDraft(null);
            setError(null);
          }
        }}
      />
      {error && <span className={s.stageError}>{error}</span>}
    </div>
  );
}

/** Selected cards (hover checkbox, shift-click ranges): count, move hint, clear (bulk actions bar). */
function SelectionBar({ board }: { board: Board }) {
  return (
    <div className={s.bulkBar} role="toolbar" aria-label="Selected cards" data-testid="kanban-selection-bar">
      <span>{board.selection.size} selected</span>
      <button type="button" className={s.bulkButton} onClick={board.clearSelection}>
        <Icon icon="close" size={14} />
        Clear
      </button>
    </div>
  );
}
