// Flat blocks ↔ markdown, matching Attio's public API mapping (E README §6, editor.md §6):
//   BOLD → **x**, ITALIC → *x*, STRIKETHROUGH → ~~x~~, HIGHLIGHTED → ==x== (colour lost), COLORED → dropped,
//   LINK → [text](url), headings → # / ## / ###, list items → "- " / "1. " with 2 spaces of indentation per level,
//   one block per line (single newline separators), images omitted, mentions as plain `@Name`.
// Markdown input accepts #/##/###, -/*/+ and "1." lists (indented by 2 or 4 spaces per level), **/__ bold, */_
// italic, ~~ strike, == highlight and [text](url); `>`, backticks, `1)` and #### stay literal text.
// The serializer escapes markdown-significant characters so that blocksToMarkdown → markdownToBlocks is lossless for
// text, block types, indents and the styles markdown can express (colours, mentions and images are not carried).
import { type Block, type InlineStyle, MAX_INDENT, type StyleRange } from './blocks.ts';
import { listNumbers } from './numbering.ts';
import { sortStyles } from './pm.ts';

// ---- serialiser ------------------------------------------------------------------------------------------------

type MdStyle = Extract<InlineStyle, 'LINK' | 'BOLD' | 'ITALIC' | 'STRIKETHROUGH' | 'HIGHLIGHTED'>;
/** Outer → inner nesting order when several marks open at the same position. */
const MD_ORDER: MdStyle[] = ['LINK', 'BOLD', 'ITALIC', 'STRIKETHROUGH', 'HIGHLIGHTED'];
const OPEN: Record<MdStyle, string> = { LINK: '[', BOLD: '**', ITALIC: '*', STRIKETHROUGH: '~~', HIGHLIGHTED: '==' };

const isWs = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isAlnum = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

function escapeChar(text: string, i: number, inLink: boolean): string {
  const ch = text[i] as string;
  const prev = text[i - 1];
  const next = text[i + 1];
  switch (ch) {
    case '\\':
    case '*':
      return `\\${ch}`;
    case '_':
      // Intraword underscores (snake_case) never act as delimiters.
      return isAlnum(prev) && isAlnum(next) ? ch : `\\${ch}`;
    case '~':
    case '=':
      return prev === ch || next === ch ? `\\${ch}` : ch;
    case '[':
      return inLink ? `\\${ch}` : ch;
    case ']':
      return inLink || next === '(' ? `\\${ch}` : ch;
    case '\n':
      // Hard line break inside a block: backslash at end of line (CommonMark hard break).
      return '\\\n';
    default:
      return ch;
  }
}

function linkDestination(url: string): string {
  return url
    .replace(/\\/g, '\\\\')
    .replace(/ /g, '%20')
    .replace(/([()])/g, '\\$1');
}

interface MdRange {
  style: MdStyle;
  start: number;
  end: number;
  link?: string;
}

/** Style ranges trimmed of surrounding whitespace (delimiters must hug non-space characters). */
function mdRanges(text: string, styles: readonly StyleRange[]): MdRange[] {
  const out: MdRange[] = [];
  for (const r of styles) {
    if (!(MD_ORDER as string[]).includes(r.style)) continue;
    let start = Math.max(0, r.start);
    let end = Math.min(text.length, r.start + r.length);
    while (start < end && isWs(text[start])) start++;
    while (end > start && isWs(text[end - 1])) end--;
    if (end <= start) continue;
    out.push({ style: r.style as MdStyle, start, end, ...(r.link ? { link: r.link } : {}) });
  }
  return out;
}

