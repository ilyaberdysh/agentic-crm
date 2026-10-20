// A board column: 268 px, header (stage dot, title
// opening the stage menu, count, "+" add card, ⋮⋮ reorder handle — "No stage" has neither), virtualised cards
// (TanStack Virtual with measured heights; more ids load in chunks near the end), and the calculation line. Collapsed:
// a 52 px strip (dot, count, title rotated), double-click expands.
import { Icon, StatusDot, Tooltip } from '@agentic-crm/ui';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useEntityAccess } from '../access/useEntityAccess';
import { CalculationFooter } from './CalculationFooter';
import { Card } from './Card';
import * as s from './kanban.css';
import { type BoardStage, NO_STAGE } from './model';
import type { BoardPrefs } from './prefs';
import { StageMenu } from './StageMenu';
import type { Board } from './useBoard';

export interface ColumnProps {
  board: Board;
  stage: BoardStage;
  prefs: BoardPrefs;
  /** Id of the card being dragged (its slot shows the placeholder). */
  draggingCardId: string | null;
  draggingHeight: number;
  isDropTarget: boolean;
  isColumnDragging: boolean;
  addLabel: string;
  onAddCard(stage: BoardStage): void;
  onEditCard(cardId: string): void;
  /** Empty board: short column with a dashed "+ Add …" (evidence kanban-empty-list.png). */
  emptyBoard: boolean;
  hideFooter: boolean;
}

export const columnDropId = (key: string) => `column:${key}`;
export const cardDragId = (cardId: string) => `card:${cardId}`;
export const columnDragId = (key: string) => `column-handle:${key}`;

export const Column = memo(function Column(props: ColumnProps) {
  const { board, stage, prefs } = props;
  const collapsed = prefs.isCollapsed(stage.key);
  const { setNodeRef } = useDroppable({ id: columnDropId(stage.key), data: { type: 'column', key: stage.key } });
  const data = board.data[stage.key];
  const total = data?.total ?? 0;

  if (collapsed) {
    return (
      <div className={`${s.stack} ${s.stackCollapsed}`} data-testid="kanban-column" data-stage={stage.key}>
        <button
          ref={setNodeRef}
          type="button"
          className={s.strip}
          data-drop-target={props.isDropTarget || undefined}
          aria-label={`${total} ${stage.title}`}
          title="Double-click to expand"
          onDoubleClick={() => prefs.setCollapsed(stage.key, false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              prefs.setCollapsed(stage.key, false);
            }
          }}
        >
          <span className={s.dotSlot}>
            {stage.key === NO_STAGE ? <span className={s.hollowDot} /> : <StatusDot color={stage.color} size={10} />}
          </span>
          <span className={s.countPill} style={{ marginLeft: 0 }}>
            {total}
          </span>
          <span className={s.stripTitle}>{stage.title}</span>
        </button>
        {/* Strips end where columns do; collapsed columns have no calculation line. */}
        {!props.hideFooter && <div className={s.footer} />}
      </div>
    );
  }

  return (
    <div className={s.stack} data-testid="kanban-column" data-stage={stage.key}>
      <section
        ref={setNodeRef}
        className={s.column}
        aria-label={stage.title}
        data-drop-target={props.isDropTarget || undefined}
        data-column-dragging={props.isColumnDragging || undefined}
      >
        <ColumnHeader {...props} total={total} />
        <ColumnBody {...props} />
      </section>
      {!props.hideFooter && <CalculationFooter board={board} page={data?.page} />}
    </div>
  );
});

function ColumnHeader({ board, stage, prefs, addLabel, onAddCard, total }: ColumnProps & { total: number }) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const isNoStage = stage.key === NO_STAGE;
  const canCreate = useEntityAccess(board.definition.id).canCreateRecords;
  const handle = useDraggable({
    id: columnDragId(stage.key),
    data: { type: 'column', key: stage.key },
    disabled: isNoStage,
  });
  return (
    <div ref={headerRef} className={s.header} data-testid="kanban-column-header">
      <AriaButton
        className={s.headerTitleButton}
        aria-label={`${stage.title} stage options`}
        onPress={() => setMenuOpen(true)}
      >
        <span className={s.dotSlot}>
          {isNoStage ? <span className={s.hollowDot} /> : <StatusDot color={stage.color} size={10} />}
        </span>
        <span className={s.headerTitle}>{stage.title}</span>
      </AriaButton>
      <span className={s.countPill} style={{ marginLeft: 2 }} data-testid="kanban-column-count">
        {total}
      </span>
      {!isNoStage && (
        <span className={s.headerActions}>
          {canCreate && (
            <Tooltip content={addLabel}>
              <AriaButton className={s.iconAction} aria-label={addLabel} onPress={() => onAddCard(stage)}>
                <Icon icon="add" size={16} />
              </AriaButton>
            </Tooltip>
          )}
          <button
            ref={handle.setNodeRef}
            type="button"
            className={s.dragHandle}
            aria-label={`Reorder ${stage.title}`}
            {...handle.attributes}
            {...handle.listeners}
          >
            <Icon icon="drag" size={14} />
          </button>
        </span>
      )}
      <StageMenu
        workspace={board.workspace}
        attribute={board.groupAttribute}
        stage={stage}
        stages={board.stages}
        triggerRef={headerRef}
        isOpen={menuOpen}
        onOpenChange={setMenuOpen}
        onCollapse={() => prefs.setCollapsed(stage.key, true)}
        onHide={() => {
          if (isNoStage) void board.saveConfig({ noStatusVisible: false });
          else void board.saveConfig({ hiddenStageIds: [...board.config.hiddenStageIds, stage.key] });
        }}
      />
    </div>
  );
}

