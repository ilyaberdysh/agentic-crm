// E4 — overlays and window manager (CROSS-DOMAIN B.16; slice3-contracts.md). Consumers (features/record and others):
//   openRecordOverlay(recordRef, { list })     full-viewport record overlay, K / J through `list`; URL
//                                              `?modal=record&id=<record>&object=<object>`
//   registerRecordOverlay(Component)           the record page body rendered inside it (gets `navigation`, `close`)
//   openNote(id, { mode }) / openNoteTemplate  note / template windows: modal (`?modal=note|note-template&id=`),
//                                              floating ("Pin to screen") or minimised to the dock
//   openTask(id)                               edit-task dialog (`?command-menu-page=task&id=`)
//   registerWindowContent(kind, Component, options)   email modal, composer and meeting windows (slice 7)
//   SidePanel                                  320 px right panel frame (comments)
//   <OverlayHost/>                             mounted once in the app shell
export {
  EMPTY_OVERLAYS,
  type OverlayEntry,
  type OverlayState,
  parseOverlaySearch,
  type RecordRef,
  type RecordSequence,
  sequencePosition,
  type WindowKind,
  withOverlayParams,
} from './model';
export { OverlayHost } from './OverlayHost';
export { RecordOverlayNavigation } from './RecordOverlay';
export {
  getWindowOptions,
  type RecordOverlayContentProps,
  registerRecordOverlay,
  registerWindowContent,
  type WindowContentProps,
  type WindowOptions,
  type WindowSummary,
} from './registry';
export { SidePanel } from './SidePanel';
export {
  closeOverlay,
  closeWindow,
  expandToModal,
  floatWindow,
  minimizeWindow,
  type OpenWindowOptions,
  openNote,
  openNoteTemplate,
  openRecordOverlay,
  openTask,
  openWindow,
  overlayStore,
  useOverlayState,
} from './store';
export { FloatingWindowShell, ModalWindowShell, WindowControls, WindowTopBar } from './WindowShell';
