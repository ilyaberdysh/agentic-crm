// Diagnostics → editor marks: every diagnostic marks its range with `cm-formula-error`
// (zero-width diagnostics — a missing expression at the end — mark the character before them, or the last character);
// chips inside a marked range show the error state; the helper header summarises "Multiple errors (n)" and its
// tooltip lists each message with "Line n" / "Lines a-b".
import type { Diagnostic } from '@agentic-crm/formula';

export interface ErrorRange {
  from: number;
  to: number;
  message: string;
}

/** Non-empty ranges within the document for each diagnostic (diagnostics use editor offsets). */
export function errorRanges(diagnostics: readonly Diagnostic[], docLength: number): ErrorRange[] {
  if (docLength === 0) return [];
  const out: ErrorRange[] = [];
  for (const d of diagnostics) {
    let from = Math.max(0, Math.min(d.from, docLength));
    let to = Math.max(from, Math.min(d.to, docLength));
    if (to === from) {
      if (from > 0) from -= 1;
      else to = Math.min(docLength, 1);
    }
    out.push({ from, to, message: d.message });
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/** The diagnostic message under `pos` (hover), the innermost range first. */
export function messageAt(ranges: readonly ErrorRange[], pos: number): ErrorRange | null {
  let best: ErrorRange | null = null;
  for (const r of ranges) {
    if (pos < r.from || pos > r.to) continue;
    if (!best || r.to - r.from < best.to - best.from) best = r;
  }
  return best;
}

/** Error message of a chip spanning [from, to), if a diagnostic covers it. */
export function chipError(ranges: readonly ErrorRange[], from: number, to: number): string | null {
  for (const r of ranges) if (r.from <= from && r.to >= to) return r.message;
  for (const r of ranges) if (r.from < to && r.to > from) return r.message;
  return null;
}

/** "Line 3" / "Lines 2-4" for the summary tooltip. */
export function lineLabel(d: Pick<Diagnostic, 'line' | 'endLine'>): string {
  return d.endLine > d.line ? `Lines ${d.line}-${d.endLine}` : `Line ${d.line}`;
}
