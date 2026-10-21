// Shared, rarely changing table state for rows and cells (stable callbacks live behind refs in RecordTable so the
// memoised rows never re-render for a new closure).
import type { AttributeDefinition, EntityDefinition, ValueInput } from '@agentic-crm/contracts';
import {
  type ComponentType,
  createContext,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
} from 'react';
import type { WorkspaceRef } from '../../data/trpc';
import type { TableColumn } from './columns';
import type { CommitInput, CommitMeta } from './contracts';
import type { ViewPresence } from './presence';

export interface TableObject {
  id: string;
  apiSlug: string;
  entityType: EntityDefinition['entityType'];
  standardObjectType: EntityDefinition['standardObjectType'];
  singularNoun: string;
  pluralNoun: string;
}

export type EditEnd = 'commit' | 'cancel';

export interface TableActions {
  cellPointerDown(event: PointerEvent, row: number, col: number): void;
  cellPointerEnter(event: PointerEvent, row: number, col: number): void;
  cellDoubleClick(row: number, col: number): void;
  cellContextMenu(event: MouseEvent, row: number, col: number): void;
  toggleRow(event: MouseEvent, row: number): void;
  openRecord(recordId: string): void;
  /** "Open preview": the record preview drawer (no URL change). */
  openPreview(recordId: string): void;
  /** An editor or a keyboard action wrote values (author freeze, presence draft clear). */
  committed(recordId: string): void;
  /** The editor closed; `via` says how (Enter → next row, Tab → next column). */
  editEnded(how: EditEnd, via?: CommitMeta['via']): void;
  draftChanged(recordId: string, columnKey: string, values: ValueInput[] | null): void;
  /** Keyboard focus back to the grid (after an in-place checkbox / star click). */
  refocus(): void;
  /** The active cell's write function (registered by the mounted active cell). */
  registerActiveWriter(write: ((next: CommitInput) => void) | null): void;
}

/**
 * The record (first) column of a table whose rows are not records of `object` — list entries (features/lists): the
 * cell shows each entry's parent record. The table keeps the checkbox, hover actions and pointer handling.
 */
export interface RecordColumnSlot {
  /** Header label ("Company") and the icon shown in place of select-all while there are no rows. */
  label: string;
  icon?: ReactNode;
  /** Avatar + title link of one row; `live` = may subscribe to queries (false while the table flings). */
  Cell: ComponentType<{ rowId: string; live: boolean; onOpen: () => void }>;
  /** Text of the record cell for copy (undefined = not loaded yet). */
  copyText?: (rowId: string) => string | undefined;
}

export interface TableContextValue {
  workspace: WorkspaceRef;
  object: TableObject;
  titleAttribute: AttributeDefinition | undefined;
  recordHref(recordId: string): string;
  presence: ViewPresence | undefined;
  actions: TableActions;
  columns: TableColumn[];
  recordColumn?: RecordColumnSlot;
  /** The record cell's "Comment" action (list tables open the entry's comments). */
  onCommentRow?: (rowId: string) => void;
}

export const TableContext = createContext<TableContextValue | null>(null);

export function useTable(): TableContextValue {
  const ctx = useContext(TableContext);
  if (!ctx) throw new Error('useTable must be used inside <RecordTable>');
  return ctx;
}
