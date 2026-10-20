// Header row (C1 README §2.4, §3.2; layout.md §4): sticky 40 px; record column header with select-all + singular
// noun + "+" (new record); column headers with type icon, label, "not editable" marker, the views feature's column
// header menu, resize handle (live, saved on release, double-click resets) and drag-to-reorder (dnd-kit, 5 px
// activation, ghost + 2 px drop line); "+ Add column" (the views feature's picker) fills the rest.
import type { AttributeDefinition } from '@agentic-crm/contracts';
import { Icon, Tooltip } from '@agentic-crm/ui';
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { memo, type ReactNode, type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { AttributeKindMarker } from '../ai-attributes';
import { clampRecordWidth, clampWidth, headerIcon, type TableColumn } from './columns';
import { AddColumnPopover, ColumnHeaderMenu, type ViewDraft } from './contracts';
import type { PlacedColumn } from './TableCells';
import * as s from './table.css';

export interface HeaderProps {
  draft: ViewDraft;
  singularNoun: string;
  columns: TableColumn[];
  placed: PlacedColumn[];
  recordWidth: number;
  totalWidth: number;
  addColumnLeft: number;
  addColumnWidth: number;
  selectAll: 'none' | 'some' | 'all';
  selectAllDisabled: boolean;
  /** Shown instead of the select-all box while there are no rows (list tables: the parent object's tile). */
  recordIcon?: ReactNode;
  onSelectAll(): void;
  /** Absent when the member may not create records (Read only). */
  onNewRecord?(): void;
  onResize(columnKey: string | null, width: number): void;
  onResizeEnd(columnKey: string | null, width: number | null): void;
  onMove(columnKey: string, toIndex: number): void;
  onEditAttribute?(attribute: AttributeDefinition): void;
  onCreateAttribute?(): void;
  /** "Run AI autofill" from an AI column's header menu (features/ai-attributes). */
  onRunAi?(attribute: AttributeDefinition): void;
  /** Client X → content X (scroll offset applied). */
  toContentX(clientX: number): number;
}

/** A drop ends with a click on the header under the pointer; it must not open the header menu. */
let lastDragEnd = 0;

export function TableHeader(props: HeaderProps) {
  const { columns, placed, recordWidth, totalWidth } = props;
  const [drag, setDrag] = useState<{ key: string; dropIndex: number; dropX: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const dropTarget = (clientX: number): { index: number; x: number } => {
    const x = props.toContentX(clientX);
    // Insertion point among all columns by midpoints (offsets from widths, not only the rendered ones).
    let left = recordWidth;
    for (let i = 0; i < columns.length; i++) {
      const w = (columns[i] as TableColumn).width;
      if (x < left + w / 2) return { index: i, x: left };
      left += w;
    }
    return { index: columns.length, x: left };
  };

  const pointerX = (event: DragMoveEvent | DragEndEvent): number => {
    const start = event.activatorEvent as PointerEvent;
    return start.clientX + event.delta.x;
  };

  const onDragMove = (event: DragMoveEvent) => {
    const t = dropTarget(pointerX(event));
    setDrag({ key: String(event.active.id), dropIndex: t.index, dropX: t.x });
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDrag(null);
    lastDragEnd = Date.now();
    const key = String(event.active.id);
    const from = columns.findIndex((c) => c.key === key);
    const { index } = dropTarget(pointerX(event));
    // Index among the other columns once the dragged one is taken out.
    const to = index > from ? index - 1 : index;
    if (from >= 0 && to !== from) props.onMove(key, to);
  };

  const dragged = drag ? columns.find((c) => c.key === drag.key) : undefined;

  return (
    <DndContext
      sensors={sensors}
      autoScroll={{ layoutShiftCompensation: false }}
      onDragStart={(e) => setDrag({ key: String(e.active.id), dropIndex: -1, dropX: -1 })}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDrag(null)}
    >
      <div role="row" aria-rowindex={1} className={s.headerRow} style={{ width: totalWidth }}>
        <RecordHeaderCell {...props} />
        {placed.map((p) => (
          <ColumnHeader
            key={p.column.key}
            placed={p}
            draft={props.draft}
            dragging={drag?.key === p.column.key}
            onResize={props.onResize}
            onResizeEnd={props.onResizeEnd}
            onEditAttribute={props.onEditAttribute}
            onRunAi={props.onRunAi}
          />
        ))}
        <div className={s.addColumnCell} style={{ left: props.addColumnLeft, width: props.addColumnWidth }}>
          <AriaButton ref={addRef} className={s.addColumnButton} aria-expanded={adding} onPress={() => setAdding(true)}>
            <Icon icon="add" size={16} />
            Add column
          </AriaButton>
        </div>
        <AddColumnPopover
          draft={props.draft}
          triggerRef={addRef}
          isOpen={adding}
          onOpenChange={setAdding}
          onCreateAttribute={props.onCreateAttribute}
          placement="bottom end"
        />
        {drag && drag.dropIndex >= 0 && <div className={s.guideLine} style={{ left: drag.dropX - 1, height: 40 }} />}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div className={s.dragGhost} style={{ width: dragged.width, height: 40 }}>
            <HeaderContent column={dragged} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function RecordHeaderCell(props: HeaderProps) {
  const { selectAll } = props;
  return (
    <div role="columnheader" aria-colindex={1} className={s.recordHeaderCell} style={{ width: props.recordWidth }}>
      {props.recordIcon && props.selectAllDisabled ? (
        <span className={s.checkbox} style={{ boxShadow: 'none', background: 'none' }}>
          {props.recordIcon}
        </span>
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={selectAll === 'all' ? true : selectAll === 'some' ? 'mixed' : false}
          aria-label="Select all rows"
          className={s.checkbox}
          disabled={props.selectAllDisabled}
          onClick={props.onSelectAll}
        >
          {selectAll === 'all' && <Icon icon="check" size={12} strokeWidth={3} />}
          {selectAll === 'some' && <Icon icon="remove" size={12} strokeWidth={3} />}
        </button>
      )}
      <span className={s.headerLabel}>{props.singularNoun}</span>
      {props.onNewRecord && (
        <Tooltip content={`New ${props.singularNoun}`}>
          <AriaButton className={s.headerAdd} aria-label={`New ${props.singularNoun}`} onPress={props.onNewRecord}>
            <Icon icon="add" size={16} />
          </AriaButton>
        </Tooltip>
      )}
      <ResizeHandle columnKey={null} width={props.recordWidth} props={props} clamp={clampRecordWidth} />
    </div>
  );
}

function HeaderContent({ column }: { column: TableColumn }) {
  const formula = Boolean(column.attribute?.formulaConfiguration);
  return (
    <>
      <Icon icon={headerIcon(column.attribute)} size={16} className={s.headerIcon} />
      <span className={s.headerLabel}>{column.title}</span>
      {formula ? (
        <Tooltip
          content={
            <span style={{ maxWidth: 210, display: 'block' }}>
              Values in this column are calculated by a formula and can't be edited. To make changes, update the formula
            </span>
          }
        >
          <AriaButton
            className={s.headerTrailing}
            aria-label="Formula"
            style={{ border: 'none', background: 'none', padding: 0 }}
          >
            <Icon icon="formulaFx" size={16} />
          </AriaButton>
        </Tooltip>
      ) : column.attribute?.aiAutofillConfiguration?.isEnabled ? (
        <span className={s.headerTrailing}>
          <AttributeKindMarker attribute={column.attribute} size={14} className={s.headerTrailing} />
        </span>
      ) : (
        column.readOnly &&
        !column.policyLocked && (
          <span className={s.headerTrailing}>
            <Icon icon="notEditable" size={14} label="Not editable" />
          </span>
        )
      )}
    </>
  );
}

const ColumnHeader = memo(function ColumnHeader({
  placed,
  draft,
  dragging,
  onResize,
  onResizeEnd,
  onEditAttribute,
  onRunAi,
}: {
  placed: PlacedColumn;
  draft: ViewDraft;
  dragging: boolean;
  onResize: HeaderProps['onResize'];
  onResizeEnd: HeaderProps['onResizeEnd'];
  onEditAttribute: HeaderProps['onEditAttribute'];
  onRunAi: HeaderProps['onRunAi'];
}) {
  const { column, index, left, width } = placed;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const { attributes, listeners, setNodeRef } = useDraggable({ id: column.key });
  return (
    <>
      <div
        {...attributes}
        {...listeners}
        ref={(el) => {
          ref.current = el;
          setNodeRef(el);
        }}
        role="columnheader"
        tabIndex={-1}
        aria-colindex={index + 2}
        aria-haspopup="menu"
        aria-expanded={open}
        title={column.title !== column.attributeTitle ? column.attributeTitle : undefined}
        className={s.headerCell}
        style={{ left, width }}
        data-open={open || undefined}
        data-dragging={dragging || undefined}
        data-testid="column-header"
        data-column-key={column.key}
        onClick={() => {
          if (Date.now() - lastDragEnd > 300) setOpen(true);
        }}
      >
        <HeaderContent column={column} />
        <ResizeHandle columnKey={column.key} width={width} props={{ onResize, onResizeEnd }} clamp={clampWidth} />
      </div>
      {/* Always mounted: its "Edit column label" dialog outlives the menu. */}
      <ColumnHeaderMenu
        draft={draft}
        column={column.column}
        triggerRef={ref}
        isOpen={open}
        onOpenChange={setOpen}
        onEditAttribute={onEditAttribute}
        onRunAi={onRunAi}
      />
    </>
  );
});

function ResizeHandle({
  columnKey,
  width,
  props,
  clamp,
}: {
  columnKey: string | null;
  width: number;
  props: Pick<HeaderProps, 'onResize' | 'onResizeEnd'>;
  clamp: (w: number) => number;
}) {
  const [active, setActive] = useState(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setActive(true);
    let last = width;
    const move = (ev: PointerEvent) => {
      last = clamp(width + ev.clientX - startX);
      props.onResize(columnKey, last);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setActive(false);
      if (last !== width) props.onResizeEnd(columnKey, last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div
      className={s.resizeHandle}
      data-active={active || undefined}
      data-testid="column-resize-handle"
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        props.onResizeEnd(columnKey, null);
      }}
    />
  );
}
