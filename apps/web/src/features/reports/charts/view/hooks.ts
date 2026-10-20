// Small hooks of the chart views: element size, text measurement, highlight state.
import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { parseHighlightKey } from '../model/keys';

export interface Size {
  width: number;
  height: number;
}

/** The content box of an element, kept current with a ResizeObserver (0×0 until measured). */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, Size] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setSize((s) => (s.width === w && s.height === h ? s : { width: w, height: h }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

// ---- text measurement ----------------------------------------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null;
const widths = new Map<string, number>();

export const AXIS_FONT = '500 12px "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Width of a text in px (canvas measurement; ≈ 6.4 px per character when no canvas is available). */
export function measureText(text: string, font: string = AXIS_FONT): number {
  const key = `${font}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  let w = text.length * 6.4;
  if (typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent)) {
    try {
      canvas ??= document.createElement('canvas');
      const c = canvas.getContext('2d');
      if (c) {
        c.font = font;
        w = c.measureText(text).width;
      }
    } catch {
      // keep the estimate
    }
  }
  if (widths.size > 5000) widths.clear();
  widths.set(key, w);
  return w;
}

/** Shortens a text to a width with an ellipsis ("No Start d…"). */
export function truncateToWidth(text: string, maxWidth: number, font: string = AXIS_FONT): string {
  if (measureText(text, font) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(`${text.slice(0, mid).trimEnd()}…`, font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

// ---- highlight -------------------------------------------------------------------------------------------------------

export interface HighlightState {
  /** The active key (controlled by the parent when `highlightKey` is given, else the chart's own). */
  key: string | null;
  parsed: ReturnType<typeof parseHighlightKey>;
  /** The key the pointer is on in this chart: its own elements are never dimmed by it. */
  hoverKey: string | null;
  /** Hovering a chart element (highlights the table row, no dimming of the others). */
  hover: (key: string | null) => void;
  /** Hovering a legend item (dims everything else). */
  focus: (key: string | null) => void;
}

/**
 * Cross-highlighting with the calculated-values table. Controlled when `highlightKey !== undefined`, else local.
 * Hovering a bar reports its key but does not dim the others; a legend item or a table row (highlight that did not
 * come from the pointer on a bar) dims everything that does not match.
 */
export function useHighlight(
  highlightKey: string | null | undefined,
  onHighlight?: (key: string | null) => void,
): HighlightState {
  const [local, setLocal] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const key = highlightKey !== undefined ? highlightKey : local;
  const parsed = useMemo(() => parseHighlightKey(key), [key]);
  const hover = useCallback(
    (next: string | null) => {
      setHoverKey(next);
      setLocal(next);
      onHighlight?.(next);
    },
    [onHighlight],
  );
  const focus = useCallback(
    (next: string | null) => {
      setHoverKey(null);
      setLocal(next);
      onHighlight?.(next);
    },
    [onHighlight],
  );
  return { key, parsed, hoverKey, hover, focus };
}

/** Whether an element is dimmed: something is highlighted that did not come from the pointer on a bar, and it does not match. */
export function isDimmed(h: HighlightState, matches: boolean): boolean {
  return h.key !== null && h.key !== h.hoverKey && !matches;
}
