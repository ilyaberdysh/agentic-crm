// Highlight keys: how the chart and the calculated-values table name the same element (`highlightKey` /
// `onHighlight` of ReportChartProps). A key names a group (a bar / slice / point column / table row), a series (a legend
// item, every segment of one segment value) or one cell (group × segment).

const NULL_TOKEN = '∅';

const token = (key: string | null | undefined): string => (key === null || key === undefined ? NULL_TOKEN : key);

/** Key of a whole group: "g:<group>" (null group → "g:∅"). */
export const groupHighlightKey = (group: string | null): string => `g:${token(group)}`;

/** Key of a series: "s:<segment>". */
export const seriesHighlightKey = (segment: string | null): string => `s:${token(segment)}`;

/** Key of one cell (group × segment): "g:<group>|s:<segment>". */
export const cellHighlightKey = (group: string | null, segment: string | null): string =>
  `${groupHighlightKey(group)}|${seriesHighlightKey(segment)}`;

export interface ParsedHighlight {
  group?: string;
  segment?: string;
}

export function parseHighlightKey(key: string | null | undefined): ParsedHighlight | null {
  if (!key) return null;
  const out: ParsedHighlight = {};
  for (const part of key.split('|')) {
    if (part.startsWith('g:')) out.group = part.slice(2);
    else if (part.startsWith('s:')) out.segment = part.slice(2);
  }
  return out.group === undefined && out.segment === undefined ? null : out;
}

/** Whether an element (group, segment) is the highlighted one (or part of it). No highlight → nothing matches. */
export function matchesHighlight(
  highlight: ParsedHighlight | null,
  group: string | null | undefined,
  segment?: string | null | undefined,
): boolean {
  if (!highlight) return false;
  if (highlight.group !== undefined && (group === undefined || highlight.group !== token(group))) return false;
  if (highlight.segment !== undefined && (segment === undefined || highlight.segment !== token(segment))) return false;
  return true;
}

/** Whether a series (every cell of one segment value) is the highlighted one; a group-only highlight matches all. */
export function matchesSeries(highlight: ParsedHighlight | null, segment: string | null): boolean {
  if (!highlight || highlight.segment === undefined) return true;
  return highlight.segment === token(segment);
}

/** Whether a table row (named by `rowKey`) is what `highlightKey` points at: every field the highlight names must agree. */
export function highlightMatchesKey(highlightKey: string | null | undefined, rowKey: string): boolean {
  const hl = parseHighlightKey(highlightKey);
  const row = parseHighlightKey(rowKey);
  if (!hl || !row) return false;
  if (hl.group !== undefined && hl.group !== row.group) return false;
  if (hl.segment !== undefined && hl.segment !== row.segment) return false;
  return true;
}
