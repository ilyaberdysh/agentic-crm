// A small reader for the markdown projection of note bodies (documents.markdown, E README §6 mapping): headings
// `#`–`###`, `-`/`*`/`+` and `1.` list items with 2 spaces of indent per level, **bold**, *italic*, ~~strike~~,
// ==highlight==, [links](url). Used for read-only previews until (and wherever) the editor's flat blocks are absent.

export type PreviewBlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol';

export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  highlight?: boolean;
  href?: string;
}

export interface PreviewBlock {
  type: PreviewBlockType;
  indent: number;
  spans: InlineSpan[];
  /** 1-based number of an `ol` item among its siblings. */
  number?: number;
}

const INLINE =
  /(\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|==([^=]+)==|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_)/g;

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let last = 0;
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(text); m; m = INLINE.exec(text)) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    if (m[2] ?? m[3]) spans.push({ text: (m[2] ?? m[3]) as string, bold: true });
    else if (m[4]) spans.push({ text: m[4], strike: true });
    else if (m[5]) spans.push({ text: m[5], highlight: true });
    else if (m[6]) spans.push({ text: m[6], href: m[7] });
    else spans.push({ text: (m[8] ?? m[9]) as string, italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}

export function parseMarkdown(markdown: string): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  const counters: number[] = [];
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (raw.trim() === '') continue;
    const indentSpaces = raw.match(/^ */)?.[0].length ?? 0;
    const indent = Math.floor(indentSpaces / 2);
    const line = raw.trimStart();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: `h${(heading[1] as string).length}` as PreviewBlockType,
        indent: 0,
        spans: parseInline(heading[2] as string),
      });
      counters.length = 0;
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({ type: 'ul', indent, spans: parseInline(bullet[1] as string) });
      counters.length = indent;
      continue;
    }
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      counters.length = indent + 1;
      counters[indent] = (counters[indent] ?? 0) + 1;
      blocks.push({ type: 'ol', indent, spans: parseInline(numbered[1] as string), number: counters[indent] });
      continue;
    }
    counters.length = 0;
    blocks.push({ type: 'paragraph', indent: 0, spans: parseInline(line) });
  }
  return blocks;
}

/** First line of plain text (list rows: "title + first-line preview in grey"). */
export function firstLine(content: { plaintext: string | null; markdown: string | null } | undefined | null): string {
  const source = content?.plaintext ?? content?.markdown ?? '';
  const line = source.split('\n').find((l) => l.trim() !== '') ?? '';
  return line
    .replace(/^#{1,3}\s+|^\s*([-*+]|\d+[.)])\s+/, '')
    .replace(/[*_~=]{2}|\*|_/g, '')
    .trim();
}

export function isEmptyContent(
  content: { plaintext: string | null; markdown: string | null } | undefined | null,
): boolean {
  return !(content?.plaintext ?? content?.markdown ?? '').trim();
}
