// Drag handles (⋮⋮) on attribute rows, select options and statuses (J README §3 "Drag and drop"): native HTML drag
// and drop with a before/after drop line; the caller turns the new order into a rank write (X-01).
import { type DragEvent, useState } from 'react';

export type DropPosition = 'before' | 'after';

/** The list with `dragId` moved before/after `targetId` (unchanged when either is missing or they are equal). */
export function moveItem<T extends { id: string }>(
  items: readonly T[],
  dragId: string,
  targetId: string,
  position: DropPosition,
): T[] {
  if (dragId === targetId) return [...items];
  const dragged = items.find((i) => i.id === dragId);
  if (!dragged || !items.some((i) => i.id === targetId)) return [...items];
  const rest = items.filter((i) => i.id !== dragId);
  const at = rest.findIndex((i) => i.id === targetId) + (position === 'after' ? 1 : 0);
  return [...rest.slice(0, at), dragged, ...rest.slice(at)];
}

export function useDragReorder<T extends { id: string }>(
  items: readonly T[],
  onReorder: (next: T[], movedId: string) => void,
  enabled = true,
) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; position: DropPosition } | null>(null);
  const reset = () => {
    setDragId(null);
    setOver(null);
  };

  return {
    dragId,
    dropTarget: over,
    /** Spread on the ⋮⋮ handle. */
    handleProps: (id: string) => ({
      draggable: enabled,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        if (!enabled) return;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        const row = (e.currentTarget as HTMLElement).closest('[data-drag-row]');
        if (row instanceof HTMLElement) e.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2);
        setDragId(id);
      },
      onDragEnd: reset,
    }),
    /** Spread on the row (drop target). */
    rowProps: (id: string) => ({
      'data-drag-row': '',
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = e.currentTarget.getBoundingClientRect();
        const position: DropPosition = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
        if (over?.id !== id || over.position !== position) setOver({ id, position });
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        if (dragId && over && dragId !== over.id) onReorder(moveItem(items, dragId, over.id, over.position), dragId);
        reset();
      },
    }),
  };
}
