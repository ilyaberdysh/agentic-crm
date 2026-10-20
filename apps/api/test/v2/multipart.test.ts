// The multipart/form-data parser behind POST /v2/files/upload.
import { describe, expect, it } from 'vitest';
import { parseMultipart } from '../../src/v2/multipart';

const CRLF = '\r\n';
const body = (boundary: string, parts: string[]) =>
  Buffer.from(`${parts.map((p) => `--${boundary}${CRLF}${p}${CRLF}`).join('')}--${boundary}--${CRLF}`, 'utf8');

describe('parseMultipart', () => {
  it.each([
    ['name before filename', 'form-data; name="file"; filename="a.txt"'],
    ['filename before name', 'form-data; filename="a.txt"; name="file"'],
    ['unquoted name', 'form-data; name=file; filename="a.txt"'],
  ])('reads a file part with %s', (_label, disposition) => {
    const parsed = parseMultipart(
      body('XyZ', [
        `Content-Disposition: form-data; name="object"${CRLF}${CRLF}companies`,
        `Content-Disposition: ${disposition}${CRLF}Content-Type: text/plain${CRLF}${CRLF}hello${CRLF}world`,
      ]),
      'multipart/form-data; boundary=XyZ',
    );
    expect(parsed.fields).toEqual({ object: 'companies' });
    expect(parsed.files.file?.filename).toBe('a.txt');
    expect(parsed.files.file?.contentType).toBe('text/plain');
    expect(parsed.files.file?.data.toString()).toBe(`hello${CRLF}world`);
  });

  it('accepts quoted boundaries and refuses bodies without one', () => {
    const parsed = parseMultipart(
      body('b-1', [`Content-Disposition: form-data; name="x"${CRLF}${CRLF}1`]),
      'multipart/form-data; boundary="b-1"',
    );
    expect(parsed.fields.x).toBe('1');
    expect(() => parseMultipart(Buffer.from('x'), 'multipart/form-data')).toThrow(/boundary/);
    expect(() => parseMultipart(Buffer.from('garbage'), 'multipart/form-data; boundary=q')).toThrow(/malformed/);
  });
});