function inlineMarkdown(block: Block): string {
  const { text } = block;
  const ranges = mdRanges(text, block.styles);
  const cuts = new Set<number>([0, text.length]);
  for (const r of ranges) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const keyOf = (r: MdRange) => `${r.style}:${r.link ?? ''}`;
  const stack: MdRange[] = [];
  let out = '';
  const close = (r: MdRange) => {
    out += r.style === 'LINK' ? `](${linkDestination(r.link ?? '')})` : OPEN[r.style];
  };
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i] as number;
    const to = points[i + 1] as number;
    if (to <= from) continue;
    const active = ranges
      .filter((r) => r.start <= from && r.end >= to)
      .sort((a, b) => MD_ORDER.indexOf(a.style) - MD_ORDER.indexOf(b.style));
    const wanted = new Set(active.map(keyOf));
    let keep = 0;
    while (keep < stack.length && wanted.has(keyOf(stack[keep] as MdRange))) keep++;
    while (stack.length > keep) close(stack.pop() as MdRange);
    const open = new Set(stack.map(keyOf));
    for (const r of active) {
      if (open.has(keyOf(r))) continue;
      out += OPEN[r.style];
      stack.push(r);
    }
    const inLink = stack.some((r) => r.style === 'LINK');
    for (let c = from; c < to; c++) out += escapeChar(text, c, inLink);
  }
  while (stack.length > 0) close(stack.pop() as MdRange);
  return out;
}

