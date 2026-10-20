// Shared types of the views feature.
import type { Path, Predicate, Sort, View, ViewColumn } from '@agentic-crm/contracts';

/** The predicate AST of a view (contracts `Predicate`, X-20); `null` = no filter. */
export type FilterAst = Predicate | null;

export type { Path, Sort, View, ViewColumn };

/** Where a new column goes: at the end (default) or next to an existing column (header menu "Insert left/right"). */
export type ColumnPosition = 'end' | { leftOf: string } | { rightOf: string };

export interface AddColumnInput {
  path: Path;
  /** Sub-field of multi-field types (location `locality | region | country_code`, name parts, interaction fields). */
  field?: string | null;
  title?: string | null;
  position?: ColumnPosition;
}

/** Everything about a column that is saved immediately. */
export interface ColumnPatch {
  title?: string | null;
  tableColumnWidth?: number | null;
  tableColumnAggregationType?: ViewColumn['tableColumnAggregationType'];
  displayConfiguration?: Record<string, unknown>;
}

/** Move target: a final index among the columns, or the neighbours to land between. */
export type ColumnMoveTarget = { index: number } | { before: string } | { after: string };
