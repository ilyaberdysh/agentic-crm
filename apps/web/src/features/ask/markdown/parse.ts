// Markdown of assistant answers (ask-agentic-internals §3.3, §5): a small block + inline parser tuned for streamed text.
//   - headings are flattened to bold paragraphs; GFM tables; bullet / numbered lists (nested by indentation); quotes;
//   - fenced blocks whose info string is `agentic-crm:<identifier>` become component blocks (generative embeds), other fences
//     are code blocks;
//   - links `agentic-crm://entity-instance:<def>/<id>` become record chips, `agentic-crm://meeting:<id>` meeting links;
//   - while the text is still streaming (`streaming: true`) unfinished syntax renders sensibly: an unclosed `**` is
//     bold to the end, an unfinished `[text](url` stays plain text, a table row being typed is hidden, and an unclosed
//     component fence is a `partial` component (a skeleton until complete).
// Pure functions; the React renderer lives in Markdown.tsx.

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'bold'; children: Inline[] }
  | { t: 'italic'; children: Inline[] }
  | { t: 'strike'; children: Inline[] }
  | { t: 'code'; text: string }
  | { t: 'link'; href: string; children: Inline[] }
  | { t: 'record'; entityDefinitionId: string; entityInstanceId: string; label: string }
  | { t: 'meeting'; meetingId: string; label: string };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { t: 'p'; children: Inline[] }
  | { t: 'ul'; items: Block[][] }
  | { t: 'ol'; start: number; items: Block[][] }
  | { t: 'quote'; children: Block[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'code'; lang: string; text: string; partial: boolean }
  | { t: 'component'; id: string; data: string; partial: boolean; key: string };

export interface ParseOptions {
  /** The text is still arriving: tolerate unfinished syntax. */
  streaming?: boolean;
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const RECORD_HREF = new RegExp(`^agentic-crm://entity-instance:(${UUID})/(${UUID})$`);
const MEETING_HREF = new RegExp(`^agentic-crm://meeting:(${UUID})$`);

// ---- inline ----------------------------------------------------------------------------------------------------------------

const URL_RE = /^(?:https?:\/\/|www\.)[^\s<>()[\]]+[^\s<>()[\].,;:!?'"]/;
const BARE_DOMAIN_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|ai|co|dev|app|example|gov|edu|info|me|uk|de|nl|fr|ru)\b(?:\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"])?/i;

function pushText(out: Inline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.t === 'text') last.text += text;
  else out.push({ t: 'text', text });
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** Index of the matching `]` for the `[` at `open`, honouring nested brackets; -1 when missing. */
function closingBracket(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `(url)` right after `at`; returns the url and the index after `)`. */
function linkTarget(src: string, at: number): { url: string; end: number } | null {
  if (src[at] !== '(') return null;
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        const raw = src.slice(at + 1, i).trim();
        // `(url "title")`: keep the url.
        const url = raw.replace(/\s+"[^"]*"$/, '');
        return { url, end: i + 1 };
      }
    }
  }
  return null;
}

function plainText(inlines: Inline[]): string {
  return inlines
    .map((i) => {
      switch (i.t) {
        case 'text':
        case 'code':
          return i.text;
        case 'record':
        case 'meeting':
          return i.label;
        default:
          return plainText(i.children);
      }
    })
    .join('');
}

export function parseInline(src: string, options: ParseOptions = {}): Inline[] {
  const streaming = options.streaming ?? false;
  const out: Inline[] = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    pushText(out, buf);
    buf = '';
  };
  while (i < src.length) {
    const ch = src[i] as string;
    const rest = src.slice(i);

    if (ch === '\\' && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!~|>]/.test(src[i + 1] as string)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    if (ch === '`') {
      const ticks = /^`+/.exec(rest)?.[0] ?? '`';
      const close = src.indexOf(ticks, i + ticks.length);
      if (close > i + ticks.length - 1 && close !== -1) {
        flush();
        out.push({ t: 'code', text: src.slice(i + ticks.length, close).replace(/^ (.*) $/, '$1') });
        i = close + ticks.length;
        continue;
      }
      if (streaming && ticks.length === 1 && !src.slice(i + 1).includes('\n')) {
        // Trailing backtick being typed: show the rest as code.
        flush();
        const text = src.slice(i + 1);
        if (text) out.push({ t: 'code', text });
        i = src.length;
        continue;
      }
      buf += ticks;
      i += ticks.length;
      continue;
    }

    if (ch === '[') {
      const close = closingBracket(src, i);
      const target = close === -1 ? null : linkTarget(src, close + 1);
      if (close !== -1 && target) {
        flush();
        const labelSrc = src.slice(i + 1, close);
        const children = parseInline(labelSrc, options);
        const record = RECORD_HREF.exec(target.url);
        const meeting = MEETING_HREF.exec(target.url);
        if (record) {
          out.push({
            t: 'record',
            entityDefinitionId: (record[1] as string).toLowerCase(),
            entityInstanceId: (record[2] as string).toLowerCase(),
            label: plainText(children) || 'Record',
          });
        } else if (meeting) {
          out.push({ t: 'meeting', meetingId: (meeting[1] as string).toLowerCase(), label: plainText(children) });
        } else if (/^(https?:|mailto:|tel:|\/)/i.test(target.url)) {
          out.push({ t: 'link', href: target.url, children });
        } else if (/^agentic-crm:/i.test(target.url)) {
          // Unknown typed link: plain text.
          for (const c of children) out.push(c);
        } else if (/^[\w-]+(\.[\w-]+)+/.test(target.url)) {
          out.push({ t: 'link', href: `http://${target.url}`, children });
        } else {
          for (const c of children) out.push(c);
        }
        i = target.end;
        continue;
      }
      // `[text](url` or `[text` still arriving (streaming) or just a bracket: plain text.
      buf += ch;
      i++;
      continue;
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      const run = /^(\*\*|__|~~|\*|_)/.exec(rest)?.[0];
      if (run) {
        const prev = src[i - 1];
        const isUnderscore = run[0] === '_';
        const canOpen =
          !(isUnderscore && isWordChar(prev)) && !/^\s/.test(src.slice(i + run.length, i + run.length + 1) || ' ');
        if (canOpen) {
          // Find the closing delimiter: not preceded by whitespace, and (for `_`) not followed by a word char.
          let close: number = -1;
          let from: number = i + run.length;
          while (from < src.length) {
            const at: number = src.indexOf(run, from);
            if (at === -1) break;
            const before: string | undefined = src[at - 1];
            const after: string | undefined = src[at + run.length];
            const closes =
              at > i + run.length &&
              before !== undefined &&
              !/\s/.test(before) &&
              !(isUnderscore && isWordChar(after)) &&
              // `*` must not be the start of `**` when we opened with a single `*`.
              !(run.length === 1 && after === run && !isUnderscore);
            if (closes) {
              close = at;
              break;
            }
            from = at + 1;
          }
          if (close !== -1) {
            flush();
            const children = parseInline(src.slice(i + run.length, close), options);
            out.push({ t: run === '~~' ? 'strike' : run.length === 2 ? 'bold' : 'italic', children });
            i = close + run.length;
            continue;
          }
          if (streaming && run !== '~~' && !isUnderscore) {
            // Unclosed emphasis at the end of the streamed text: styled to the end.
            const inner = src.slice(i + run.length);
            if (inner.trim() !== '') {
              flush();
              out.push({ t: run.length === 2 ? 'bold' : 'italic', children: parseInline(inner, options) });
              i = src.length;
              continue;
            }
            // Only the opener so far: hide it.
            i = src.length;
            continue;
          }
        }
        // Only the opener has arrived (`a **`): hide it while streaming.
        if (streaming && !isUnderscore && run !== '~~' && i + run.length >= src.length) {
          i = src.length;
          continue;
        }
        buf += run;
        i += run.length;
        continue;
      }
    }

    if (ch === 'h' || ch === 'w' || /[a-z0-9]/i.test(ch)) {
      // Links and bare domains start at a word boundary only.
      const prev = src[i - 1];
      if (!isWordChar(prev) && prev !== '@' && prev !== '/' && prev !== '.') {
        const url = URL_RE.exec(rest)?.[0];
        if (url) {
          flush();
          const href = url.startsWith('www.') ? `http://${url}` : url;
          out.push({ t: 'link', href, children: [{ t: 'text', text: url }] });
          i += url.length;
          continue;
        }
        const domain = BARE_DOMAIN_RE.exec(rest)?.[0];
        if (domain && !/^\d+(\.\d+)+$/.test(domain)) {
          flush();
          out.push({ t: 'link', href: `http://${domain}`, children: [{ t: 'text', text: domain }] });
          i += domain.length;
          continue;
        }
      }
    }

    if (ch === '\n') {
      buf += ' ';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

// ---- blocks ----------------------------------------------------------------------------------------------------------------

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const BULLET = /^( *)([-*+])\s+(.*)$/;
const ORDERED = /^( *)(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function indentOf(line: string): number {
  return /^ */.exec(line)?.[0].length ?? 0;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (ch === '\\' && s[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

/** Whether `line` could start a block of its own (ends a paragraph). */
function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE_OPEN.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    HEADING.test(line) ||
    /^ {0,3}>/.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEPARATOR.test(next) && next.includes('-'))
  );
}

export function parseBlocks(src: string, options: ParseOptions = {}): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  return blocksOf(lines, options, { counter: new Map() });
}

interface Ctx {
  /** Count of component blocks per identifier (block keys, §3.3 `block_key`). */
  counter: Map<string, number>;
}

function blocksOf(lines: string[], options: ParseOptions, ctx: Ctx): Block[] {
  const streaming = options.streaming ?? false;
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code / component block.
    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const marker = fence[2] as string;
      const info = (fence[3] as string) ?? '';
      const indent = (fence[1] as string).length;
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const l = lines[j] as string;
        if (new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(l)) {
          closed = true;
          break;
        }
        body.push(indent > 0 ? l.replace(new RegExp(`^ {0,${indent}}`), '') : l);
        j++;
      }
      const text = body.join('\n');
      if (info.startsWith('agentic-crm:')) {
        const id = info.slice('agentic-crm:'.length);
        const n = ctx.counter.get(id) ?? 0;
        ctx.counter.set(id, n + 1);
        blocks.push({ t: 'component', id, data: text, partial: !closed && streaming, key: `${id}:${n}` });
      } else {
        blocks.push({ t: 'code', lang: info, text, partial: !closed && streaming });
      }
      i = closed ? j + 1 : j;
      continue;
    }

    // Heading → bold paragraph.
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ t: 'p', children: [{ t: 'bold', children: parseInline(heading[2] as string, options) }] });
      i++;
      continue;
    }

    // Quote.
    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i] as string)) {
        quoted.push((lines[i] as string).replace(/^ {0,3}> ?/, ''));
        i++;
      }
      blocks.push({ t: 'quote', children: blocksOf(quoted, options, ctx) });
      continue;
    }

    // Table.
    const next = lines[i + 1];
    if (line.includes('|') && next !== undefined && TABLE_SEPARATOR.test(next) && next.includes('-')) {
      const head = splitRow(line);
      const separators = splitRow(next);
      if (separators.length === head.length || separators.length > 1) {
        const align = separators.map(alignOf);
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && !isBlank(lines[j]) && (lines[j] as string).includes('|')) {
          rows.push(splitRow(lines[j] as string));
          j++;
        }
        // A row still being typed (fewer cells than the header, or no closing pipe) stays hidden.
        const lastRow = rows[rows.length - 1];
        if (
          streaming &&
          j === lines.length &&
          lastRow &&
          (lastRow.length < head.length || !(lines[j - 1] as string).trim().endsWith('|'))
        ) {
          rows.pop();
        }
        const width = head.length;
        blocks.push({
          t: 'table',
          align: Array.from({ length: width }, (_, k) => align[k] ?? null),
          head: head.map((c) => parseInline(c, options)),
          rows: rows.map((r) => Array.from({ length: width }, (_, k) => parseInline(r[k] ?? '', options))),
        });
        i = j;
        continue;
      }
    }

    // Lists.
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      const base = ((bullet ?? ordered) as RegExpExecArray)[1]?.length ?? 0;
      const isOrdered = Boolean(ordered);
      const start = ordered ? Number(ordered[2]) : 1;
      const items: Block[][] = [];
      let j = i;
      while (j < lines.length) {
        const l = lines[j] as string;
        const m = isOrdered ? ORDERED.exec(l) : BULLET.exec(l);
        if (!m || (m[1]?.length ?? 0) !== base) break;
        const first = m[3] as string;
        const content: string[] = [first];
        j++;
        // Continuation lines: indented deeper than the marker, or blank lines followed by such a line.
        while (j < lines.length) {
          const c = lines[j] as string;
          if (isBlank(c)) {
            let k = j;
            while (k < lines.length && isBlank(lines[k])) k++;
            if (k < lines.length && indentOf(lines[k] as string) > base) {
              content.push('');
              j++;
              continue;
            }
            break;
          }
          const ind = indentOf(c);
          if (ind > base) {
            content.push(c.slice(Math.min(ind, base + 2 + (isOrdered ? 1 : 0))));
            j++;
            continue;
          }
          // A lazy continuation of the paragraph (no marker, not a new block).
          if (!BULLET.test(c) && !ORDERED.test(c) && !startsBlock(c, lines[j + 1])) {
            content.push(c);
            j++;
            continue;
          }
          break;
        }
        // Blank lines between items do not end the list.
        let k = j;
        while (k < lines.length && isBlank(lines[k])) k++;
        items.push(blocksOf(content, options, ctx));
        if (k < lines.length) {
          const nm = isOrdered ? ORDERED.exec(lines[k] as string) : BULLET.exec(lines[k] as string);
          if (nm && (nm[1]?.length ?? 0) === base) j = k;
        }
      }
      blocks.push(isOrdered ? { t: 'ol', start, items } : { t: 'ul', items });
      i = j;
      continue;
    }

    // Paragraph: until a blank line or the start of another block.
    const para: string[] = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i] as string, lines[i + 1])) {
      para.push(lines[i] as string);
      i++;
    }
    const text = para.map((l) => l.trim()).join('\n');
    // Streaming: a lone `|` row or a trailing bullet marker being typed is not content yet.
    if (streaming && i === lines.length && /^[-*+|]?\s*$/.test(text)) continue;
    blocks.push({ t: 'p', children: parseInline(text, options) });
  }
  return blocks;
}

