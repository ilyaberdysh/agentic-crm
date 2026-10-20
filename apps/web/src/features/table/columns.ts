// Table columns from view columns ( entity-view-attribute): the implicit record column first,
// then the view's columns in rank order. A column's path ends at the attribute it shows (path length > 1 = related
// record column "Parent › Child"); widths default per type (C1 table: 250 record, 180 default, 200 timestamp,
// 100 checkbox, 140 rating; min 100 / 150, max 500).
import type { AttributeDefinition, Path, ViewColumn } from '@agentic-crm/contracts';
import type { IconName } from '@agentic-crm/ui';
import { attributeIcon } from '../views';
import { type AttributeUi, type DisplayConfiguration, getAttributeUi, readColumnFormat } from './contracts';

export const ROW_HEIGHT = 36;
export const HEADER_HEIGHT = 40;
export const FOOTER_HEIGHT = 37;
export const RECORD_COLUMN = { default: 250, min: 150, max: 500 } as const;
export const COLUMN_LIMITS = { min: 100, max: 500 } as const;
export const ADD_COLUMN_MIN_WIDTH = 250;

export interface TableColumn {
  key: string;
  column: ViewColumn;
  /** The attribute at the end of the path (on a related object for path columns); undefined when deleted. */
  attribute: AttributeDefinition | undefined;
  /** Attributes along the path, first hop first. */
  hops: (AttributeDefinition | undefined)[];
  title: string;
  /** Underlying attribute title(s) when the label is overridden. */
  attributeTitle: string;
  ui: AttributeUi;
  width: number;
  isPath: boolean;
  readOnly: boolean;
  /** Read only because the member's access level forbids value edits (not a property of the attribute). */
  policyLocked?: boolean;
  /** Footer calculations are available (any column of a known attribute; paths aggregate the first related record). */
  canAggregate: boolean;
  /** Sub-field shown by the column (location part, name part, interaction field). */
  field: string | null;
  /** Column formatting overrides for cells, editors and the footer. */
  format: DisplayConfiguration | undefined;
}

const SYSTEM_READ_ONLY = new Set(['created_at', 'created_by', 'record_id', 'next_due_task']);

/** Header icon: the views feature's per-type icon (system attributes get their own). */
export function headerIcon(attribute: AttributeDefinition | undefined): IconName {
  return attribute ? attributeIcon(attribute) : 'attrText';
}

/** View-column formatting overrides (views store `{datetime, currency, number}`) in the registry's shape (B.25). */
export function columnDisplayFormat(
  displayConfiguration: Record<string, unknown> | null | undefined,
): DisplayConfiguration | undefined {
  const f = readColumnFormat(displayConfiguration);
  const out: DisplayConfiguration = {};
  if (f.number) {
    out.numberConfiguration = { decimalPlaces: f.number.decimalPlaces ?? null, groups: f.number.groups ?? null };
  }
  if (f.currency) {
    out.currencyConfiguration = {
      displayType: f.currency.displayType ?? null,
      decimalPlaces: f.currency.decimalPlaces ?? null,
      groups: f.currency.groups ?? null,
    };
  }
  if (f.datetime) out.datetimeConfiguration = { displayType: f.datetime.displayType };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Attribute lookup across the object and the related objects reached by paths. */
export type AttributeIndex = Map<string, AttributeDefinition>;

/**
 * `editablePathHead`: list tables (features/lists) edit parent-record columns in place — a 2-hop path whose first hop
 * is this attribute (the entry's single `parent_record`) writes the leaf attribute on the referenced record.
 */
export function buildColumns(
  viewColumns: ViewColumn[],
  attributes: AttributeIndex,
  pathLabel?: (path: Path, field: string | null) => string,
  editablePathHead?: string,
): TableColumn[] {
  return viewColumns.map((column) => {
    const hops = column.path.map((hop) => attributes.get(hop.attributeDefinitionId));
    const attribute = hops[hops.length - 1];
    const ui = getAttributeUi(attribute?.type ?? 'text');
    const attributeTitle =
      (attribute && pathLabel?.(column.path, column.field)) ||
      hops.map((h) => h?.title ?? 'Deleted attribute').join(' › ');
    const isPath = column.path.length > 1;
    const throughHead =
      isPath && editablePathHead !== undefined && column.path.length === 2 && hops[0]?.id === editablePathHead;
    const readOnly =
      !attribute ||
      (isPath && !throughHead) ||
      attribute.isReadOnly ||
      ui.editorKind === 'readonly' ||
      (attribute.isSystem && SYSTEM_READ_ONLY.has(attribute.apiSlug));
    const width = clampWidth(column.tableColumnWidth ?? ui.defaultWidth);
    return {
      key: column.id,
      column,
      attribute,
      hops,
      title: column.title?.trim() || attributeTitle,
      attributeTitle,
      ui,
      width,
      isPath,
      readOnly,
      canAggregate: Boolean(attribute),
      field: column.field,
      format: columnDisplayFormat(column.displayConfiguration),
    };
  });
}

export function clampWidth(width: number): number {
  return Math.min(COLUMN_LIMITS.max, Math.max(COLUMN_LIMITS.min, Math.round(width)));
}

export function clampRecordWidth(width: number): number {
  return Math.min(RECORD_COLUMN.max, Math.max(RECORD_COLUMN.min, Math.round(width)));
}
