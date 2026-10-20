// Footer calculation kinds per attribute type (filters-sorts-calcs §8; the per-type list is the contracts' sentence
// table `columnAggregationsFor`) and the record-count display. The server derives counts and percentages itself
// (`snapshots.aggregate` → `value` / `valueText`); the client only formats. Pure.
import {
  type AttributeType,
  type ColumnAggregation,
  type ColumnAggregationOption,
  columnAggregationsFor,
} from '@agentic-crm/contracts';

export type { ColumnAggregation, ColumnAggregationOption };

export function aggregationOptions(type: AttributeType): readonly ColumnAggregationOption[] {
  return columnAggregationsFor(type);
}

export function aggregationSuffix(type: AttributeType, kind: ColumnAggregation): string {
  return aggregationOptions(type).find((o) => o.value === kind)?.suffix ?? '';
}

export const isPercent = (kind: ColumnAggregation) => kind === 'percent_empty' || kind === 'percent_not_empty';
export const isCount = (kind: ColumnAggregation) => kind === 'count_empty' || kind === 'count_not_empty';

/** Compact count under the record column: "1,933" below 10,000, "12K" from there (C1 §8). */
export function formatCount(total: number, locale?: string): string {
  return new Intl.NumberFormat(locale, total >= 10_000 ? { notation: 'compact', maximumFractionDigits: 1 } : {}).format(
    total,
  );
}
