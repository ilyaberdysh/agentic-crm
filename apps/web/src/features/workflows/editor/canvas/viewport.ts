// Viewport fitting for the canvas area left of the side panel: the editor opens at 100 % with the blocks
// centred in the visible area (xyflow's asymmetric fit padding only acts as a minimum, so a small graph would centre
// under the panel); "Fit to view" and Organize zoom out as needed (never above 100 %).
import { useReactFlow, useStoreApi } from '@xyflow/react';
import { useCallback } from 'react';

export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function viewportFor(
  bounds: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
  inset: Inset,
  zoomRange: { min: number; max: number },
): { x: number; y: number; zoom: number } {
  const areaW = Math.max(1, size.width - inset.left - inset.right);
  const areaH = Math.max(1, size.height - inset.top - inset.bottom);
  const fit = Math.min(areaW / Math.max(1, bounds.width), areaH / Math.max(1, bounds.height));
  const zoom = Math.min(zoomRange.max, Math.max(zoomRange.min, fit));
  return {
    x: inset.left + areaW / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: inset.top + areaH / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}

/** Centres the blocks in the area left of the panel; `fit` zooms out to show them all. */
export function useFitToArea(inset: Inset) {
  const flow = useReactFlow();
  const store = useStoreApi();
  return useCallback(
    (options: { fit?: boolean; duration?: number } = {}) => {
      const nodes = flow.getNodes().filter((n) => n.type === 'block');
      if (nodes.length === 0) return;
      // The store's size may still be 0 right after mount; the DOM node is measured already.
      const state = store.getState();
      const rect = state.domNode?.getBoundingClientRect();
      const width = rect?.width || state.width;
      const height = rect?.height || state.height;
      if (!width || !height) return;
      // Bounds from positions and the known card sizes (no DOM measure needed), with room for the "Trigger" tab.
      const xs = nodes.map((n) => n.position.x);
      const ys = nodes.map((n) => n.position.y);
      const right = Math.max(...nodes.map((n) => n.position.x + (n.initialWidth ?? 200)));
      const bottom = Math.max(...nodes.map((n) => n.position.y + (n.initialHeight ?? 70)));
      const left = Math.min(...xs);
      const top = Math.min(...ys) - 24;
      const bounds = { x: left, y: top, width: right - left, height: bottom - top };
      const vp = viewportFor(bounds, { width, height }, inset, options.fit ? { min: 0.2, max: 1 } : { min: 1, max: 1 });
      void flow.setViewport(vp, options.duration ? { duration: options.duration } : undefined);
    },
    [flow, store, inset.top, inset.right, inset.bottom, inset.left],
  );
}
