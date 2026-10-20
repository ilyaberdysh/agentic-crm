// Views feature (BACKLOG 2.04–2.07; contract C2 in research/architecture/decisions/slice2-contracts.md).
//
//   const draft = useViewDraft(viewId);           // suspends until the view is loaded
//   <ViewSwitcher entityDefinitionId=… currentViewId=… onNavigate=… />
//   <ViewSettingsPopover draft={draft} />
//   <ViewFilterSortBar draft={draft} onNavigate=… />   // = SortPopover | FilterBar … SaveViewBar
//   snapshots.query(draft.query) keyed by draft.queryKey
//   <ColumnHeaderMenu draft={draft} column=… triggerRef=… isOpen=… onOpenChange=… />
//   <AddColumnPicker draft={draft} />  /  <AddColumnPopover … />
//   no views → <StartWithAView object=… onCreated=… />

export { type ColumnFormat, readColumnFormat } from './columns';
export {
  AddColumnPicker,
  type AddColumnPickerProps,
  AddColumnPopover,
  type AddColumnPopoverProps,
} from './components/AddColumnPicker';
export { AdvancedFilterEditor, type AdvancedFilterEditorProps } from './components/AdvancedFilterEditor';
export {
  ColumnHeaderMenu,
  type ColumnHeaderMenuProps,
  ColumnSettingsMenuItems,
  FormattingSubmenu,
} from './components/ColumnMenus';
export {
  ColumnLabelDialog,
  CreateViewDialog,
  type CreateViewDialogProps,
  TITLE_REQUIRED,
  TitleDialog,
} from './components/dialogs';
export { FilterBar, type FilterBarProps } from './components/FilterBar';
export { PathPicker, type PathPickerProps } from './components/PathPicker';
export { SaveViewBar, type SaveViewBarProps } from './components/SaveViewBar';
export { SortPopover, type SortPopoverProps } from './components/SortPopover';
export { StartWithAView, type StartWithAViewProps } from './components/StartWithAView';
export { ViewFilterSortBar, type ViewFilterSortBarProps } from './components/ViewFilterSortBar';
export { ViewSettingsPopover, type ViewSettingsPopoverProps } from './components/ViewSettingsPopover';
export { ViewSwitcher, type ViewSwitcherProps, ViewTypeTile } from './components/ViewSwitcher';
export { FilterValueEditor, ValueLabel } from './components/valueEditors';
export {
  createView,
  dedupeTitle,
  deleteView,
  duplicateView,
  updateView,
  useAttributeOptions,
  useAttributes,
  useDefinitions,
  useSchemaIndex,
  useViews,
  viewQuery,
  viewsQuery,
} from './data';
export { clearViewDrafts, viewDrafts } from './draftStore';
export {
  buildFilter,
  type ConditionNode,
  type FilterModel,
  filterKey,
  hasDynamicValues,
  parseFilter,
} from './filterModel';
export {
  attributeIcon,
  defaultSortField,
  formattingKind,
  type OperatorId,
  operatorsFor,
  TYPE_UI,
} from './operators';
export { type DateValue, dateValueLabel, hourEpoch, RELATIVE_PRESETS } from './relativeDates';
export { MAX_PATH_LENGTH, SchemaIndex } from './schemaIndex';
export { applyColumnSort, MAX_SORTS, sortDirectionOf } from './sortModel';
export type { AddColumnInput, ColumnMoveTarget, ColumnPatch, ColumnPosition, FilterAst } from './types';
export { requestFilterOn, useViewDraft, type ViewDraft } from './useViewDraft';
