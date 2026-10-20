// Output types of the "Output" menu (formulas.md §3.4, §4.7): "Auto" (the inferred type in secondary text) and the 8
// overrides; labels and icons per output kind for the menu button, the dialog's "Output" chip and the settings row.
import type { OutputKind, OutputOverride } from '@agentic-crm/formula';
import type { IconName } from '@agentic-crm/ui';

export const OUTPUT_LABELS: Record<OutputKind, string> = {
  text: 'Text',
  number: 'Number',
  checkbox: 'Checkbox',
  currency: 'Currency',
  date: 'Date',
  timestamp: 'Timestamp',
  rating: 'Rating',
  'entity-reference': 'Record',
  'actor-reference': 'User',
  location: 'Location',
  'phone-number': 'Phone number',
};

export const OUTPUT_ICONS: Record<OutputKind, IconName> = {
  text: 'attrText',
  number: 'attrNumber',
  checkbox: 'attrCheckbox',
  currency: 'attrCurrency',
  date: 'attrDate',
  timestamp: 'attrTimestamp',
  rating: 'attrRating',
  'entity-reference': 'attrRecord',
  'actor-reference': 'attrActor',
  location: 'attrLocation',
  'phone-number': 'attrPhone',
};

/** Menu order of the overrides (§4.7). */
export const OVERRIDE_ORDER: readonly OutputOverride[] = [
  'text',
  'number',
  'checkbox',
  'date',
  'timestamp',
  'rating',
  'currency',
  'phone-number',
];

export function outputLabel(kind: string | null | undefined): string {
  return kind && kind in OUTPUT_LABELS ? OUTPUT_LABELS[kind as OutputKind] : 'Text';
}

export function outputIcon(kind: string | null | undefined): IconName {
  return kind && kind in OUTPUT_ICONS ? OUTPUT_ICONS[kind as OutputKind] : 'attrText';
}

/** "Output: Auto" / "Output: Number" (the button shows the override, Auto otherwise). */
export function outputButtonLabel(override: OutputOverride | null): string {
  return override ? `Output: ${OUTPUT_LABELS[override]}` : 'Output: Auto';
}