const ESTIMATE_COLLAPSED = 40;
const ESTIMATE_BASE = 74;
const ESTIMATE_ROW = 28;
const ESTIMATE_LABELLED_ROW = 52;

function ColumnBody({
  board,
  stage,
  prefs,
  draggingCardId,
  draggingHeight,
  onEditCard,
  emptyBoard,
  addLabel,
  onAddCard,
}: ColumnProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canCreate = useEntityAccess(board.definition.id).canCreateRecords;
  const data = board.data[stage.key];
  const ids = data?.ids ?? [];
  const collapsed = prefs.cardMode === 'collapsed';
  const rows = board.draft.columns.length;
  const estimate = collapsed
    ? ESTIMATE_COLLAPSED
    : ESTIMATE_BASE + rows * (board.config.showLabels ? ESTIMATE_LABELLED_ROW : ESTIMATE_ROW);
  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimate + s.CARD_GAP,
    getItemKey: (i) => ids[i] ?? i,
    overscan: 6,
    useFlushSync: false,
  });
  // Card heights change with the display mode, labels and rows: re-measure.
  useEffect(() => virtualizer.measure(), [collapsed, board.config.showLabels, rows, prefs.hideEmpty]);

  const items = virtualizer.getVirtualItems();
  const last = items[items.length - 1]?.index ?? -1;
  useEffect(() => {
    if (data?.hasMore && last >= ids.length - 20) board.loadMore(stage.key);
  }, [data?.hasMore, last, ids.length, board, stage.key]);

  if (emptyBoard) {
    return (
      <div className={s.body}>
        {stage.key !== NO_STAGE && canCreate && (
          <button type="button" className={s.addPlaceholder} onClick={() => onAddCard(stage)}>
            <Icon icon="add" size={14} />
            {addLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={scrollRef} className={s.body} data-testid="kanban-column-body">
      <div className={s.virtualInner} style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const cardId = ids[item.index] as string;
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className={s.cardSlot}
              style={{ transform: `translateY(${item.start}px)`, paddingBottom: s.CARD_GAP }}
            >
              <DraggableCard
                board={board}
                cardId={cardId}
                stage={stage}
                collapsed={collapsed}
                hideEmpty={prefs.hideEmpty}
                placeholder={cardId === draggingCardId}
                placeholderHeight={draggingHeight}
                onEdit={onEditCard}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DraggableCard = memo(function DraggableCard({
  board,
  cardId,
  stage,
  collapsed,
  hideEmpty,
  placeholder,
  placeholderHeight,
  onEdit,
}: {
  board: Board;
  cardId: string;
  stage: BoardStage;
  collapsed: boolean;
  hideEmpty: boolean;
  placeholder: boolean;
  placeholderHeight: number;
  onEdit(cardId: string): void;
}) {
  const access = useEntityAccess(board.definition.id);
  const { setNodeRef, attributes, listeners } = useDraggable({
    id: cardDragId(cardId),
    data: { type: 'card', cardId, column: stage.key },
    // Moving a card writes its stage value: Read only access keeps cards where they are.
    disabled: !access.canEditValues,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="Kanban card"
      aria-describedby={attributes['aria-describedby']}
      data-testid="kanban-card-handle"
      style={{ outline: 'none', borderRadius: 12 }}
    >
      {placeholder ? (
        <div
          className={s.cardPlaceholder}
          style={{ height: placeholderHeight }}
          data-testid="kanban-card-placeholder"
        />
      ) : (
        <Card
          board={board}
          cardId={cardId}
          column={stage}
          collapsed={collapsed}
          hideEmpty={hideEmpty}
          onEdit={onEdit}
        />
      )}
    </div>
  );
});
