// Runs tab (runs.md §3; evidence G/G-run-viewer-false-path.png, G-run-block-detail.png, G-run-failed-retry-menu.png,
// G-runs-empty.png): run history rows, the last-7-days overview tiles, the empty state, and the run block detail (stats
// row, error text, outputs).
import { alpha, insetRing, text, transitionColors, vars } from '@agentic-crm/ui/styles';
import { style } from '@vanilla-extract/css';

const c = vars.color;

export const historyTitle = style({
  ...text.heading.small,
  fontSize: 16,
  fontWeight: 600,
  color: c.content.primary,
  flex: 1,
});

export const list = style({ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 12px 12px' });

export const runRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  padding: '0 8px',
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  ...text.body.standard,
  color: c.content.primary,
  textAlign: 'left',
  cursor: 'pointer',
  textDecoration: 'none',
  transition: transitionColors,
  selectors: {
    '&:hover': { backgroundColor: c.interactive.ghostHover },
    '&[data-selected]': { backgroundColor: c.surface.tertiary },
  },
});

export const runTime = style({
  marginLeft: 'auto',
  ...text.text12.standard,
  color: c.content.secondary,
  whiteSpace: 'nowrap',
});
export const failedText = style({ ...text.text12.standard, color: c.content.critical });

export const overview = style({
  flex: 'none',
  borderTop: `1px solid ${c.stroke.primary}`,
  padding: '16px 16px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
});

export const overviewHead = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  ...text.text12.standard,
  color: c.content.secondary,
});

export const usageLink = style({
  color: c.content.secondary,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  selectors: { '&:hover': { color: c.content.primary } },
});

export const tiles = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 });

export const tile = style({
  position: 'relative',
  boxSizing: 'border-box',
  height: 56,
  padding: '8px 10px',
  borderRadius: 8,
  boxShadow: insetRing(c.stroke.secondary),
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
});

export const tileGreen = style({
  background: `linear-gradient(90deg, ${alpha('#02ad6e', 8)}, transparent)`,
  boxShadow: insetRing(alpha('#02ad6e', 25)),
});
export const tileRed = style({
  background: `linear-gradient(90deg, ${alpha('#eb3b3b', 8)}, transparent)`,
  boxShadow: insetRing(alpha('#eb3b3b', 25)),
});
export const tileValue = style({ ...text.heading.small, fontSize: 18, lineHeight: '22px', color: c.content.primary });
export const tileValueGreen = style({ color: c.content.onSuccessSubtle });
export const tileValueRed = style({ color: c.content.onCriticalSubtle });
export const tileLabel = style({ ...text.text12.standard, color: c.content.secondary });
export const tileIcon = style({ position: 'absolute', top: 8, right: 8, color: c.content.secondary });

export const empty = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: 24,
  textAlign: 'center',
});

export const emptyArt = style({
  position: 'relative',
  width: 138,
  height: 138,
  marginBottom: 12,
  backgroundImage: `linear-gradient(${alpha('#000000', 4)} 1px, transparent 1px), linear-gradient(90deg, ${alpha('#000000', 4)} 1px, transparent 1px)`,
  backgroundSize: '12px 12px',
  maskImage: 'radial-gradient(circle at center, #000 40%, transparent 72%)',
});

export const emptyPill = style({
  position: 'absolute',
  left: 24,
  right: 24,
  top: 49,
  height: 40,
  borderRadius: 12,
  boxShadow: `inset 0 0 0 2px ${c.stroke.tertiary}, 0 1px 2px ${alpha('#000000', 8)}`,
  backgroundColor: c.surface.primary,
});

export const emptyTick = style({
  position: 'absolute',
  left: 'calc(50% - 1px)',
  width: 2,
  height: 12,
  borderRadius: 1,
  backgroundColor: c.stroke.tertiary,
});

export const emptyTitle = style({ ...text.body.standard, fontWeight: 600, color: c.content.primary });
export const emptyText = style({ ...text.body.standard, color: c.content.secondary });

export const stats = style({
  display: 'grid',
  gridTemplateColumns: 'auto auto auto auto',
  justifyContent: 'space-between',
  gap: 8,
  padding: '12px 16px 16px',
});
export const stat = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  ...text.text12.standard,
  color: c.content.secondary,
});
export const statValue = style({
  ...text.text12.standard,
  color: c.content.primary,
  display: 'flex',
  alignItems: 'center',
  minHeight: 20,
});

export const statusPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  ...text.text12.standard,
});
export const statusCompleted = style({ backgroundColor: c.surface.success, color: c.content.onSuccessSubtle });
export const statusFailed = style({ backgroundColor: c.surface.critical, color: c.content.onCriticalSubtle });
export const statusRunning = style({ backgroundColor: c.surface.tertiary, color: c.content.secondary });

export const error = style({
  padding: '0 16px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  ...text.text12.standard,
  color: c.content.critical,
});
export const troubleshoot = style({
  color: c.content.secondary,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
});

export const outputs = style({ display: 'flex', flexDirection: 'column', gap: 10 });
export const outputLabel = style({ ...text.text12.standard, color: c.content.secondary });
export const outputValue = style({
  ...text.body.standard,
  color: c.content.primary,
  wordBreak: 'break-word',
  whiteSpace: 'pre-wrap',
});
export const noOutputs = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  borderRadius: 8,
  backgroundColor: c.surface.tertiary,
  ...text.body.standard,
  color: c.content.secondary,
});

export const nextFooter = style({
  marginTop: 'auto',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '14px 16px',
  borderTop: `1px solid ${c.stroke.primary}`,
  border: 'none',
  background: 'transparent',
  textAlign: 'left',
  fontFamily: 'inherit',
  cursor: 'pointer',
  width: '100%',
});
