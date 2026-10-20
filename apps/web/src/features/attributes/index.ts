// Public surface of the attributes feature (slice-2 contract C1). Consumers: features/table (cells, clipboard,
// footers), features/settings/objects (previews, defaults), the record page (fields) in slice 3.

export { type AttributeEnv, AttributeEnvProvider, useAttributeEnv } from './data/env';
export {
  attributesQuery,
  membersQuery,
  objectQuery,
  optionsQuery,
  stagesQuery,
  useAttributes,
  useMembers,
  useRecordTitle,
  useSelectOptions,
  useStages,
} from './data/queries';
export { MemberPicker, type MemberPickerProps, RecordPicker, type RecordPickerProps } from './editors/pickers';
export {
  type AggregationKind,
  aggregateSuffix,
  formatAggregate,
  formatAggregateResult,
  formatCurrency,
  formatNumber,
  formatPercent,
} from './format/formatValue';
export { type FormatSettings, getFormatSettings, setFormatSettings, useFormatSettings } from './format/locale';
export { NewRecordDialog, type NewRecordDialogProps } from './NewRecordDialog';
export {
  defaultColumnWidth,
  type FormatScalarOptions,
  formatValue,
  getAttributeUi,
  isAttributeEditable,
  RECORD_COLUMN_WIDTH,
} from './registry';
export type {
  AttributeUi,
  CommitInput,
  CommitMeta,
  CommitVia,
  Density,
  DisplayConfiguration,
  EditorKind,
  EditorProps,
  RecordRef,
  ValueField,
  ValueOp,
  ViewProps,
} from './types';
export { MemberChip, RecordAvatar, RecordChip, recordPath } from './ui/primitives';
export { ValueHistoryPopover, type ValueHistoryPopoverProps } from './ValueHistoryPopover';
export { setPlaceholder } from './views/frame';
export { PendingIndicator } from './views/views';
export {
  type AttributeValuesState,
  overlayValues,
  useAttributeValues,
  useAttributeWrite,
} from './write/useAttributeWrite';