// ---- component data --------------------------------------------------------------------------------------------------------

/** JSON body of a component block; null when it is not (yet) valid JSON. */
export function parseComponentJson(data: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(data) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Best-effort parse of an unfinished JSON object: closes open strings, arrays and objects. */
export function parsePartialJson(data: string): Record<string, unknown> | null {
  const complete = parseComponentJson(data);
  if (complete) return complete;
  let s = data.trimEnd();
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) s += '"';
  s = s.replace(/[,:]\s*$/, (m) => (m.startsWith(':') ? ': null' : ''));
  s += stack.reverse().join('');
  return parseComponentJson(s);
}

/** Plain text of parsed blocks (copy button, thread titles). */
export function blocksToPlainText(blocks: Block[]): string {
  const lines: string[] = [];
  const walk = (list: Block[], indent: string) => {
    for (const b of list) {
      switch (b.t) {
        case 'p':
          lines.push(indent + plainText(b.children));
          break;
        case 'ul':
          for (const item of b.items) {
            const [first, ...restBlocks] = item;
            lines.push(`${indent}- ${first && first.t === 'p' ? plainText(first.children) : ''}`);
            walk(restBlocks, `${indent}  `);
          }
          break;
        case 'ol':
          b.items.forEach((item, n) => {
            const [first, ...restBlocks] = item;
            lines.push(`${indent}${b.start + n}. ${first && first.t === 'p' ? plainText(first.children) : ''}`);
            walk(restBlocks, `${indent}   `);
          });
          break;
        case 'quote':
          walk(b.children, `${indent}> `);
          break;
        case 'table':
          lines.push(indent + b.head.map(plainText).join(' | '));
          for (const r of b.rows) lines.push(indent + r.map(plainText).join(' | '));
          break;
        case 'code':
          lines.push(b.text);
          break;
        case 'component':
          break;
      }
    }
  };
  walk(blocks, '');
  return lines.join('\n');
}
