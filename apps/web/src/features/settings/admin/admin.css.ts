// Shared styles of settings pages (members, teams, permissions, rules, developers, security). Page column,
// tab rows and table cards come from the objects settings styles (same 768 px column); this file adds
// the tab-page header, list rows, chips and cards the admin pages share.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style } from '@vanilla-extract/css';

const c = vars.color;

export const learnMore = style({
  color: c.content.secondary,
  textDecoration: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
  selectors: { '&:hover': { color: c.content.primary } },
});

export const learnMoreArrow = style({ display: 'inline', verticalAlign: '-1px', marginLeft: 3 });

/** Toolbar over a table: search field (grows) + primary action. */
export const toolbar = style({ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 });

export const toolbarGrow = style({ flex: 1, minWidth: 0 });

// the table search sits on a faint fill (#fafafa on the white page), not on the bare page.
globalStyle(`${toolbarGrow} > div`, { backgroundColor: c.surface.secondary });

export const sectionHeaderRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
});

// ---- list rows (cards): label + control rows used by permissions, tokens, webhooks -----------------------------

export const cardList = style({ display: 'flex', flexDirection: 'column', gap: 8 });

export const card = style({
  boxSizing: 'border-box',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
  backgroundColor: c.surface.primary,
});

export const cardRow = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 40,
  padding: '0 8px 0 12px',
  ...text.body.standard,
  color: c.content.primary,
});

export const rowMain = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 });

export const rowName = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 });

export const rowDetail = style({ ...text.text12.standard, color: c.content.secondary, whiteSpace: 'nowrap' });

export const muted = style({ color: c.content.tertiary });

// ---- chips ---------------------------------------------------------------------------------------------------

export const chips = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, overflow: 'hidden' });

export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  backgroundColor: c.surface.tint,
  color: c.content.secondary,
  ...text.text12.standard,
  whiteSpace: 'nowrap',
  flex: 'none',
});

export const pendingChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 6px',
  borderRadius: 6,
  backgroundColor: c.utilities.surface.blue,
  color: c.utilities.content.onBlueSubtle,
  ...text.text12.standard,
  whiteSpace: 'nowrap',
});

// ---- form blocks -------------------------------------------------------------------------------------------

export const formGrid = style({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 });

export const formStack = style({ display: 'flex', flexDirection: 'column', gap: 16 });

export const hint = style({ ...text.text12.standard, color: c.content.secondary, margin: 0 });

export const settingCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 24,
  padding: '12px 16px',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
  backgroundColor: c.surface.primary,
});

export const settingText = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 });

export const settingTitle = style({ ...text.body.standard, color: c.content.primary, margin: 0 });

export const settingDescription = style({ ...text.text12.standard, color: c.content.secondary, margin: 0 });

// ---- dialogs -------------------------------------------------------------------------------------------------

// Dialog body of the shell-style dialogs (16 px all round, scrolls under the cap of the frame).
export const dialogBody = style({
  boxSizing: 'border-box',
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
});

// Settings form dialogs (new team, token, webhook): fields sit 12 px from the panel edge, 24 px below.
export const formDialogBody = style([dialogBody, { padding: '16px 12px 24px' }]);

export const checkRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 36,
  padding: '0 8px',
  borderRadius: 8,
  cursor: 'pointer',
  ...text.body.standard,
  color: c.content.primary,
  selectors: { '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle } },
});

export const errorText = style({ ...text.text12.standard, color: c.content.critical, margin: 0 });
