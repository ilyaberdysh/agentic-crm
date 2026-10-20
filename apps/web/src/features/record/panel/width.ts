// Details panel width (D README §2.1, §2.5b; layout.md §5): a percentage of the page body persisted per object in
// localStorage (`record-page-attribute-panel-width:<entityDefinitionId>`, default 30), drawn clamped to
// [320 px, min(60 %, body − 350 px)] — CSS min-width wins over max-width, so 320 px holds on narrow bodies.
// Double-click on the divider resets to 30 %.

export const DEFAULT_PANEL_PERCENT = 30;
export const PANEL_MIN_PX = 320;
export const PANEL_MAX_RATIO = 0.6;
export const TAB_AREA_MIN_PX = 350;

export const panelWidthKey = (entityDefinitionId: string) => `record-page-attribute-panel-width:${entityDefinitionId}`;

/** Drawn width in px for a stored percentage and a body width. */
export function panelWidthPx(percent: number, bodyWidth: number): number {
  const wanted = (percent / 100) * bodyWidth;
  const max = Math.min(PANEL_MAX_RATIO * bodyWidth, bodyWidth - TAB_AREA_MIN_PX);
  return Math.round(Math.max(PANEL_MIN_PX, Math.min(wanted, max)));
}

/** Percentage to persist after a drag that ended at `px` (clamped like the drawn width). */
export function percentFromPx(px: number, bodyWidth: number): number {
  if (bodyWidth <= 0) return DEFAULT_PANEL_PERCENT;
  const drawn = panelWidthPx((px / bodyWidth) * 100, bodyWidth);
  return Math.round((drawn / bodyWidth) * 100 * 1000) / 1000;
}

/** A persisted value, or the default when missing / malformed. */
export function readPercent(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n > 0 && n < 100 ? n : DEFAULT_PANEL_PERCENT;
}
