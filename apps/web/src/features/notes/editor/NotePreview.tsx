// Read-only render of a note / template body (E editor.md §2 "Note card preview": links not clickable, clipped by the
// caller). Stored flat `blocks` go through E1's <RichTextPreview>; bodies that only have a markdown projection (set
// through /v2 before the collab server rebuilt them) are rendered from markdown.
import type { DocumentContent } from '@agentic-crm/contracts';
import { type Block as EditorBlock, RichTextPreview } from '@agentic-crm/editor';
import { cx } from '@agentic-crm/ui';
import * as s from './editor.css';
import { type InlineSpan, type PreviewBlock, parseMarkdown } from './markdown';

function Inline({ span }: { span: InlineSpan }) {
  const cls = cx(span.bold && s.bold, span.italic && s.italic, span.strike && s.strike, span.highlight && s.highlight);
  if (span.href) return <span className={cx(s.link, cls)}>{span.text}</span>;
  return cls ? <span className={cls}>{span.text}</span> : <>{span.text}</>;
}

function MarkdownBlock({ block, compact }: { block: PreviewBlock; compact: boolean }) {
  const spans = block.spans.map((span, i) => <Inline key={i} span={span} />);
  if (block.type === 'h1' || block.type === 'h2' || block.type === 'h3') {
    return <p className={cx(s.block, compact ? s.headingCompact : s.heading[block.type])}>{spans}</p>;
  }
  if (block.type === 'ul' || block.type === 'ol') {
    const marker =
      block.type === 'ul'
        ? block.indent % 3 === 0
          ? '•'
          : block.indent % 3 === 1
            ? '◦'
            : '▪'
        : `${block.number ?? 1}.`;
    return (
      <div className={cx(s.block, s.listItem)} style={{ paddingLeft: 12 + block.indent * 24 }}>
        <span className={s.marker} aria-hidden="true">
          {marker}
        </span>
        <span>{spans}</span>
      </div>
    );
  }
  return <p className={s.block}>{spans}</p>;
}

export interface NotePreviewProps {
  content: DocumentContent | null | undefined;
  /** Card / row previews: 13 px, headings at body size. */
  compact?: boolean;
  maxBlocks?: number;
  /** Shown when the body is empty ("This note has no content."). */
  emptyText?: string;
  /** Class of the empty-state text. */
  emptyClassName?: string;
  className?: string;
}

export function NotePreview({
  content,
  compact = false,
  maxBlocks = 12,
  emptyText,
  emptyClassName,
  className,
}: NotePreviewProps) {
  const stored = (content?.blocks ?? null) as EditorBlock[] | null;
  if (stored && stored.length > 0) {
    return (
      <RichTextPreview blocks={stored} maxBlocks={maxBlocks} className={cx(compact && s.richCompact, className)} />
    );
  }
  const blocks = parseMarkdown(content?.markdown ?? content?.plaintext ?? '').slice(0, maxBlocks);
  if (blocks.length === 0) {
    return emptyText ? (
      <div className={cx(s.preview, compact && s.previewCompact, s.empty, emptyClassName, className)}>{emptyText}</div>
    ) : null;
  }
  return (
    <div className={cx(s.preview, compact && s.previewCompact, className)} data-testid="note-preview">
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} block={block} compact={compact} />
      ))}
    </div>
  );
}
