// Lists feature (slice 4: BACKLOG 4.01–4.04, 4.09; slice4-contracts.md). Public surface for the other features:
//   data           useLists / useList / useListAttributes / useRecordMemberships, addEntries, removeEntries — the one
//                  module over lists.* / entries.* (data.ts)
//   AddRecordFlow  Choose record → Duplicates → Add-to-list form; features/kanban opens it from a stage "+" with
//                  `initialValues` = the column's stage
//   EditEntryDialog, RemoveEntriesDialog, AddToListForm
//   openListsDialog({kind: 'create-list' | 'bulk-add' | 'add-record'})  rendered by <ListsHost/> (app shell)
//   RecordListsSection  record page Lists section (features/record via its adapters)
//   routes         listRoutes(main) / listSettingsRoutes(settings)
export { AddRecordFlow, type AddRecordFlowProps } from './AddRecordFlow';
export { AddToListForm, type AddToListFormProps } from './AddToListForm';
export { ChooseListDialog } from './ChooseListDialog';
export { CreateListDialog } from './CreateListDialog';
export {
  addEntries,
  checkDuplicates,
  type List,
  type Membership,
  parentRecordAttribute,
  removeEntries,
  useList,
  useListAttributes,
  useListDefinition,
  useLists,
  useRecordMemberships,
  writableListAttributes,
} from './data';
export { EditEntryDialog } from './EditEntryDialog';
export { EntryParentCell, EntryRowsContext, parentOf } from './entryRows';
export {
  AddRecordToListDialog,
  BulkAddToList,
  ListsHost,
  listPath,
  openListsDialog,
  RemoveEntriesDialog,
} from './flows';
export { ListIcon, listEmoji } from './icon';
export { RecordListsSection } from './RecordListsSection';
export { SidebarLists } from './SidebarLists';
