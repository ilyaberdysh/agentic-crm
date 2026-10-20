import { describe, expect, it } from 'vitest';
import { CsvError, decodeCsv, exampleValues, formatFileSize, parseCsvText } from './parse';

describe('parseCsvText', () => {
  it('parses headers and rows with quoted cells', () => {
    const t = parseCsvText('Code,Summary,Budget\nSEED-I01,"Alpha, beta","12500,50"\nSEED-I02,Beta,8000\n');
    expect(t.headers).toEqual(['Code', 'Summary', 'Budget']);
    expect(t.rows).toEqual([
      ['SEED-I01', 'Alpha, beta', '12500,50'],
      ['SEED-I02', 'Beta', '8000'],
    ]);
    expect(t.delimiter).toBe(',');
  });

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsvText('a;b;c\n1;2;3\n4;5;6').delimiter).toBe(';');
    expect(parseCsvText('a\tb\n1\t2').rows).toEqual([['1', '2']]);
  });

  it('pads short rows, cuts long rows, drops blank lines and trailing empty headers', () => {
    const t = parseCsvText('a,b,\n1\n\n2,3,4,5\n,,\n');
    expect(t.headers).toEqual(['a', 'b']);
    expect(t.rows).toEqual([
      ['1', ''],
      ['2', '3'],
    ]);
  });

  it('names blank headers', () => {
    expect(parseCsvText('a,,c\n1,2,3').headers).toEqual(['a', 'Column 2', 'c']);
  });

  it('rejects empty files and header-only files', () => {
    expect(() => parseCsvText('')).toThrow(CsvError);
    expect(() => parseCsvText('a,b\n')).toThrowError('This file does not contain any rows');
  });

  it('rejects too many columns', () => {
    const header = Array.from({ length: 101 }, (_, i) => `c${i}`).join(',');
    expect(() => parseCsvText(`${header}\n${header}`)).toThrowError(/fewer than 100 columns/);
  });
});

describe('decodeCsv', () => {
  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a,b')]);
    expect(decodeCsv(bytes)).toEqual({ text: 'a,b', encoding: 'utf-8' });
  });

  it('falls back to Windows-1252 for invalid UTF-8', () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in Latin-1
    expect(decodeCsv(bytes)).toEqual({ text: 'café', encoding: 'windows-1252' });
  });

  it('decodes UTF-16 LE with BOM', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]);
    expect(decodeCsv(bytes).text).toBe('a,b');
  });
});

describe('helpers', () => {
  it('formats file sizes', () => {
    expect(formatFileSize(376)).toBe('376 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });

  it('collects distinct example values in file order', () => {
    expect(
      exampleValues(
        [
          ['a', '4'],
          ['b', ''],
          ['c', '4'],
        ],
        1,
      ),
    ).toEqual(['4', '']);
  });
});
