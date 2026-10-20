// Sidebar container (B sidebar.md §13): docked (in the layout, resizable) or floating (hover variant: inset 8,
// radius 10, e2; revealed from a 14 px strip at the left edge or the header's Expand button; hides when the pointer
// leaves unless a menu inside is open). The content (main nav or settings nav) is passed in.

import { cx } from '@agentic-crm/ui';
import { type PointerEvent, type ReactNode, useRef } from 'react';
import * as s from './shell.css';
import { SIDEBAR_COLLAPSE_THRESHOLD, useSidebar } from './sidebarState';

export function SidebarFrame({ children, label }: { children: ReactNode; label: string }) {
  const sidebar = useSidebar();
  const { mode, width, hoverOpen, dragging } = sidebar;

  if (mode === 'hover') {
    return (
      <>
        <div
          className={s.hoverStrip}
          onPointerEnter={sidebar.reveal}
          onPointerMove={sidebar.reveal}
          onPointerLeave={sidebar.conceal}
          aria-hidden="true"
        />
        <aside
          aria-label={label}
          className={cx(s.sidebar, s.sidebarVariant.hover)}
          style={{ width: width - 8 }}
          data-open={hoverOpen || undefined}
          data-variant="hover"
          onPointerEnter={() => sidebar.panelPointer(true)}
          // Menus opened from the panel (portalled) hold it open; see holdOpen().
          onPointerLeave={() => sidebar.panelPointer(false)}
          inert={!hoverOpen}
        >
          <div className={s.sidebarInner}>{children}</div>
        </aside>
      </>
    );
  }

  return (
    <div className={s.dock} style={{ width }} data-dragging={dragging || undefined}>
      <aside aria-label={label} className={cx(s.sidebar, s.sidebarVariant.docked)} data-variant="docked">
        <div className={s.sidebarInner}>{children}</div>
      </aside>
      <ResizeHandle />
    </div>
  );
}

/** 10 px hit area straddling the right edge; drag clamps 200–350, below 25 collapses, double-click resets to 275. */
function ResizeHandle() {
  const sidebar = useSidebar();
  const start = useRef<{ x: number; width: number } | null>(null);
  /** Last press that did not drag (for double-click detection). */
  const lastClick = useRef<{ t: number; x: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Double-click resets. Detected here because preventing pointerdown's default can swallow `dblclick`.
    const last = lastClick.current;
    if (last && e.timeStamp - last.t < 400 && Math.abs(e.clientX - last.x) < 4) {
      lastClick.current = null;
      sidebar.resetWidth();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width: sidebar.width };
    lastClick.current = { t: e.timeStamp, x: e.clientX };
    sidebar.setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    if (Math.abs(e.clientX - start.current.x) > 2) lastClick.current = null;
    const next = start.current.width + (e.clientX - start.current.x);
    if (next < SIDEBAR_COLLAPSE_THRESHOLD) {
      start.current = null;
      sidebar.setDragging(false);
      sidebar.setCollapsed(true);
      return;
    }
    sidebar.setWidth(next);
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    start.current = null;
    sidebar.setDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={sidebar.width}
      className={s.resizeHandle}
      data-dragging={sidebar.dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}
