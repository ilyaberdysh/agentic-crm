// Clipboard (BACKLOG 2.10; C1 README §3.6): copy the active cell or a cell range as `text/plain` (TSV) and
// `text/html` (a table) — toast "1 cell copied" / "{n} cells copied"; paste is single-cell (Attio's multi-cell paste
// semantics are unknown, BACKLOG defer list): the first clipboard cell goes through the registry's `pasteValue`.

export function toTsv(matrix: string[][]): string {
  return matrix.map((row) => row.map((cell) => cell.replace(/[\t\n\r]+/g, ' ')).join('\t')).join('\n');
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toHtmlTable(matrix: string[][]): string {
  const rows = matrix.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
  return `<table><tbody>${rows}</tbody></table>`;
}

/** First cell of pasted text (TSV clipboard content from spreadsheets or our own copy). */
export function firstClipboardCell(text: string): string {
  const firstLine = text.replace(/\r\n?/g, '\n').split('\n')[0] ?? '';
  return (firstLine.split('\t')[0] ?? '').trim();
}

export function cellsCopiedLabel(n: number): string {
  return n === 1 ? '1 cell copied' : `${n.toLocaleString()} cells copied`;
}
