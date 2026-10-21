// ProseMirror JSON ↔ flat blocks. The editor's document is already flat (one top-level textblock per block, list
// items carry kind + indent), so the conversion is a direct walk: inline text nodes and their marks become style
// ranges, mention nodes become `@label` text plus a mention reference, hard breaks become `\n`.
import {
  type Block,
  type BlockType,
  IMAGE_ALIGNMENTS,
  type ImageAlignment,
  type ImageEmbed,
  INLINE_STYLES,
  type InlineStyle,
  MAX_INDENT,
  type MentionRef,
  type StyleRange,
  VARIABLE_PLACEHOLDER,
  type VariableRef,
} from './blocks.ts';
import { isHighlightColor, isTextColor } from './colors.ts';

export interface PMMarkJSON {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PMNodeJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNodeJSON[];
  marks?: PMMarkJSON[];
  text?: string;
}

const STYLE_ORDER = new Map<InlineStyle, number>(INLINE_STYLES.map((s, i) => [s, i]));

/** Style key of a mark: one key per distinct (style, value); unknown marks (e.g. pasted underline) are dropped. */
function styleOfMark(mark: PMMarkJSON): { style: InlineStyle; link?: string; color?: string } | null {
  switch (mark.type) {
    case 'bold':
      return { style: 'BOLD' };
    case 'italic':
      return { style: 'ITALIC' };
    case 'strike':
      return { style: 'STRIKETHROUGH' };
    case 'link': {
      const href = mark.attrs?.href;
      return typeof href === 'string' && href !== '' ? { style: 'LINK', link: href } : null;
    }
    case 'textColor': {
      const color = mark.attrs?.color;
      return isTextColor(color) ? { style: 'COLORED', color } : null;
    }
    case 'highlight': {
      const color = mark.attrs?.color;
      return isHighlightColor(color) ? { style: 'HIGHLIGHTED', color } : null;
    }
    default:
      return null;
  }
}

function keyOf(s: { style: InlineStyle; link?: string; color?: string }): string {
  return `${s.style}\u0000${s.link ?? ''}\u0000${s.color ?? ''}`;
}

/** Orders ranges canonically: by start, then style, then value. */
export function sortStyles(styles: StyleRange[]): StyleRange[] {
  return styles.sort(
    (a, b) =>
      a.start - b.start ||
      (STYLE_ORDER.get(a.style) ?? 0) - (STYLE_ORDER.get(b.style) ?? 0) ||
      (a.link ?? a.color ?? '').localeCompare(b.link ?? b.color ?? '') ||
      a.length - b.length,
  );
}

interface Segment {
  start: number;
  end: number;
  marks: PMMarkJSON[];
}

/** Merges per-segment marks into maximal style ranges. */
function rangesFromSegments(segments: Segment[]): StyleRange[] {
  const open = new Map<string, StyleRange>();
  const done: StyleRange[] = [];
  let cursor = 0;
  const closeAll = (keep: Set<string>) => {
    for (const [key, range] of open) {
      if (keep.has(key)) continue;
      done.push(range);
      open.delete(key);
    }
  };
  for (const seg of segments) {
    if (seg.start !== cursor) closeAll(new Set());
    const keys = new Set<string>();
    const styles: Array<{ style: InlineStyle; link?: string; color?: string }> = [];
    for (const mark of seg.marks) {
      const s = styleOfMark(mark);
      if (!s) continue;
      const key = keyOf(s);
      if (keys.has(key)) continue;
      keys.add(key);
      styles.push(s);
    }
    closeAll(keys);
    for (const s of styles) {
      const key = keyOf(s);
      const existing = open.get(key);
      if (existing) existing.length = seg.end - existing.start;
      else
        open.set(key, {
          start: seg.start,
          length: seg.end - seg.start,
          style: s.style,
          ...(s.link !== undefined ? { link: s.link } : {}),
          ...(s.color !== undefined ? { color: s.color } : {}),
        });
    }
    cursor = seg.end;
  }
  closeAll(new Set());
  return sortStyles(done.filter((r) => r.length > 0));
}

function parsePath(raw: unknown): VariableRef['path'] | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const path: VariableRef['path'] = [];
  for (const step of value) {
    const s = step as { entityDefinitionId?: unknown; attributeDefinitionId?: unknown };
    if (typeof s?.attributeDefinitionId !== 'string' || s.attributeDefinitionId === '') return null;
    path.push({
      entityDefinitionId: typeof s.entityDefinitionId === 'string' ? s.entityDefinitionId : null,
      attributeDefinitionId: s.attributeDefinitionId,
    });
  }
  return path;
}

