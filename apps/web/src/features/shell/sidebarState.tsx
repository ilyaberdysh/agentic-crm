// Sidebar layout state (B sidebar.md §13, layout.md §2): docked vs floating "hover" variant, collapse (⌘.),
// width 200–350 (default 275, persisted ÷10 like Attio's `sidebar_width`), auto-float at ≤ 864 px app width,
// hover reveal from a 14 px strip at the left edge or the header's Expand button. Shared by the main shell and the
// settings shell so switching between them keeps the layout.
import { useRouterState } from '@tanstack/react-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { readRaw, usePersistentState, writeRaw } from '../../lib/storage';
import { useAction } from '../shortcuts/catalog';

export const SIDEBAR_DEFAULT_WIDTH = 275;
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 350;
/** Dragging below this collapses the sidebar. */
export const SIDEBAR_COLLAPSE_THRESHOLD = 25;
/** App widths at or below this float the sidebar. */
export const NARROW_BREAKPOINT = 864;
const FORCE_COLLAPSE_LOCK_MS = 150;

export function clampWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

function readWidth(): number {
  const raw = Number.parseFloat(readRaw('sidebar_width') ?? '');
  return Number.isFinite(raw) ? clampWidth(raw * 10) : SIDEBAR_DEFAULT_WIDTH;
}

export interface SidebarState {
  /** User preference (persisted). */
  collapsed: boolean;
  /** App area at or below 864 px. */
  narrow: boolean;
  /** `hover` = floating panel (collapsed or narrow); `docked` = in the layout. */
  mode: 'docked' | 'hover';
  width: number;
  dragging: boolean;
  /** Floating panel currently shown. */
  hoverOpen: boolean;
  toggle: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setWidth: (width: number) => void;
  resetWidth: () => void;
  setDragging: (dragging: boolean) => void;
  /** Hover reveal (strip, Expand button) and hide (pointer left the panel). */
  reveal: () => void;
  conceal: () => void;
  /** The pointer entered / left the floating panel. */
  panelPointer: (inside: boolean) => void;
  /** Menus / dialogs inside the panel keep it open while shown. */
  holdOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarState | null>(null);

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= NARROW_BREAKPOINT);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= NARROW_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return narrow;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = usePersistentState<boolean>('sidebar-collapsed', false);
  const [width, setWidthState] = useState(readWidth);
  const [dragging, setDragging] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const holds = useRef(0);
  const lockUntil = useRef(0);
  const narrow = useNarrow();
  const mode = collapsed || narrow ? 'hover' : 'docked';
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // In narrow mode the floating panel hides on navigation (runs on route change only).
  useEffect(() => {
    if (narrow) {
      holds.current = 0;
      setHoverOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    if (mode === 'docked') setHoverOpen(false);
  }, [mode]);

  const setCollapsed = useCallback(
    (next: boolean) => {
      if (next) {
        // Force collapse: keep the panel from popping back while the pointer is still over it.
        lockUntil.current = Date.now() + FORCE_COLLAPSE_LOCK_MS;
        setHoverOpen(false);
      }
      setCollapsedState(next);
    },
    [setCollapsedState],
  );

  const toggle = useCallback(() => {
    if (mode === 'hover' && narrow && !collapsed) {
      // Narrow but not collapsed: the shortcut opens or closes the floating panel.
      setHoverOpen((open) => !open);
      return;
    }
    setCollapsed(!collapsed);
  }, [collapsed, mode, narrow, setCollapsed]);

  const setWidth = useCallback((next: number) => {
    const w = clampWidth(next);
    setWidthState(w);
    writeRaw('sidebar_width', String(w / 10));
  }, []);

  const resetWidth = useCallback(() => {
    setWidthState(SIDEBAR_DEFAULT_WIDTH);
    writeRaw('sidebar_width', null);
  }, []);

  const concealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useCallback(() => {
    if (concealTimer.current) clearTimeout(concealTimer.current);
    concealTimer.current = null;
    if (Date.now() < lockUntil.current) return;
    setHoverOpen(true);
  }, []);

  /**
   * Hides after a short grace period, so moving between the strip / Expand button and the panel (which reveal
   * again and cancel this) does not flicker.
   */
  const conceal = useCallback(() => {
    if (concealTimer.current) clearTimeout(concealTimer.current);
    concealTimer.current = setTimeout(() => {
      concealTimer.current = null;
      if (holds.current > 0) return;
      setHoverOpen(false);
    }, 120);
  }, []);

  useEffect(
    () => () => {
      if (concealTimer.current) clearTimeout(concealTimer.current);
    },
    [],
  );

  const pointerInPanel = useRef(false);

  const panelPointer = useCallback(
    (inside: boolean) => {
      pointerInPanel.current = inside;
      if (inside) reveal();
      else conceal();
    },
    [reveal, conceal],
  );

  const holdOpen = useCallback(
    (open: boolean) => {
      holds.current = Math.max(0, holds.current + (open ? 1 : -1));
      // A menu closed while the pointer is elsewhere: hide now.
      if (!open && holds.current === 0 && !pointerInPanel.current) conceal();
    },
    [conceal],
  );

  useAction('toggle-sidebar', toggle);

  const value = useMemo<SidebarState>(
    () => ({
      collapsed,
      narrow,
      mode,
      width,
      dragging,
      hoverOpen,
      toggle,
      setCollapsed,
      setWidth,
      resetWidth,
      setDragging,
      reveal,
      conceal,
      panelPointer,
      holdOpen,
    }),
    [
      collapsed,
      narrow,
      mode,
      width,
      dragging,
      hoverOpen,
      toggle,
      setCollapsed,
      setWidth,
      resetWidth,
      reveal,
      conceal,
      panelPointer,
      holdOpen,
    ],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used inside <SidebarProvider>');
  return ctx;
}