/** Escapes a paragraph line that would otherwise parse as a heading or list item. */
function escapeLineStart(body: string): string {
  if (/^#{1,6}(\s|$)/.test(body)) return `\\${body}`;
  if (/^[-+](\s|$)/.test(body)) return `\\${body}`;
  const numbered = /^(\d+)\.(\s|$)/.exec(body);
  if (numbered) return `${numbered[1]}\\${body.slice((numbered[1] as string).length)}`;
  return body;
}

/** Blocks → markdown (one line per block; images omitted). */
export function blocksToMarkdown(blocks: readonly Block[]): string {
  const numbers = listNumbers(blocks);
  const lines: string[] = [];
  blocks.forEach((block, i) => {
    if (block.type === 'image-embed') return;
    const body = inlineMarkdown(block);
    const pad = '  '.repeat(Math.max(0, block.indent));
    switch (block.type) {
      case 'h1':
        lines.push(`# ${body}`);
        break;
      case 'h2':
        lines.push(`## ${body}`);
        break;
      case 'h3':
        lines.push(`### ${body}`);
        break;
      case 'ul':
        lines.push(`${pad}- ${body}`);
        break;
      case 'ol':
        lines.push(`${pad}${numbers[i] ?? 1}. ${body}`);
        break;
      default:
        lines.push(escapeLineStart(body));
    }
  });
  return lines.join('\n');
}

// ---- parser ----------------------------------------------------------------------------------------------------

const ASCII_PUNCT = /[!-/:-@[-`{-~]/;

/** Colour given to `==highlight==` from markdown input. */
export const DEFAULT_HIGHLIGHT = 'pastel_yellow';

type Piece =
  | { t: 'text'; v: string }
  | { t: 'open'; id: number }
  | { t: 'close'; id: number; style: InlineStyle; link?: string }
  | Run;

/** A delimiter run that may still open emphasis; consumed characters become markers, leftovers stay literal. */
interface Run {
  t: 'run';
  ch: '*' | '_' | '~' | '=' | '[';
  /** Characters not yet consumed by a match. */
  count: number;
  /** Open-marker ids in consumption order (first = innermost). */
  opens: number[];
  /** Still eligible as an opener. */
  active: boolean;
}

interface ParsedInline {
  text: string;
  styles: StyleRange[];
}

function readLinkTail(src: string, i: number): { url: string; end: number } | null {
  // src[i] === ']' and src[i + 1] === '('
  let j = i + 2;
  let depth = 0;
  let url = '';
  while (j < src.length) {
    const ch = src[j] as string;
    if (ch === '\\' && j + 1 < src.length && ASCII_PUNCT.test(src[j + 1] as string)) {
      url += src[j + 1];
      j += 2;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      if (depth === 0) return url === '' ? null : { url: decodeSpaces(url), end: j + 1 };
      depth--;
    }
    if (/\s/.test(ch)) {
      // Optional "title" before the closing parenthesis.
      const title = /^\s+"[^"]*"\s*\)/.exec(src.slice(j));
      if (title && url !== '') return { url: decodeSpaces(url), end: j + title[0].length };
      return null;
    }
    url += ch;
    j++;
  }
  return null;
}

function decodeSpaces(url: string): string {
  return url.replace(/%20/g, ' ');
}

/** Inline markdown → plain text + style ranges (lenient CommonMark subset). */
export function parseInlineMarkdown(src: string): ParsedInline {
  const pieces: Piece[] = [];
  const stack: Run[] = [];
  let nextId = 1;
  const pairs = new Map<number, true>();
  let buffer = '';
  const flush = () => {
    if (buffer !== '') pieces.push({ t: 'text', v: buffer });
    buffer = '';
  };

  /** Removes openers above index `k` (they turn literal). */
  const discardAbove = (k: number) => {
    while (stack.length > k + 1) (stack.pop() as Run).active = false;
  };

  const findOpener = (ch: Run['ch']): number => {
    for (let k = stack.length - 1; k >= 0; k--) {
      const run = stack[k] as Run;
      if (run.ch === ch) return k;
    }
    return -1;
  };

  const match = (opener: Run, style: InlineStyle, link?: string): Piece => {
    const id = nextId++;
    opener.opens.push(id);
    pairs.set(id, true);
    return link !== undefined ? { t: 'close', id, style, link } : { t: 'close', id, style };
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === '\\' && i + 1 < src.length && ASCII_PUNCT.test(src[i + 1] as string)) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '*' || ch === '_' || ch === '~' || ch === '=') {
      let n = 1;
      while (src[i + n] === ch) n++;
      const prev = i > 0 ? src[i - 1] : undefined;
      const next = src[i + n];
      if ((ch === '~' || ch === '=') && n !== 2) {
        buffer += ch.repeat(n);
        i += n;
        continue;
      }
      let canOpen = !isWs(next);
      let canClose = !isWs(prev);
      if (ch === '_') {
        canOpen = canOpen && !isAlnum(prev);
        canClose = canClose && !isAlnum(next);
      }
      flush();
      let remaining = n;
      if (canClose) {
        while (remaining > 0) {
          const k = findOpener(ch);
          if (k < 0) break;
          const opener = stack[k] as Run;
          discardAbove(k);
          if (ch === '~' || ch === '=') {
            pieces.push(match(opener, ch === '~' ? 'STRIKETHROUGH' : 'HIGHLIGHTED', undefined));
            opener.count = 0;
            remaining = 0;
          } else if (opener.count % 2 === 1) {
            // The innermost unit of an odd run (1 or 3 characters) is a single delimiter: italic.
            pieces.push(match(opener, 'ITALIC'));
            opener.count -= 1;
            remaining -= 1;
          } else if (remaining >= 2) {
            pieces.push(match(opener, 'BOLD'));
            opener.count -= 2;
            remaining -= 2;
          } else {
            break; // a single delimiter cannot close a bold opener: it may open instead
          }
          if (opener.count === 0) {
            opener.active = false;
            stack.splice(k, 1);
          }
        }
      }
      if (remaining > 0) {
        const run: Run = { t: 'run', ch, count: remaining, opens: [], active: canOpen && remaining <= 3 };
        pieces.push(run);
        if (run.active) stack.push(run);
      }
      i += n;
      continue;
    }
    if (ch === '[') {
      flush();
      const run: Run = { t: 'run', ch: '[', count: 1, opens: [], active: true };
      pieces.push(run);
      stack.push(run);
      i++;
      continue;
    }
    if (ch === ']' && src[i + 1] === '(') {
      let k = -1;
      for (let s = stack.length - 1; s >= 0; s--) {
        if ((stack[s] as Run).ch === '[') {
          k = s;
          break;
        }
      }
      const tail = k >= 0 ? readLinkTail(src, i) : null;
      if (k >= 0 && tail) {
        flush();
        const opener = stack[k] as Run;
        discardAbove(k);
        pieces.push(match(opener, 'LINK', tail.url));
        opener.count = 0;
        opener.active = false;
        stack.splice(k, 1);
        // Links cannot contain links: earlier brackets are no longer openers.
        for (const run of stack) if (run.ch === '[') run.active = false;
        for (let s = stack.length - 1; s >= 0; s--) if (!(stack[s] as Run).active) stack.splice(s, 1);
        i = tail.end;
        continue;
      }
    }
    buffer += ch;
    i++;
  }
  flush();

  // Render: runs → literal leftovers + open markers (outermost first); then compute positions.
  let text = '';
  const starts = new Map<number, number>();
  const styles: StyleRange[] = [];
  const openRun = (run: Run) => {
    text += run.ch.repeat(run.count);
    for (let k = run.opens.length - 1; k >= 0; k--) starts.set(run.opens[k] as number, text.length);
  };
  for (const piece of pieces) {
    if (piece.t === 'text') text += piece.v;
    else if (piece.t === 'run') openRun(piece);
    else if (piece.t === 'close') {
      const start = starts.get(piece.id);
      if (start === undefined || !pairs.has(piece.id)) continue;
      if (text.length > start)
        styles.push({
          start,
          length: text.length - start,
          style: piece.style,
          ...(piece.link !== undefined ? { link: piece.link } : {}),
          // `==x==` carries no colour (Attio drops it on output); input gets the default highlighter yellow.
          ...(piece.style === 'HIGHLIGHTED' ? { color: DEFAULT_HIGHLIGHT } : {}),
        });
    }
  }
  return { text, styles: normalizeStyles(styles) };
}

/** Merges overlapping/adjacent ranges of the same style and value; drops empty ones; canonical order. */
export function normalizeStyles(styles: readonly StyleRange[]): StyleRange[] {
  const groups = new Map<string, StyleRange[]>();
  for (const r of styles) {
    if (r.length <= 0) continue;
    const key = `${r.style}\u0000${r.link ?? ''}\u0000${r.color ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push({ ...r });
    groups.set(key, list);
  }
  const out: StyleRange[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.start - b.start);
    let current: StyleRange | null = null;
    for (const r of list) {
      if (current && r.start <= current.start + current.length) {
        current.length = Math.max(current.start + current.length, r.start + r.length) - current.start;
      } else {
        if (current) out.push(current);
        current = r;
      }
    }
    if (current) out.push(current);
  }
  return sortStyles(out);
}

/** Markdown → blocks. Blank lines separate blocks and are not kept. */
export function markdownToBlocks(markdown: string): Block[] {
  const raw = markdown.replace(/\r\n?/g, '\n').split('\n');
  // Join hard-break continuations (a line ending in an odd number of backslashes).
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i] as string;
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < raw.length) {
      line = `${line.slice(0, -1)}\n${raw[++i] as string}`;
    }
    lines.push(line);
  }
  const listLine = /^([ \t]*)(?:([-*+])|(\d+)\.)(?:[ \t](.*))?$/s;
  // Indentation unit of nested lists: the smallest non-zero indentation (2 or 4 spaces in practice).
  let unit = 0;
  for (const line of lines) {
    const m = listLine.exec(line);
    if (!m) continue;
    const width = (m[1] as string).replace(/\t/g, '  ').length;
    if (width > 0 && (unit === 0 || width < unit)) unit = width;
  }
  if (unit === 0) unit = 2;

  const blocks: Block[] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const heading = /^(#{1,3})(?:[ \t](.*))?$/s.exec(line);
    if (heading) {
      const level = (heading[1] as string).length as 1 | 2 | 3;
      const { text, styles } = parseInlineMarkdown(heading[2] ?? '');
      blocks.push({ type: `h${level}`, indent: 0, text, styles, mentions: [] });
      continue;
    }
    const list = listLine.exec(line);
    if (list && (list[2] !== '*' || list[4] !== undefined || line.trim() === '*')) {
      const width = (list[1] as string).replace(/\t/g, '  ').length;
      const indent = Math.max(0, Math.min(MAX_INDENT, Math.round(width / unit)));
      const { text, styles } = parseInlineMarkdown(list[4] ?? '');
      blocks.push({ type: list[3] !== undefined ? 'ol' : 'ul', indent, text, styles, mentions: [] });
      continue;
    }
    const { text, styles } = parseInlineMarkdown(line.replace(/^[ \t]+/, ''));
    blocks.push({ type: 'unstyled', indent: 0, text, styles, mentions: [] });
  }
  return blocks;
}
