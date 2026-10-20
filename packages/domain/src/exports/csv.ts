// RFC 4180 CSV: fields with a comma, quote, line break or edge whitespace are quoted (quotes doubled); CRLF line
// ends; UTF-8 with a byte-order mark so spreadsheet apps detect the encoding (Cyrillic names, € …).
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

export function csvField(value: string): string {
  return NEEDS_QUOTES.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Export security (J workspace-admin §5, BACKLOG 6.09): a cell a spreadsheet would read as a formula (=, +, -, @,
 * tab, carriage return first) gets a leading apostrophe when the workspace protects its exports.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
export function protectFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function csvLine(fields: string[], protect = false): string {
  return `${(protect ? fields.map(protectFormula) : fields).map(csvField).join(',')}\r\n`;
}

export function csvBytes(lines: string[]): Uint8Array {
  return new TextEncoder().encode(`﻿${lines.join('')}`);
}