function inlineToBlockText(
  content: PMNodeJSON[] | undefined,
): Pick<Block, 'text' | 'styles' | 'mentions'> & { variables: VariableRef[] } {
  let text = '';
  const segments: Segment[] = [];
  const mentions: MentionRef[] = [];
  const variables: VariableRef[] = [];
  for (const node of content ?? []) {
    if (node.type === 'text') {
      const value = node.text ?? '';
      if (value === '') continue;
      segments.push({ start: text.length, end: text.length + value.length, marks: node.marks ?? [] });
      text += value;
    } else if (node.type === 'hardBreak') {
      text += '\n';
    } else if (node.type === 'mention') {
      const attrs = node.attrs ?? {};
      const label = `@${String(attrs.label ?? '')}`;
      const start = text.length;
      const id = String(attrs.id ?? '');
      if (id !== '') {
        if (attrs.kind === 'record')
          mentions.push({
            type: 'record',
            start,
            length: label.length,
            id,
            entityDefinitionId: String(attrs.entityDefinitionId ?? ''),
          });
        else mentions.push({ type: 'member', start, length: label.length, id });
      }
      // Mentions carry no marks (by default; Yjs does not keep marks on inline atoms either).
      text += label;
    } else if (node.type === 'variable') {
      // A variable occupies one placeholder character (B.11).
      const attrs = node.attrs ?? {};
      const path = parsePath(attrs.path);
      if (path) {
        variables.push({
          start: text.length,
          length: 1,
          path,
          field: typeof attrs.field === 'string' && attrs.field !== '' ? attrs.field : null,
          fallback: typeof attrs.fallback === 'string' ? attrs.fallback : null,
          ...(typeof attrs.label === 'string' && attrs.label !== '' ? { label: attrs.label } : {}),
        });
        text += VARIABLE_PLACEHOLDER;
      }
    } else if (node.content) {
      // Unknown inline wrapper (should not happen with the schema): keep its text.
      const inner = inlineToBlockText(node.content);
      text += inner.text;
    }
  }
  return { text, styles: rangesFromSegments(segments), mentions, variables };
}

function clampIndent(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_INDENT, Math.trunc(n))) : 0;
}

function positiveOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ProseMirror JSON of a document → flat blocks. */
export function pmJsonToBlocks(doc: PMNodeJSON): Block[] {
  const blocks: Block[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === 'image') {
      const attrs = node.attrs ?? {};
      const alignment = (IMAGE_ALIGNMENTS as readonly string[]).includes(String(attrs.alignment))
        ? (attrs.alignment as ImageAlignment)
        : 'center';
      const image: ImageEmbed = {
        src: typeof attrs.src === 'string' ? attrs.src : null,
        assetId: typeof attrs.assetId === 'string' ? attrs.assetId : null,
        width: positiveOrNull(attrs.width),
        height: positiveOrNull(attrs.height),
        alignment,
        caption: typeof attrs.caption === 'string' && attrs.caption !== '' ? attrs.caption.slice(0, 256) : null,
      };
      blocks.push({ type: 'image-embed', indent: 0, text: '', styles: [], mentions: [], image });
      continue;
    }
    let type: BlockType = 'unstyled';
    let indent = 0;
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level ?? 1);
      type = level === 2 ? 'h2' : level === 3 ? 'h3' : 'h1';
    } else if (node.type === 'listItem') {
      type = node.attrs?.kind === 'ol' ? 'ol' : 'ul';
      indent = clampIndent(node.attrs?.indent);
    }
    const { variables, ...inline } = inlineToBlockText(node.content);
    blocks.push({ type, indent, ...inline, ...(variables.length > 0 ? { variables } : {}) });
  }
  return blocks;
}

function markOfStyle(range: StyleRange): PMMarkJSON | null {
  switch (range.style) {
    case 'BOLD':
      return { type: 'bold' };
    case 'ITALIC':
      return { type: 'italic' };
    case 'STRIKETHROUGH':
      return { type: 'strike' };
    case 'LINK':
      return range.link ? { type: 'link', attrs: { href: range.link } } : null;
    case 'COLORED':
      return isTextColor(range.color) ? { type: 'textColor', attrs: { color: range.color } } : null;
    case 'HIGHLIGHTED':
      return isHighlightColor(range.color) ? { type: 'highlight', attrs: { color: range.color } } : null;
    default:
      return null;
  }
}

