// Pointer drag-reorder for vertical lists (view switcher rows, View settings columns, sort rows): activation after
// 4 px, the dragged row dims and a 2 px accent line marks the drop edge; on drop only the moved item is reported (its
// new rank is computed by the caller, CROSS-DOMAIN B.4).
import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useRef, useState } from 'react';

const ACTIVATION_PX = 4;

export interface ReorderState {
  /** Index being dragged (after activation). */
  dragging: number | null;
  /** Insertion edge 0…count (before row i), shown as the drop line. */
  dropAt: number | null;
}

export function useVerticalReorder(
  containerRef: RefObject<HTMLElement | null>,
  onMove: (from: number, to: number) => void,
) {
  const [state, setState] = useState<ReorderState>({ dragging: null, dropAt: null });
  const lastDragEnd = useRef(0);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  const rows = () =>
    [...(containerRef.current?.querySelectorAll<HTMLElement>('[data-reorder-index]') ?? [])].sort(
      (a, b) => Number(a.dataset.reorderIndex) - Number(b.dataset.reorderIndex),
    );

  const dropIndexAt = (y: number): number => {
    const list = rows();
    for (let i = 0; i < list.length; i++) {
      const r = (list[i] as HTMLElement).getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return list.length;
  };

  const onPointerDown = useCallback((index: number, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    let active = false;
    let dropAt: number | null = null;
    const move = (e: PointerEvent) => {
      if (!active && Math.abs(e.clientY - startY) < ACTIVATION_PX) return;
      active = true;
      dropAt = dropIndexAt(e.clientY);
      setState({ dragging: index, dropAt });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setState({ dragging: null, dropAt: null });
      if (active) lastDragEnd.current = Date.now();
      if (!active || dropAt === null) return;
      const to = dropAt > index ? dropAt - 1 : dropAt;
      if (to !== index) moveRef.current(index, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, []);

  /** Offset (px from the container top) of the drop line, or null. */
  const dropLineTop = (): number | null => {
    if (state.dropAt === null || !containerRef.current) return null;
    const list = rows();
    const base = containerRef.current.getBoundingClientRect().top - containerRef.current.scrollTop;
    if (list.length === 0) return null;
    if (state.dropAt >= list.length)
      return (list[list.length - 1] as HTMLElement).getBoundingClientRect().bottom - base;
    return (list[state.dropAt] as HTMLElement).getBoundingClientRect().top - base - 1;
  };

  /** True right after a drag ended (suppresses the click that follows the drop). */
  const didDragRecently = () => Date.now() - lastDragEnd.current < 250;

  return { ...state, onPointerDown, dropLineTop, didDragRecently };
}
