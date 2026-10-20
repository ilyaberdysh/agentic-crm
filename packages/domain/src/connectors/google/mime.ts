// MIME for the Gmail connector (7.09).
//   in:  a Gmail `users.messages.get?format=full` resource → ConnectorMessage (headers incl. RFC 2047 encoded words,
//        address lists with quoted names / groups / comments, text + html bodies in their declared charsets,
//        attachment metadata, labels)
//   out: an OutgoingMessage → RFC 2822 / MIME text for `users.messages.send` (multipart/alternative text + html,
//        multipart/mixed when there are attachments, In-Reply-To / References for replies)
import type { ConnectorAddress, ConnectorAttachment, ConnectorMessage, OutgoingMessage } from '../types.ts';

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPart;
}

// ---- decoding ------------------------------------------------------------------------------------------------------

/** Postgres text cannot hold NUL; providers occasionally send it. */
const clean = (s: string) => (s.includes('\u0000') ? s.replace(/\u0000/g, '') : s);

export const decodeBase64Url = (data: string): Buffer => Buffer.from(data, 'base64url');

/** Bytes in a declared charset → string (unknown charsets fall back to UTF-8, never throw). */
export function decodeText(bytes: Uint8Array, charset: string | null | undefined): string {
  const label =
    (charset ?? 'utf-8')
      .trim()
      .replace(/^["']|["']$/g, '')
      .toLowerCase() || 'utf-8';
  try {
    return new TextDecoder(label === 'us-ascii' ? 'utf-8' : label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function decodeQ(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '_') bytes.push(0x20);
    else if (c === '=' && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(c.charCodeAt(0) & 0xff);
  }
  return Uint8Array.from(bytes);
}

const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;

/** RFC 2047 encoded words → text (whitespace between adjacent encoded words is dropped). */
export function decodeEncodedWords(value: string): string {
  if (!value.includes('=?')) return value;
  const joined = value.replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bBqQ]\?)/g, '$1');
  return joined.replace(ENCODED_WORD, (_m, charset: string, enc: string, text: string) => {
    const name = charset.split('*')[0] ?? charset;
    const bytes = enc.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : decodeQ(text);
    return decodeText(bytes, name);
  });
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  zwnj: '',
};

export function decodeHtmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

/** Plain text of an HTML body (for messages without a text/plain part). */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');
  return decodeHtmlEntities(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ---- headers -------------------------------------------------------------------------------------------------------

export function header(headers: readonly GmailHeader[] | undefined, name: string): string | null {
  const lower = name.toLowerCase();
  const found = headers?.find((h) => h.name.toLowerCase() === lower);
  return found ? found.value : null;
}

function headerParams(value: string | null): { value: string; params: Record<string, string> } {
  if (!value) return { value: '', params: {} };
  const [first, ...rest] = value.split(';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const key = p.slice(0, eq).trim().toLowerCase();
    params[key] = p
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, '');
  }
  return { value: (first ?? '').trim().toLowerCase(), params };
}

/**
 * RFC 5322 address list → addresses. Handles `Name <a@b>`, `"Last, First" <a@b>`, bare `a@b`, `a@b (Name)`,
 * groups (`Team: a@b, c@d;` / `undisclosed-recipients:;`) and encoded-word names. Unparseable entries are skipped.
 */
export function parseAddressList(value: string | null | undefined): ConnectorAddress[] {
  if (!value) return [];
  const entries: string[] = [];
  let current = '';
  let quoted = false;
  let angle = 0;
  let comment = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i] as string;
    if (quoted) {
      current += c;
      if (c === '\\' && i + 1 < value.length) current += value[++i];
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '(') comment++;
    else if (c === ')' && comment > 0) comment--;
    else if (c === '<' && comment === 0) angle++;
    else if (c === '>' && comment === 0 && angle > 0) angle--;
    else if (comment === 0 && angle === 0 && (c === ',' || c === ';')) {
      entries.push(current);
      current = '';
      continue;
    } else if (comment === 0 && angle === 0 && c === ':') {
      // Group display name: drop it, keep its members.
      current = '';
      continue;
    }
    current += c;
  }
  entries.push(current);
  const out: ConnectorAddress[] = [];
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    const angleMatch = /<([^<>]*)>/.exec(entry);
    let email: string;
    let name: string | null;
    if (angleMatch) {
      email = (angleMatch[1] ?? '').trim();
      name = entry.slice(0, angleMatch.index).trim() || null;
    } else {
      const commentMatch = /\(([^()]*)\)/.exec(entry);
      email = entry.replace(/\([^()]*\)/g, '').trim();
      name = commentMatch?.[1]?.trim() || null;
    }
    email = email.replace(/^mailto:/i, '');
    if (!email.includes('@')) continue;
    if (name) {
      name = name.replace(/^"(.*)"$/s, '$1').replace(/\\(.)/g, '$1');
      name = clean(decodeEncodedWords(name)).trim() || null;
      if (name && name.toLowerCase() === email.toLowerCase()) name = null;
    }
    out.push({ emailAddress: email, name });
  }
  return out;
}

