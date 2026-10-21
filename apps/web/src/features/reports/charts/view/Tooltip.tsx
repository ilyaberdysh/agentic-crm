// The chart tooltip is portalled to <body> so it can overflow the chart box, and follows the
// pointer. Contents come from model/tooltip.ts.
import { cx, useThemeClassName } from '@agentic-crm/ui';
import { Fragment, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TipBlock, TipRow, TooltipContent } from '../model/tooltip';
import * as s from './chart.css';
import { colorVar } from './colors';

export interface TooltipAnchor {
  /** Pointer position in the viewport. */
  x: number;
  y: number;
}

const OFFSET = 12;
const MARGIN = 8;

function Arrow({ tone }: { tone: 'down' | 'up' | 'flat' }) {
  if (tone === 'flat') return null;
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d={tone === 'down' ? 'M2.5 2.5 7.5 7.5M7.5 3.5v4h-4' : 'M2.5 7.5 7.5 2.5M3.5 2.5h4v4'}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Row({ row }: { row: TipRow }): ReactNode {
  switch (row.kind) {
    case 'title':
      return <div className={s.tooltipTitle}>{row.text}</div>;
    case 'row':
      return (
        <div className={s.tooltipRow} data-testid="chart-tooltip-row">
          <span className={s.tooltipLabel}>{row.label}</span>
          <span className={s.tooltipValue}>{row.value}</span>
        </div>
      );
    case 'divider':
      return <div className={s.tooltipDivider} />;
    case 'note':
      return <div className={s.tooltipNote}>{row.text}</div>;
  }
}

function Block({ block }: { block: TipBlock }) {
  return (
    <div className={s.tooltipBlock}>
      <div className={s.tooltipRule} style={{ backgroundColor: colorVar(block.color) }} />
      <div className={s.tooltipBody}>
        {block.rows.map((row, i) => (
          <Row key={`${row.kind}-${i}`} row={row} />
        ))}
      </div>
    </div>
  );
}

export function ChartTooltip({ content, anchor }: { content: TooltipContent; anchor: TooltipAnchor }) {
  const themeClass = useThemeClassName();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x + OFFSET, top: anchor.y + OFFSET });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.x + OFFSET;
    let top = anchor.y + OFFSET;
    if (left + w > vw - MARGIN) left = anchor.x - OFFSET - w;
    if (top + h > vh - MARGIN) top = anchor.y - OFFSET - h;
    setPos({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) });
  }, [anchor.x, anchor.y, content]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      className={cx(themeClass, 'visx-tooltip', s.tooltip)}
      style={{ transform: `translate(${pos.left}px, ${pos.top}px)` }}
      role="tooltip"
      data-testid="chart-tooltip"
    >
      {content.header && (
        <div className={s.tooltipHeader}>
          <span>{content.header.text}</span>
          {content.header.badge && (
            <span className={s.badge[content.header.badge.tone]} data-testid="chart-tooltip-badge">
              <Arrow tone={content.header.badge.tone} />
              {content.header.badge.text}
            </span>
          )}
        </div>
      )}
      {content.blocks.map((block, i) => (
        <Fragment key={i}>
          {i > 0 && <div className={s.tooltipBlockDivider} />}
          <Block block={block} />
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
