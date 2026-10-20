// The dashboard grid (H README §3.3): rows of 12 columns packed from the cells in rank order, drag-and-drop reorder
// from the cell header (dnd-kit, 5 px to start; drop beside a cell or between rows, 3 px accent bar), resize handles on
// the left edge of every non-first cell, one `cells/shuffle` call per layout change, one column below 940 px.

import { DASHBOARD_COLUMNS, MIN_CELL_WIDTH } from '@agentic-crm/contracts';
import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  type Modifier,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type DashboardEntry, saveLayout, useWs } from '../data';
import * as d from './dashboard.css';
import { canDrop, type DropTarget, type LayoutEntry, moveCell, resizeCell, rowsOf } from './gridLayout';
import { ReportCell } from './ReportCell';

/** Below this container width the grid is one column (H README §3.3). */
export const SINGLE_COLUMN_BELOW = 940;

const GRID_PADDING = 14;

/** Collisions: the row bands win over the halves of a cell (so the 28 px between rows is easy to hit). */
const collisions: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const band = within.find((c) => String(c.id).startsWith('row:'));
  if (band) return [band];
  return within.filter((c) => String(c.id).startsWith('beside:'));
};

/** The floating chip follows the pointer, not the dragged card (no drop animation). */
const chipAtPointer: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  const e = activatorEvent as PointerEvent | null;
  if (!draggingNodeRect || !e || typeof e.clientX !== 'number') return transform;
  return {
    ...transform,
    x: transform.x + (e.clientX - draggingNodeRect.left) + 12,
    y: transform.y + (e.clientY - draggingNodeRect.top) + 12,
  };
};

export interface DashboardGridProps {
  dashboardId: string;
  cells: DashboardEntry[];
  canEdit: boolean;
}

export function DashboardGrid({ dashboardId, cells, canEdit }: DashboardGridProps) {
  const ws = useWs();
  const containerRef = useRef<HTMLDivElement>(null);
  const [singleColumn, setSingleColumn] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const [preview, setPreview] = useState<LayoutEntry[] | null>(null);
  const justDragged = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setSingleColumn(el.clientWidth < SINGLE_COLUMN_BELOW));
    observer.observe(el);
    setSingleColumn(el.clientWidth < SINGLE_COLUMN_BELOW);
    return () => observer.disconnect();
  }, []);

  // The cells as laid out right now: the saved ones, or the resize in progress.
  const shown = useMemo(() => {
    if (!preview) return cells;
    const byId = new Map(preview.map((p) => [p.cellId, p]));
    return cells.map((c) => {
      const p = byId.get(c.id);
      return p ? { ...c, width: p.width, sortOrder: p.sortOrder } : c;
    });
  }, [cells, preview]);
  const rows = useMemo(() => rowsOf(shown, singleColumn), [shown, singleColumn]);

  const activeEntry = activeId ? cells.find((c) => c.id === activeId) : undefined;

  const targetOf = useCallback(
    (event: { over: { data: { current?: { target?: DropTarget } } } | null }): DropTarget | null => {
      const target = event.over?.data.current?.target;
      return target && activeId && canDrop(cells, activeId, target) ? target : null;
    },
    [cells, activeId],
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragOver = (e: DragOverEvent) => setOver(targetOf(e));
  const finish = () => {
    setActiveId(null);
    setOver(null);
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const target = targetOf(e);
    const moved = String(e.active.id);
    finish();
    if (!target) return;
    const layout = moveCell(cells, moved, target);
    if (layout) void saveLayout(ws, dashboardId, layout);
  };

  // ---- resize --------------------------------------------------------------------------------------------------------

  const startResize = (cellId: string, event: ReactPointerEvent<HTMLElement>) => {
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const column = (container.clientWidth - GRID_PADDING * 2) / DASHBOARD_COLUMNS;
    let last: LayoutEntry[] | null = null;
    const move = (e: PointerEvent) => {
      last = resizeCell(cells, cellId, (e.clientX - startX) / column);
      setPreview(last);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (last) void saveLayout(ws, dashboardId, last);
      setPreview(null);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisions}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
    >
      <div
        className={d.grid}
        ref={containerRef}
        data-testid="dashboard-grid"
        data-single-column={singleColumn || undefined}
      >
        {rows.map((row, ri) => (
          <div
            key={row.map((x) => x.cell.id).join('-')}
            className={d.row}
            data-single={singleColumn || undefined}
            data-testid="grid-row"
          >
            {activeId && <RowBand index={ri} active={over?.kind === 'row' && over.index === ri} />}
            {row.map(({ cell, renderWidth }, ci) => (
              <Slot
                key={cell.id}
                entry={cell}
                dashboardId={dashboardId}
                span={singleColumn ? DASHBOARD_COLUMNS : renderWidth}
                canEdit={canEdit}
                dragging={activeId === cell.id}
                dragActive={activeId !== null}
                over={over}
                resizable={
                  canEdit &&
                  !singleColumn &&
                  ci > 0 &&
                  !(
                    (row[ci - 1] as { renderWidth: number }).renderWidth <= MIN_CELL_WIDTH &&
                    renderWidth <= MIN_CELL_WIDTH
                  )
                }
                onResizeStart={startResize}
                suppressOpen={() => justDragged.current}
              />
            ))}
            {activeId && ri === rows.length - 1 && (
              <RowBand index={rows.length} active={over?.kind === 'row' && over.index === rows.length} last />
            )}
          </div>
        ))}
      </div>
      <DragOverlay dropAnimation={null} modifiers={[chipAtPointer]}>
        {activeEntry && <div className={d.dragChip}>{activeEntry.report.title || 'Untitled Report'}</div>}
      </DragOverlay>
    </DndContext>
  );
}