/** `<id@host>` tokens of Message-ID / In-Reply-To / References. */
export function parseMessageIds(value: string | null | undefined): string[] {
  if (!value) return [];
  const ids = value.match(/<[^<>\s]+>/g);
  if (ids) return [...new Set(ids)];
  const bare = value.trim();
  return bare && !/\s/.test(bare) ? [`<${bare}>`] : [];
}

// ---- Gmail message → ConnectorMessage ------------------------------------------------------------------------------

interface Bodies {
  text: string | null;
  html: string | null;
  attachments: ConnectorAttachment[];
  /** Body parts Gmail returned by reference (large bodies): attachment ids to fetch. */
  deferred: string[];
}

function isBodyPart(part: GmailPart, mime: string, filename: string, disposition: string): boolean {
  return (mime === 'text/plain' || mime === 'text/html') && !filename && disposition !== 'attachment';
}

function walk(part: GmailPart, out: Bodies, resolved: ReadonlyMap<string, string>): void {
  const mime = (part.mimeType ?? 'text/plain').toLowerCase();
  if (mime.startsWith('multipart/')) {
    for (const child of part.parts ?? []) walk(child, out, resolved);
    return;
  }
  const disposition = headerParams(header(part.headers, 'Content-Disposition')).value;
  const filename = clean(decodeEncodedWords(part.filename ?? '')).trim();
  if (!isBodyPart(part, mime, filename, disposition)) {
    if (filename || part.body?.attachmentId || disposition === 'attachment') {
      out.attachments.push({
        providerAttachmentId: part.body?.attachmentId ?? `part-${part.partId ?? out.attachments.length}`,
        name: filename || 'attachment',
        contentType: mime,
        size: part.body?.size ?? 0,
      });
    }
    return;
  }
  const ref = part.body?.attachmentId;
  const data = part.body?.data ?? (ref ? resolved.get(ref) : undefined);
  if (!data) {
    if (ref) out.deferred.push(ref);
    return;
  }
  const charset = headerParams(header(part.headers, 'Content-Type')).params.charset ?? null;
  const text = clean(decodeText(decodeBase64Url(data), charset));
  if (mime === 'text/plain' && out.text === null) out.text = text;
  else if (mime === 'text/html' && out.html === null) out.html = text;
}

/** Attachment ids of body parts Gmail did not inline (fetch them, then pass them to toConnectorMessage). */
export function deferredBodyParts(message: GmailMessage): string[] {
  const bodies: Bodies = { text: null, html: null, attachments: [], deferred: [] };
  if (message.payload) walk(message.payload, bodies, new Map());
  return bodies.deferred;
}

function sentAtOf(message: GmailMessage): string {
  const internal = Number(message.internalDate);
  if (Number.isFinite(internal) && internal > 0) return new Date(internal).toISOString();
  const date = Date.parse(header(message.payload?.headers, 'Date') ?? '');
  return new Date(Number.isFinite(date) ? date : Date.now()).toISOString();
}

/**
 * A Gmail message (format=full) as the connector boundary's message. `resolved` holds the base64url data of body
 * parts returned by reference (see deferredBodyParts).
 */
export function toConnectorMessage(
  message: GmailMessage,
  resolved: ReadonlyMap<string, string> = new Map(),
): ConnectorMessage {
  const headers = message.payload?.headers;
  const bodies: Bodies = { text: null, html: null, attachments: [], deferred: [] };
  if (message.payload) walk(message.payload, bodies, resolved);
  const [from] = parseAddressList(header(headers, 'From'));
  const rfcMessageId = parseMessageIds(header(headers, 'Message-ID') ?? header(headers, 'Message-Id'))[0];
  const bodyText = bodies.text ?? (bodies.html ? htmlToText(bodies.html) : '');
  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId ?? null,
    // Gmail always has an id; a message without a Message-ID header still gets a stable dedupe key.
    rfcMessageId: rfcMessageId ?? `<gmail-${message.id}@mail.gmail.com>`,
    inReplyTo: parseMessageIds(header(headers, 'In-Reply-To'))[0] ?? null,
    references: parseMessageIds(header(headers, 'References')),
    subject: clean(decodeEncodedWords(header(headers, 'Subject') ?? '')).trim(),
    snippet: clean(decodeHtmlEntities(message.snippet ?? '')).slice(0, 300),
    bodyText,
    bodyHtml: bodies.html,
    sentAt: sentAtOf(message),
    from: from ?? { emailAddress: '', name: null },
    replyTo: parseAddressList(header(headers, 'Reply-To')),
    to: parseAddressList(header(headers, 'To')),
    cc: parseAddressList(header(headers, 'Cc')),
    bcc: parseAddressList(header(headers, 'Bcc')),
    attachments: bodies.attachments,
    labels: message.labelIds ?? [],
  };
}

