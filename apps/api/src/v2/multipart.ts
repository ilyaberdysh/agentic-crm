// Minimal multipart/form-data parser for the public file upload (POST /v2/files/upload: fields `file`, `object`,
// `record_id`, `parent_folder_id`; 50 MB). The whole body is buffered by Fastify (bounded by the parser's bodyLimit).
import { publicErrors } from './errors';

export interface MultipartFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

export interface MultipartBody {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
}

export function isMultipartBody(value: unknown): value is MultipartBody {
  return typeof value === 'object' && value !== null && 'fields' in value && 'files' in value;
}

function boundaryOf(contentType: string): string {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) throw publicErrors.validation('The multipart body has no boundary.');
  return boundary.trim();
}

function headerParam(header: string, name: string): string | undefined {
  // (?<![\w*]) keeps `name` from matching inside `filename` (or `filename*`).
  const quoted = new RegExp(`(?<![\\w*])${name}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(header);
  if (quoted?.[1] !== undefined) return quoted[1].replace(/\\(.)/g, '$1');
  const bare = new RegExp(`(?<![\\w*])${name}=([^;\\s]+)`, 'i').exec(header);
  return bare?.[1];
}

export function parseMultipart(body: Buffer, contentType: string): MultipartBody {
  const delimiter = Buffer.from(`--${boundaryOf(contentType)}`);
  const out: MultipartBody = { fields: {}, files: {} };
  let start = body.indexOf(delimiter);
  if (start === -1) throw publicErrors.validation('The multipart body is malformed.');
  for (;;) {
    let partStart = start + delimiter.length;
    if (body.subarray(partStart, partStart + 2).toString() === '--') break; // closing delimiter
    if (body.subarray(partStart, partStart + 2).toString() === '\r\n') partStart += 2;
    const next = body.indexOf(delimiter, partStart);
    if (next === -1) throw publicErrors.validation('The multipart body is malformed.');
    const part = body.subarray(partStart, next - 2); // strip the CRLF before the delimiter
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) throw publicErrors.validation('The multipart body is malformed.');
    const headers = part.subarray(0, headerEnd).toString('utf8').split('\r\n');
    const data = part.subarray(headerEnd + 4);
    const disposition = headers.find((h) => /^content-disposition:/i.test(h)) ?? '';
    const type = headers
      .find((h) => /^content-type:/i.test(h))
      ?.split(':')[1]
      ?.trim();
    const name = headerParam(disposition, 'name');
    const filename = headerParam(disposition, 'filename');
    if (name) {
      if (filename !== undefined) {
        out.files[name] = { filename, contentType: type || 'application/octet-stream', data: Buffer.from(data) };
      } else {
        out.fields[name] = data.toString('utf8');
      }
    }
    start = next;
  }
  return out;
}
