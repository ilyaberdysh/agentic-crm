// <RichTextPreview blocks> — read-only render of the flat `blocks` projection (note cards, record tabs, favourites,
// template previews). Same typography and classes as the editor; links are not clickable (as in Attio's previews).
import { Fragment, type ReactNode } from 'react';
import type { Block } from '../model/blocks.ts';
import { listNumbers } from '../model/numbering.ts';
import { blocksToPmJson, type PMMarkJSON, type PMNodeJSON } from '../model/pm.ts';
import { content } from './content.css.ts';

export interface RichTextPreviewProps {
  blocks: readonly Block[];
  /** Render at most this many blocks (card previews clip anyway). */
  maxBlocks?: number;
  /** Render links as real anchors (default false: previews are not interactive). */
  linksClickable?: boolean;
  className?: string;
}

function wrapMark(mark: PMMarkJSON, child: ReactNode, key: number, linksClickable: boolean): ReactNode {
  switch (mark.type) {
    case 'bold':
      return (
        <strong key={key} className="agentic-crm-note-bold">
          {child}
        </strong>
      );
    case 'italic':
      return (
        <em key={key} className="agentic-crm-note-italic">
          {child}
        </em>
      );
    case 'strike':
      return (
        <s key={key} className="agentic-crm-note-strikethrough">
          {child}
        </s>
      );
    case 'link': {
      const href = String(mark.attrs?.href ?? '');
      return linksClickable ? (
        <a key={key} className="agentic-crm-note-link" href={href} target="_blank" rel="noreferrer noopener">
          {child}
        </a>
      ) : (
        <span key={key} className="agentic-crm-note-link">
          {child}
        </span>
      );
    }
    case 'textColor':
      return (
        <span key={key} className="agentic-crm-note-text-color" data-text-color={String(mark.attrs?.color ?? '')}>
          {child}
        </span>
      );
    case 'highlight':
      return (
        <span key={key} className="agentic-crm-note-highlight" data-highlight={String(mark.attrs?.color ?? '')}>
          {child}
        </span>
      );
    default:
      return <Fragment key={key}>{child}</Fragment>;
  }
}

function inline(nodes: PMNodeJSON[] | undefined, linksClickable: boolean): ReactNode[] {
  return (nodes ?? []).map((node, i) => {
    if (node.type === 'hardBreak') return <br key={i} />;
    if (node.type === 'mention') {
      const attrs = node.attrs ?? {};
      return (
        <span
          key={i}
          className={`agentic-crm-note-mention ${attrs.kind === 'record' ? 'agentic-crm-entity-reference-node' : 'agentic-crm-actor-reference-node'}`}
          data-mention-kind={String(attrs.kind ?? 'member')}
          data-id={String(attrs.id ?? '')}
        >
          @{String(attrs.label ?? '')}
        </span>
      );
    }
    let out: ReactNode = node.text ?? '';
    const marks = node.marks ?? [];
    for (let m = marks.length - 1; m >= 0; m--) out = wrapMark(marks[m] as PMMarkJSON, out, m, linksClickable);
    return <Fragment key={i}>{out}</Fragment>;
  });
}

export function RichTextPreview({ blocks, maxBlocks, linksClickable = false, className }: RichTextPreviewProps) {
  const shown = maxBlocks !== undefined ? blocks.slice(0, maxBlocks) : blocks;
  const doc = blocksToPmJson(shown);
  const numbers = listNumbers(shown);
  return (
    <div className={`${content} ${className ?? ''}`} data-testid="rich-text-preview">
      {shown.length === 0
        ? null
        : (doc.content ?? []).map((node, i) => {
            const children = inline(node.content, linksClickable);
            switch (node.type) {
              case 'heading': {
                const level = Number(node.attrs?.level ?? 1);
                const Tag = (level === 2 ? 'h2' : level === 3 ? 'h3' : 'h1') as 'h1';
                return (
                  <Tag key={i} className={`agentic-crm-note-heading-h${level}`}>
                    {children}
                  </Tag>
                );
              }
              case 'listItem':
                return (
                  <div
                    key={i}
                    className="agentic-crm-note-list-item"
                    data-list={String(node.attrs?.kind ?? 'ul')}
                    data-indent={String(node.attrs?.indent ?? 0)}
                    data-number={numbers[i] ?? undefined}
                  >
                    <div className="agentic-crm-note-list-item-content">{children}</div>
                  </div>
                );
              case 'image': {
                const attrs = node.attrs ?? {};
                if (!attrs.src) return null;
                return (
                  <img
                    key={i}
                    className="agentic-crm-note-image"
                    src={String(attrs.src)}
                    alt={String(attrs.caption ?? '')}
                    data-align={String(attrs.alignment ?? 'center')}
                    width={typeof attrs.width === 'number' ? attrs.width : undefined}
                    loading="lazy"
                  />
                );
              }
              default:
                return (
                  <p key={i} className="agentic-crm-note-paragraph">
                    {children}
                  </p>
                );
            }
          })}
    </div>
  );
}