// ---- OutgoingMessage → RFC 2822 ------------------------------------------------------------------------------------

const CRLF = '\r\n';
const NON_ASCII_OR_CONTROL = /[^\x20-\x7e]/;

/** RFC 2047 B-encoding of a header phrase when it is not plain ASCII. */
export function encodeWord(value: string): string {
  if (!NON_ASCII_OR_CONTROL.test(value)) return value;
  // Chunks of whole characters ≤ 45 bytes keep each encoded word under 75 characters.
  const words: string[] = [];
  let chunk = '';
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch) > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join(`${CRLF} `);
}

/** Header-safe single line (CR / LF stripped: no header injection through names or subjects). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function formatAddress(a: ConnectorAddress): string {
  const email = oneLine(a.emailAddress);
  const name = a.name ? oneLine(a.name) : '';
  if (!name) return email;
  if (NON_ASCII_OR_CONTROL.test(name)) return `${encodeWord(name)} <${email}>`;
  return /^[A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~]+$/.test(name)
    ? `${name} <${email}>`
    : `"${name.replace(/(["\\])/g, '\\$1')}" <${email}>`;
}

/** A header line folded between items so no line exceeds ~78 characters. */
function folded(name: string, items: string[], separator: string): string {
  let line = `${name}: `;
  const lines: string[] = [];
  items.forEach((item, i) => {
    const piece = i < items.length - 1 ? `${item}${separator}` : item;
    if (line.length + piece.length > 78 && line.trim() !== `${name}:`) {
      lines.push(line.trimEnd());
      line = ` ${piece}`;
    } else line += piece;
  });
  lines.push(line);
  return lines.join(CRLF);
}

const base64Lines = (data: Buffer) => (data.toString('base64').match(/.{1,76}/g) ?? ['']).join(CRLF);

function filenameParams(name: string): { type: string; disposition: string } {
  const safe = oneLine(name) || 'attachment';
  if (!NON_ASCII_OR_CONTROL.test(safe) && !/["\\]/.test(safe)) {
    return { type: `name="${safe}"`, disposition: `filename="${safe}"` };
  }
  const ascii = safe.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return {
    type: `name="${encodeWord(safe).replace(/\r\n /g, ' ')}"`,
    disposition: `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
  };
}

export interface MimeAttachment {
  name: string;
  contentType: string;
  data: Buffer;
}

export interface BuildMimeOptions {
  /** Our Message-ID (`<…>`), so a retried send can be recognised. */
  messageId: string;
  date: Date;
  attachments: MimeAttachment[];
  /** Deterministic boundaries in tests. */
  boundary?: (n: number) => string;
}

/** RFC 2822 text of an outgoing message (UTF-8 bodies, base64 parts, CRLF line endings). */
export function buildMime(message: OutgoingMessage, options: BuildMimeOptions): string {
  const boundary =
    options.boundary ??
    ((n: number) => `=_attio_re_${n}_${options.messageId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`);
  const lines: string[] = [];
  lines.push(`From: ${formatAddress(message.from)}`);
  if (message.to.length > 0) lines.push(folded('To', message.to.map(formatAddress), ', '));
  if (message.cc.length > 0) lines.push(folded('Cc', message.cc.map(formatAddress), ', '));
  if (message.bcc.length > 0) lines.push(folded('Bcc', message.bcc.map(formatAddress), ', '));
  lines.push(`Subject: ${encodeWord(oneLine(message.subject))}`);
  lines.push(`Date: ${options.date.toUTCString().replace('GMT', '+0000')}`);
  lines.push(`Message-ID: ${options.messageId}`);
  if (message.inReplyTo) lines.push(`In-Reply-To: ${oneLine(message.inReplyTo)}`);
  const references = [...new Set([...message.references, ...(message.inReplyTo ? [message.inReplyTo] : [])])];
  if (references.length > 0) lines.push(folded('References', references.map(oneLine), ' '));
  lines.push('MIME-Version: 1.0');

  const alternative = boundary(1);
  const alternativePart = [
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    '',
    `--${alternative}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(message.bodyText, 'utf8')),
    `--${alternative}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(message.bodyHtml || '', 'utf8')),
    `--${alternative}--`,
  ];
  if (options.attachments.length === 0) {
    lines.push(...alternativePart);
    return `${lines.join(CRLF)}${CRLF}`;
  }
  const mixed = boundary(0);
  lines.push(`Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`, ...alternativePart);
  for (const a of options.attachments) {
    const names = filenameParams(a.name);
    lines.push(
      `--${mixed}`,
      `Content-Type: ${oneLine(a.contentType) || 'application/octet-stream'}; ${names.type}`,
      `Content-Disposition: attachment; ${names.disposition}`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(a.data),
    );
  }
  lines.push(`--${mixed}--`);
  return `${lines.join(CRLF)}${CRLF}`;
}