function RowBand({ index, active, last }: { index: number; active: boolean; last?: boolean }) {
  const target: DropTarget = { kind: 'row', index };
  const { setNodeRef } = useDroppable({ id: `row:${index}`, data: { target } });
  return (
    <div
      ref={setNodeRef}
      className={d.rowGap}
      style={last ? { top: 'auto', bottom: -14 } : { top: -14 }}
      data-testid="row-drop-band"
      data-row-index={index}
    >
      {active && <div className={d.rowGapLine} data-testid="row-drop-line" />}
    </div>
  );
}

interface SlotProps {
  entry: DashboardEntry;
  dashboardId: string;
  span: number;
  canEdit: boolean;
  dragging: boolean;
  dragActive: boolean;
  over: DropTarget | null;
  resizable: boolean;
  onResizeStart: (cellId: string, event: ReactPointerEvent<HTMLElement>) => void;
  suppressOpen: () => boolean;
}

function Slot({
  entry,
  dashboardId,
  span,
  canEdit,
  dragging,
  dragActive,
  over,
  resizable,
  onResizeStart,
  suppressOpen,
}: SlotProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({ id: entry.id, disabled: !canEdit });
  const showDrop = dragActive && !dragging;
  return (
    <div className={d.slot} style={{ gridColumn: `span ${span}` }} data-testid="grid-slot" data-cell-id={entry.id}>
      {dragging && <div className={d.dragPlaceholder} data-testid="drag-placeholder" />}
      <div ref={setNodeRef} style={{ height: '100%' }}>
        <ReportCell
          entry={entry}
          dashboardId={dashboardId}
          canEdit={canEdit}
          dragging={dragging}
          dragRef={setActivatorNodeRef}
          dragProps={canEdit ? { ...listeners, ...attributes, tabIndex: -1, role: 'presentation' } : undefined}
          suppressOpen={suppressOpen}
        />
      </div>
      {showDrop && <Half entry={entry} side="before" over={over} />}
      {showDrop && <Half entry={entry} side="after" over={over} />}
      {resizable && (
        <div
          className={d.resizeHandle}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize"
          data-testid="resize-handle"
          onPointerDown={(e) => onResizeStart(entry.id, e)}
        />
      )}
    </div>
  );
}

function Half({ entry, side, over }: { entry: DashboardEntry; side: 'before' | 'after'; over: DropTarget | null }) {
  const target: DropTarget = { kind: 'beside', cellId: entry.id, side };
  const { setNodeRef } = useDroppable({ id: `beside:${entry.id}:${side}`, data: { target } });
  const active = over?.kind === 'beside' && over.cellId === entry.id && over.side === side;
  return (
    <div
      ref={setNodeRef}
      style={{
        position: 'absolute',
        top: 20,
        bottom: 20,
        [side === 'before' ? 'left' : 'right']: 0,
        width: '50%',
        zIndex: 2,
        pointerEvents: 'none',
      }}
      data-testid="beside-drop-zone"
      data-side={side}
    >
      {active && (
        <div
          className={`${d.dropBar} ${side === 'before' ? d.dropBarBefore : d.dropBarAfter}`}
          data-testid="beside-drop-bar"
        />
      )}
    </div>
  );
}
