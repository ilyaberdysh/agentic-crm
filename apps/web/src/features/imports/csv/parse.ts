// CSV parsing in the browser (C2 import.md §I2): the chosen file is decoded and parsed client-side, no network until
// "Next". Encoding: BOM (UTF-8 / UTF-16 LE / BE), else strict UTF-8, else Windows-1252 (Excel's default "CSV" on
// Western locales). Delimiter: Papa Parse's guess among , ; tab | (European Excel writes ';'). The first row holds the
// column titles; trailing blank lines are dropped and every row is padded / cut to the header width. Limits and
// messages are Attio's documented ones (100 columns, 100,000 rows, 100 MB).
import Papa from 'papaparse';

export const CSV_LIMITS = { columns: 100, rows: 100_000, bytes: 100 * 1024 * 1024 } as const;

export type CsvErrorCode =
  | 'invalid-file'
  | 'too-large'
  | 'parse-error'
  | 'no-columns'
  | 'no-rows'
  | 'too-many-columns'
  | 'too-many-rows';

export const CSV_ERROR_MESSAGES: Record<CsvErrorCode, string> = {
  'invalid-file': 'Please upload a valid CSV file',
  'too-large': 'Please upload a file smaller than 100MB',
  'parse-error': 'There was an error parsing this file',
  'no-columns': 'This file does not contain any columns',
  'no-rows': 'This file does not contain any rows',
  'too-many-columns': `Please upload a file with fewer than ${CSV_LIMITS.columns} columns`,
  'too-many-rows': `Please upload a file with at most ${CSV_LIMITS.rows.toLocaleString('en-US')} rows`,
};

export class CsvError extends Error {
  constructor(readonly code: CsvErrorCode) {
    super(CSV_ERROR_MESSAGES[code]);
    this.name = 'CsvError';
  }
}

export interface ParsedTable {
  /** Column titles (blank headers become "Column N"). */
  headers: string[];
  /** Data rows, each exactly `headers.length` cells. */
  rows: string[][];
  delimiter: string;
}

export interface ParsedCsv extends ParsedTable {
  fileName: string;
  fileSize: number;
  encoding: string;
}

/** Bytes → text. Returns the encoding used (for diagnostics; the upload always sends UTF-16 JS strings). */
export function decodeCsv(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

const DELIMITERS = [',', ';', '\t', '|'];

/** Text → header + rows (throws CsvError). */
export function parseCsvText(text: string): ParsedTable {
  const body = text.replace(/^﻿/, '');
  if (!body.trim()) throw new CsvError('no-columns');
  const result = Papa.parse<string[]>(body, {
    delimiter: '',
    delimitersToGuess: DELIMITERS,
    skipEmptyLines: 'greedy',
  });
  const data = result.data.filter((row) => Array.isArray(row));
  // Papa reports recoverable issues (e.g. a missing closing quote at EOF) as errors but still returns rows; only a
  // file with nothing usable is a parse error.
  if (data.length === 0) throw new CsvError(result.errors.length > 0 ? 'parse-error' : 'no-columns');
  const first = data[0] as string[];
  // Trailing empty header cells (a trailing delimiter) are not columns.
  let width = first.length;
  while (width > 0 && !(first[width - 1] ?? '').trim()) width--;
  if (width === 0) throw new CsvError('no-columns');
  if (width > CSV_LIMITS.columns) throw new CsvError('too-many-columns');
  const headers = first.slice(0, width).map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows: string[][] = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r] as string[];
    const cells = row.slice(0, width);
    while (cells.length < width) cells.push('');
    if (cells.every((c) => !c.trim())) continue;
    rows.push(cells);
  }
  if (rows.length === 0) throw new CsvError('no-rows');
  if (rows.length > CSV_LIMITS.rows) throw new CsvError('too-many-rows');
  return { headers, rows, delimiter: result.meta.delimiter || ',' };
}

export function isCsvFile(file: Pick<File, 'name' | 'type'>): boolean {
  if (/\.csv$/i.test(file.name)) return true;
  return file.type === 'text/csv' || file.type === 'application/csv';
}

/** A chosen / dropped file → parsed table (throws CsvError). */
export async function parseCsvFile(file: File): Promise<ParsedCsv> {
  if (!isCsvFile(file)) throw new CsvError('invalid-file');
  if (file.size > CSV_LIMITS.bytes) throw new CsvError('too-large');
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new CsvError('parse-error');
  }
  const { text, encoding } = decodeCsv(bytes);
  return { ...parseCsvText(text), fileName: file.name, fileSize: file.size, encoding };
}

/** "376 B", "12.4 KB", "3.1 MB" (the file card under the drop zone). */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

/** Up to `limit` distinct sample values of a column, in file order ("Empty" rows are represented by ''). */
export function exampleValues(rows: readonly string[][], column: number, limit = 10): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const v = row[column] ?? '';
    const key = v.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}