function textToInline(text: string, marks: PMMarkJSON[], out: PMNodeJSON[]): void {
  const parts = text.split('\n');
  parts.forEach((part, i) => {
    if (i > 0) out.push({ type: 'hardBreak' });
    if (part !== '') out.push(marks.length > 0 ? { type: 'text', text: part, marks } : { type: 'text', text: part });
  });
}

function blockInline(block: Block): PMNodeJSON[] {
  const { text } = block;
  const len = text.length;
  // Valid, non-overlapping mentions sorted by position.
  const mentions = [...block.mentions]
    .filter((m) => m.start >= 0 && m.start + m.length <= len)
    .sort((a, b) => a.start - b.start)
    .filter((m, i, arr) => i === 0 || m.start >= (arr[i - 1] as MentionRef).start + (arr[i - 1] as MentionRef).length);
  const styles = block.styles
    .map((r) => ({ range: r, start: Math.max(0, r.start), end: Math.min(len, r.start + r.length) }))
    .filter((r) => r.end > r.start);
  // Variables on a placeholder character that no mention covers.
  const variables = new Map<number, VariableRef>();
  for (const v of block.variables ?? []) {
    if (v.start < 0 || v.start >= len || text[v.start] !== VARIABLE_PLACEHOLDER) continue;
    if (mentions.some((m) => v.start >= m.start && v.start < m.start + m.length)) continue;
    variables.set(v.start, v);
  }
  const cuts = new Set<number>([0, len]);
  for (const start of variables.keys()) {
    cuts.add(start);
    cuts.add(start + 1);
  }
  for (const r of styles) {
    cuts.add(r.start);
    cuts.add(r.end);
  }
  for (const m of mentions) {
    cuts.add(m.start);
    cuts.add(m.start + m.length);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const marksAt = (from: number, to: number) => {
    const marks: PMMarkJSON[] = [];
    const seen = new Set<string>();
    for (const r of styles) {
      if (r.start > from || r.end < to) continue;
      const mark = markOfStyle(r.range);
      if (!mark) continue;
      // One mark per type: the schema keeps a single link / colour / highlight on a character.
      if (seen.has(mark.type)) continue;
      seen.add(mark.type);
      marks.push(mark);
    }
    return marks;
  };
  const out: PMNodeJSON[] = [];
  let mi = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i] as number;
    const to = points[i + 1] as number;
    if (to <= from) continue;
    const mention = mentions[mi];
    if (mention && from >= mention.start && to <= mention.start + mention.length) {
      if (from === mention.start) {
        const label = text.slice(mention.start, mention.start + mention.length).replace(/^@/, '');
        out.push({
          type: 'mention',
          attrs: {
            kind: mention.type,
            id: mention.id,
            entityDefinitionId: mention.type === 'record' ? mention.entityDefinitionId : null,
            label,
          },
        });
      }
      if (to === mention.start + mention.length) mi += 1;
      continue;
    }
    const variable = variables.get(from);
    if (variable && to === from + 1) {
      out.push({
        type: 'variable',
        attrs: {
          path: JSON.stringify(variable.path),
          field: variable.field,
          fallback: variable.fallback,
          label: variable.label ?? null,
        },
      });
      continue;
    }
    textToInline(text.slice(from, to), marksAt(from, to), out);
  }
  return out;
}

/** Flat blocks → ProseMirror JSON of a document (always at least one paragraph). */
export function blocksToPmJson(blocks: readonly Block[]): PMNodeJSON {
  const content: PMNodeJSON[] = [];
  for (const block of blocks) {
    if (block.type === 'image-embed') {
      const image = block.image;
      content.push({
        type: 'image',
        attrs: {
          src: image?.src ?? null,
          assetId: image?.assetId ?? null,
          width: image?.width ?? null,
          height: image?.height ?? null,
          alignment: image?.alignment ?? 'center',
          caption: image?.caption ?? null,
        },
      });
      continue;
    }
    const inline = blockInline(block);
    const node: PMNodeJSON =
      block.type === 'h1' || block.type === 'h2' || block.type === 'h3'
        ? { type: 'heading', attrs: { level: Number(block.type.slice(1)) } }
        : block.type === 'ul' || block.type === 'ol'
          ? { type: 'listItem', attrs: { kind: block.type, indent: clampIndent(block.indent) } }
          : { type: 'paragraph' };
    if (inline.length > 0) node.content = inline;
    content.push(node);
  }
  if (content.length === 0) content.push({ type: 'paragraph' });
  return { type: 'doc', content };
}
