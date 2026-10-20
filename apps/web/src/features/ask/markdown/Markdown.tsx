import { Fragment, type ReactNode, useMemo } from 'react';
import { openWindow } from '../../overlays/store';
import { Embed } from '../embeds/Embed';
import * as s from './markdown.css';
import { type Align, type Block, type Inline, parseBlocks } from './parse';
import { RecordPill } from './RecordPill';

function InlineNodes({ nodes }: { nodes: Inline[] }): ReactNode {
  return nodes.map((n, i) => {
    const key = `${n.t}:${i}`;
    switch (n.t) {
      case 'text':
        return <Fragment key={key}>{n.text}</Fragment>;
      case 'bold':
        return (
          <strong key={key} className={s.bold}>
            <InlineNodes nodes={n.children} />
          </strong>
        );
      case 'italic':
        return (
          <em key={key}>
            <InlineNodes nodes={n.children} />
          </em>
        );
      case 'strike':
        return (
          <del key={key}>
            <InlineNodes nodes={n.children} />
          </del>
        );
      case 'code':
        return (
          <code key={key} className={s.inlineCode}>
            {n.text}
          </code>
        );
      case 'link':
        return (
          <a key={key} className={s.link} href={n.href} target="_blank" rel="noreferrer noopener">
            <InlineNodes nodes={n.children} />
          </a>
        );
      case 'record':
        return (
          <RecordPill
            key={key}
            entityDefinitionId={n.entityDefinitionId}
            entityInstanceId={n.entityInstanceId}
            label={n.label}
          />
        );
      case 'meeting':
        return (
          <button
            key={key}
            type="button"
            className={s.link}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
            onClick={() => openWindow('meeting', n.meetingId, {})}
          >
            {n.label || 'Meeting'}
          </button>
        );
    }
  });
}

const alignStyle = (a: Align) => (a ? { textAlign: a } : undefined);

function BlockNodes({ blocks, streaming }: { blocks: Block[]; streaming: boolean }): ReactNode {
  return blocks.map((b, i) => {
    const key = `${b.t}:${i}`;
    switch (b.t) {
      case 'p':
        return (
          <p key={key} className={s.paragraph}>
            <InlineNodes nodes={b.children} />
          </p>
        );
      case 'ul':
        return (
          <ul key={key} className={s.list}>
            {b.items.map((item, n) => (
              <li key={n} className={s.listItem}>
                <BlockNodes blocks={item} streaming={streaming} />
              </li>
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={key} className={s.list} start={b.start}>
            {b.items.map((item, n) => (
              <li key={n} className={s.listItem}>
                <BlockNodes blocks={item} streaming={streaming} />
              </li>
            ))}
          </ol>
        );
      case 'quote':
        return (
          <blockquote key={key} className={s.quote}>
            <BlockNodes blocks={b.children} streaming={streaming} />
          </blockquote>
        );
      case 'table':
        return (
          <div key={key} className={s.tableWrap}>
            <table className={s.table} data-testid="ask-table">
              <thead>
                <tr>
                  {b.head.map((cell, n) => (
                    <th key={n} style={alignStyle(b.align[n] ?? null)}>
                      <InlineNodes nodes={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, n) => (
                      <td key={n} style={alignStyle(b.align[n] ?? null)}>
                        <InlineNodes nodes={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'code':
        return (
          <pre key={key} className={s.codeBlock}>
            <code>{b.text}</code>
          </pre>
        );
      case 'component':
        return <Embed key={`${b.key}`} id={b.id} data={b.data} partial={b.partial} />;
    }
  });
}

/** Markdown of an assistant answer with record chips and generative embeds; `streaming` tolerates unfinished syntax. */
export function Markdown({
  source,
  streaming = false,
  muted = false,
}: {
  source: string;
  streaming?: boolean;
  muted?: boolean;
}) {
  const blocks = useMemo(() => parseBlocks(source, { streaming }), [source, streaming]);
  return (
    <div className={`${s.root} ${muted ? s.muted : ''}`} data-testid="ask-markdown">
      <BlockNodes blocks={blocks} streaming={streaming} />
    </div>
  );
}
