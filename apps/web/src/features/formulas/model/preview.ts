// Preview text of the helper header (formulas.md §4.6): the value (text as is, otherwise JSON, truncated to 500
// characters), "No value", "Can't preview: syntax error", "Can't preview: {code}", "Preview failed".
import type { PreviewFormulaOutput } from '@agentic-crm/contracts';

const MAX_PREVIEW = 500;

/** Display text of a preview response (pure; unit-tested). */
export function previewDisplay(
  result: PreviewFormulaOutput | undefined,
  failed: boolean,
): {
  text: string;
  muted: boolean;
} | null {
  if (failed) return { text: 'Preview failed', muted: true };
  if (!result) return null;
  if (result.type === 'syntax_error') return { text: "Can't preview: syntax error", muted: true };
  if (result.type === 'evaluation_error') return { text: `Can't preview: ${result.code}`, muted: true };
  if (result.value === null || result.value === undefined) return { text: 'No value', muted: true };
  const raw =
    result.display ??
    (result.outputType === 'text' && typeof result.value === 'string' ? result.value : JSON.stringify(result.value));
  return { text: raw.length > MAX_PREVIEW ? `${raw.slice(0, MAX_PREVIEW)}…` : raw, muted: false };
}
