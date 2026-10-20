// Command palette (BACKLOG 5.02, 5.03; B-shell/command-palette.md). Public surface:
//   <PaletteHost/>                      once per workspace layout: ⌘K, `/`, `e` and the modal itself
//   openQuickActions() / openSearch(q)  open the palette / the Search records modal (sidebar button, URLs)
//   usePaletteContext({id, title, actions})  a page or record registers its own actions (the record page, focused row)
//   useRecordMenu()                     the record action list (Open, Copy, Create task…) shared with the table
export { PaletteHost } from './CommandPalette';
export {
  type PaletteAction,
  type PaletteApi,
  type PaletteContext,
  registerPaletteContext,
  usePaletteContext,
} from './contexts';
export { type RecordTarget, useRecordMenu } from './recordActions';
export { closePalette, openPaletteView, openQuickActions, openSearch, usePaletteState } from './store';
