// Shared types of the attribute registry (slice-2 contract C1, research/architecture/decisions/slice2-contracts.md).
// Values are the wire rows of `values.list` / `values.put` (read forms, A §4.7); writes use the write forms of
// packages/contracts `valueInputSchemas`.
import type {
  AttributeDefinition,
  AttributeType,
  AttributeValue,
  PipelineStage,
  SelectOption,
  ValueInput,
  WorkspaceMember,
} from '@agentic-crm/contracts';
import type { FC } from 'react';
import type { WorkspaceRef } from '../../data/trpc';

export type { AttributeDefinition, AttributeType, AttributeValue, PipelineStage, SelectOption, ValueInput };
export type Member = WorkspaceMember;

/** A record an attribute value belongs to (workspace defaults to the current one). */
export interface RecordRef {
  workspace?: WorkspaceRef;
  entityDefinitionId: string;
  entityInstanceId: string;
}

/**
 * Where a value is drawn: a 36 px table cell (C1 cells.md), a record-page / form field row (D §3.2, 32 px Editable),
 * or a compact inline chip (kanban cards, activity lines).
 */
export type Density = 'cell' | 'field' | 'chip';

/**
 * Explicit value operations (alternative to a full `ValueInput[]` set):
 * - `put`: single-value attribute → replace the value; multi-value → add one (optional client id and rank);
 * - `retire`: clear / remove the value with this id (`active_until = now`);
 * - `reorder`: move a value of a multi-value attribute.
 */
export type ValueOp =
  | { op: 'put'; value: unknown; id?: string; sortOrder?: string }
  | { op: 'retire'; id: string }
  | { op: 'reorder'; id: string; sortOrder: string };

/** `ValueInput[]` = the desired current set (replace semantics); `ValueOp[]` = explicit operations. */
export type CommitInput = ValueInput[] | ValueOp[];

export function isValueOps(next: CommitInput): next is ValueOp[] {
  return next.length > 0 && typeof (next[0] as { op?: unknown }).op === 'string';
}

/** How an editor finished (lets the table move the active cell: Enter → next row, Tab → next column). */
export type CommitVia = 'enter' | 'tab' | 'shift-tab' | 'blur' | 'pick' | 'escape' | 'shortcut';

export interface CommitMeta {
  via?: CommitVia;
  /**
   * Multi-value editors write every toggle immediately (C1 cells.md §2) and stay open: they pass
   * `keepOpen: true`. The host closes the editor on any other commit and on `onCancel`.
   */
  keepOpen?: boolean;
}

/**
 * Column / view formatting overrides (C1 README §3.2 "Formatting", attribute-types §3.2/§3.4, B.25), stored by the
 * table in the view column's `displayConfiguration`. Unset keys fall back to the attribute configuration.
 */
export interface DisplayConfiguration {
  numberConfiguration?: { decimalPlaces?: 0 | 1 | 2 | 3 | 4 | null; groups?: 'default' | 'no-groups' | null };
  currencyConfiguration?: {
    displayType?: 'symbol' | 'narrowSymbol' | 'code' | 'name' | null;
    decimalPlaces?: 'two-decimals' | 'no-decimals' | null;
    groups?: 'default' | 'no-groups' | null;
  };
  datetimeConfiguration?: { displayType?: 'absolute' | 'relative' | null };
}

/**
 * Sub-field of a column (`view column.field`): location `locality` | `region` | `country_code` (+ `line_1`…,
 * `postcode`), personal-name `first_name` | `last_name` | `full_name`, interaction `interacted_at` ("When") |
 * `owner_membership_id` ("With").
 */
export type ValueField = string | null | undefined;

export interface ViewProps {
  attribute: AttributeDefinition;
  values: AttributeValue[];
  density: Density;
  recordRef?: RecordRef;
  /** Sub-field column (C1 README §3.2). */
  field?: ValueField;
  /** View-column formatting overrides. */
  format?: DisplayConfiguration;
  /** Cell density: the selected cell shows every value stacked (C1 cells.md §1, `data-expanded`). */
  expanded?: boolean;
  /**
   * Makes the in-place interactions live: checkbox toggles on click, rating sets the clicked star (C1 cells.md §1,
   * README §3.3). Without it these Views are static.
   */
  onCommit?: (next: CommitInput, meta?: CommitMeta) => void;
  /** Field density: placeholder text when empty (record page "Set {title}"). */
  placeholder?: string;
}

export interface EditorProps {
  attribute: AttributeDefinition;
  values: AttributeValue[];
  onCommit: (next: CommitInput, meta?: CommitMeta) => void;
  /** Close without (further) changes: Escape, or click outside a multi-value editor that already wrote. */
  onCancel: (meta?: CommitMeta) => void;
  /** Printable key that opened the editor (typing on a selected cell starts editing with that key). */
  initialKey?: string;
  /** The cell / field element the editor overlays or anchors its popover to. */
  anchor?: HTMLElement | null;
  /** Where the editor is shown (default 'cell'): sizes the overlay and popover offsets. */
  density?: Density;
  recordRef?: RecordRef;
  field?: ValueField;
  format?: DisplayConfiguration;
  /**
   * The value being edited, before it is committed (typing, multi-value toggles): the table broadcasts it to peers in
   * the view presence room (2.15). `null` = no draft (back to the stored value).
   */
  onDraftChange?: (draft: ValueInput[] | null) => void;
  /**
   * Multi-value editors write each toggle at once with `onCommit(ops, {keepOpen: true})` (Attio's behaviour) when the
   * host keeps the editor open on `keepOpen`. Without it (default) they collect the toggles and commit the final set
   * once when closed, which works with any host.
   */
  liveCommit?: boolean;
}

export type EditorKind = 'inline' | 'popover' | 'dialog' | 'readonly';

export interface AttributeUi {
  type: AttributeType;
  View: FC<ViewProps>;
  Editor: FC<EditorProps>;
  editorKind: EditorKind;
  /** Clipboard text of a cell (2.10); options/members/record titles come from the query cache. */
  copyText(values: AttributeValue[], attribute: AttributeDefinition, options?: { field?: ValueField }): string;
  /** Single-cell paste: write forms, or null when the text is not a valid value of the attribute. */
  pasteValue?(text: string, attribute: AttributeDefinition): ValueInput[] | null;
  /** Default column width (C1 README §2.4). */
  defaultWidth: number;
  align: 'start' | 'end';
}

/** Lookups for values that reference other resources (options, stages, members, records). */
export interface ValueLookup {
  option(attribute: AttributeDefinition, id: string): SelectOption | undefined;
  stage(attribute: AttributeDefinition, id: string): PipelineStage | undefined;
  member(id: string): Member | undefined;
  recordTitle(entityDefinitionId: string, entityInstanceId: string): string | undefined;
}
