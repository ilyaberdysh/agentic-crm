// The seam between the table/object page and the other slice-2 features (slice2-contracts.md): C1 attribute registry
// (features/attributes) and C2 view draft + view components (features/views).
export {
  type AttributeUi,
  type CommitInput,
  type CommitMeta,
  type DisplayConfiguration,
  formatAggregateResult,
  formatValue,
  getAttributeUi,
  NewRecordDialog,
  overlayValues,
  RecordAvatar,
  type RecordRef,
  useAttributeWrite,
  type ValueOp,
} from '../attributes';
export {
  AddColumnPicker,
  AddColumnPopover,
  type ColumnFormat,
  ColumnHeaderMenu,
  readColumnFormat,
  StartWithAView,
  useViewDraft,
  type ViewDraft,
  ViewFilterSortBar,
  ViewSettingsPopover,
  ViewSwitcher,
} from '../views';
