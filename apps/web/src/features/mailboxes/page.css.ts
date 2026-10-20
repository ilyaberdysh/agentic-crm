// Page frame of the email and calendar settings (F settings §1–4; evidence/F/workspace-email-record-creation.png and
// the mailbox crops): the 768 px settings column with a 72 px top padding, H1 + subtitle, route tabs 24 px below, 40 px
// between the tab rule and the first section, sections 40 px apart with a 16 px gap under their header.
import { insetRing, text, vars } from '@agentic-crm/ui/styles';
import { globalStyle, style, styleVariants } from '@vanilla-extract/css';

const c = vars.color;

export const page = style({
  boxSizing: 'border-box',
  maxWidth: 816,
  margin: '0 auto',
  padding: '72px 24px 96px',
  display: 'flex',
  flexDirection: 'column',
});

export const pageTitle = style({ ...text.heading.large, color: c.content.primary, margin: '1px 0 1px' });

export const pageDescription = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

export const learnMore = style({
  color: c.content.secondary,
  textDecoration: 'underline',
  textDecorationColor: c.stroke.secondaryTransparent,
  textUnderlineOffset: '0.14em',
  selectors: { '&:hover': { color: c.content.primary } },
});

/** Tabs sit 24 px under the subtitle; the rule is the TabList's own. */
export const tabs = style({ marginTop: 24 });

/** Content below the tab rule. */
export const tabPanel = style({ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 40 });

/** A tab panel that holds a single block (empty states, the signatures editor). */
export const tabPanelPlain = style({ marginTop: 40 });

export const centered = style({ display: 'flex', justifyContent: 'center', padding: '64px 0' });

// ---- sections ----------------------------------------------------------------------------------------------------

export const section = style({ display: 'flex', flexDirection: 'column', gap: 16, scrollMarginTop: 24 });

export const sectionHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 });

export const sectionHeadText = style({ minWidth: 0 });

export const sectionTitle = style({ ...text.heading.small, color: c.content.primary, margin: 0 });

/** Page-level section titles (Record creation, Email visibility) sit on a 24 px line. */
export const sectionTitleTall = style({ marginBottom: 4 });

/** A section whose body sits 12 px under its header (instead of 16). */
export const sectionCompact = style({ gap: 12 });

/**
 * Route tabs: the ui Tab keeps a zero-width underline span in its flex row, which adds one `gap` (6 px) after every
 * unselected tab; taking it out of the flow gives Attio's tab spacing (evidence/F/mailbox-blocklist-empty.png).
 */
export const routeTab = style({});
globalStyle(`${routeTab} > span[aria-hidden="true"]:last-child`, { position: 'absolute' });

export const sectionDescription = style({ ...text.body.standard, color: c.content.secondary, margin: 0 });

export const sectionDescriptionTall = style({ marginTop: 0 });

/** A titled block inside a section ("Default record creation"): 14 px / 600 title, 12 px description. */
export const block = style({ display: 'flex', flexDirection: 'column', gap: 16 });

/** Blocks that belong together (Default record creation → company switch) sit 24 px apart. */
export const stack = style({ display: 'flex', flexDirection: 'column', gap: 24 });

/** A one-row setting card: title + description on the left, the control on the right. */
export const settingCard = style({
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  minHeight: 56,
  padding: '9px 16px',
  borderRadius: 12,
  border: `1px solid ${c.stroke.primary}`,
  backgroundColor: c.surface.primary,
});

export const settingCardTitle = style({ ...text.body.standard, color: c.content.primary, margin: 0 });

export const settingCardDescription = style({ ...text.text12.standard, color: c.content.secondary, margin: 0 });

export const rule = style({ height: 1, backgroundColor: c.stroke.primary, margin: '24px 0 40px', flex: 'none' });

export const blockHead = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 });

export const blockTitle = style({ ...text.heading.extraSmall, color: c.content.primary, margin: 0 });

export const blockDescription = style({ ...text.text12.standard, color: c.content.secondary, margin: 0 });

// ---- header of a mailbox page -------------------------------------------------------------------------------------

export const backLink = style({
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  padding: '0 6px 0 4px',
  marginLeft: -4,
  borderRadius: 6,
  ...text.body.standard,
  color: c.content.secondary,
  textDecoration: 'none',
  cursor: 'pointer',
  selectors: {
    '&:hover': { color: c.content.primary, backgroundColor: c.interactive.ghostHover },
    '&:focus-visible': { outline: `1px solid ${c.stroke.accent}`, outlineOffset: 1 },
  },
});

export const mailboxHeader = style({ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 });

export const mailboxHeaderText = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 });

export const mailboxTitleRow = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });

export const mailboxTitle = style({
  ...text.heading.large,
  color: c.content.primary,
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

// ---- provider tile ------------------------------------------------------------------------------------------------

export const providerTile = style({
  boxSizing: 'border-box',
  flex: 'none',
  display: 'grid',
  placeItems: 'center',
  backgroundColor: c.surface.primary,
  boxShadow: insetRing(c.stroke.primary),
  color: c.content.secondary,
});

export const providerTileSize = styleVariants({
  56: { width: 56, height: 56, borderRadius: 16 },
  40: { width: 40, height: 40, borderRadius: 12 },
});

export const providerTileTest = style({ backgroundColor: c.surface.tertiary });

// ---- info alert + lists --------------------------------------------------------------------------------------------

export const infoAlert = style({
  backgroundColor: c.surface.tertiary,
  borderColor: 'transparent',
  color: c.content.secondary,
});

/** A bordered list of rows (granted people, blocklist entries, suppressions). */
export const listCard = style({
  boxSizing: 'border-box',
  borderRadius: 12,
  boxShadow: insetRing(c.stroke.primary),
  backgroundColor: c.surface.primary,
  overflow: 'hidden',
});

export const listRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 44,
  boxSizing: 'border-box',
  padding: '6px 8px 6px 12px',
  ...text.body.standard,
  color: c.content.primary,
  selectors: {
    '& + &': { borderTop: `1px solid ${c.stroke.primary}` },
    '&:hover': { backgroundColor: c.interactive.ghostHoverSubtle },
  },
});

export const listRowText = style({ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' });

export const listRowPrimary = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const listRowSecondary = style({
  ...text.text12.standard,
  color: c.content.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const listIcon = style({ color: c.content.tertiary, flex: 'none' });

export const toolbar = style({ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 });
