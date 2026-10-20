// Bar and line charts (Insight, Historical values, Stage changed, Time in stage): visx scales and shapes, HTML axis
// labels, legend, target line, comparison series, tooltips and cross-highlighting.

import { cx } from '@agentic-crm/ui';
import { vars } from '@agentic-crm/ui/styles';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { scaleBand } from '@visx/scale';
import { BarRounded, LinePath } from '@visx/shape';
import { type MouseEvent, type ReactNode, useMemo, useState } from 'react';
import type { CartesianModel, Cell } from '../model/cartesian';
import {
  cellHighlightKey,
  groupHighlightKey,
  matchesHighlight,
  matchesSeries,
  seriesHighlightKey,
} from '../model/keys';
import { cartesianTooltip } from '../model/tooltip';
import type { ChartContext, DrillTarget } from '../types';
import * as s from './chart.css';
import { COMPARISON_COLOR, colorVar, TARGET_COLOR } from './colors';
import { type HighlightState, isDimmed, measureText, truncateToWidth } from './hooks';
import { Legend, type LegendEntry } from './Legend';
import { type ChartSize, computeCartesianLayout } from './layout';
import { TitleText } from './TitleText';
import { ChartTooltip, type TooltipAnchor } from './Tooltip';

const RADIUS = 8;

export interface CartesianChartProps {
  ctx: ChartContext;
  model: CartesianModel;
  size: ChartSize;
  width: number;
  height: number;
  highlight: HighlightState;
  onDrill?: (target: DrillTarget) => void;
}

interface Hover {
  ci: number;
  si: number | null;
  anchor: TooltipAnchor;
}

/** A path with its top corners rounded (or bottom, for negative bars). */
function Bar({
  x,
  y,
  width,
  height,
  top,
  className,
  stroke,
  ...rest
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  top: 'top' | 'bottom' | null;
  className?: string;
  stroke?: boolean;
} & Record<string, unknown>) {
  const radius = Math.max(0, Math.min(RADIUS, width / 2, height));
  return (
    <BarRounded
      x={x}
      y={y}
      width={Math.max(0, width)}
      height={Math.max(0, height)}
      radius={radius}
      top={top === 'top'}
      bottom={top === 'bottom'}
      className={cx(s.mark, stroke && s.surfaceStroke, className)}
      strokeWidth={stroke ? 2 : undefined}
      {...rest}
    />
  );
}

export function CartesianChart({ ctx, model, size, width, height, highlight, onDrill }: CartesianChartProps) {
  const [hover, setHover] = useState<Hover | null>(null);
  const comparison = model.comparison;
  const showLegend = model.legend.length > 1 || Boolean(comparison);
  const layout = useMemo(
    () =>
      computeCartesianLayout({
        model,
        width,
        height,
        size,
        hasLegend: showLegend,
        measure: (t) => measureText(t),
        truncate: truncateToWidth,
        ctxFormat: ctx.metric.format,
      }),
    [model, width, height, size, showLegend, ctx.metric.format],
  );
  const { plot, y } = layout;
  const interactive = Boolean(onDrill);
  const n = model.categories.length;
  const line = model.kind === 'line';
  const baselineY = y(0);

  // Bar slots inside a band: [comparison] + (stacked ? 1 : series).
  const slots = (comparison ? 1 : 0) + (model.stacked || !model.segmented ? 1 : model.series.length);
  const inner = useMemo(
    () =>
      scaleBand<number>({
        domain: Array.from({ length: slots }, (_, i) => i),
        range: [0, layout.bandWidth],
        paddingInner: slots > 1 ? 0.12 : 0,
      }),
    [slots, layout.bandWidth],
  );
  const slotWidth = inner.bandwidth();
  const slotX = (ci: number, slot: number) => layout.bandX(ci) + (inner(slot) ?? 0);

  function pointer(e: MouseEvent, ci: number, si: number | null) {
    setHover({ ci, si, anchor: { x: e.clientX, y: e.clientY } });
  }
  const leave = () => {
    setHover(null);
    highlight.hover(null);
  };
  function enter(e: MouseEvent, ci: number, si: number | null) {
    pointer(e, ci, si);
    const cat = model.categories[ci];
    if (!cat) return;
    highlight.hover(
      model.segmented && si !== null
        ? cellHighlightKey(cat.key, model.series[si]?.key ?? null)
        : groupHighlightKey(cat.key),
    );
  }
  const drill = (ci: number, si: number | null) => {
    const cat = model.categories[ci];
    if (!onDrill || !cat) return;
    onDrill({ group: cat.key, segment: model.segmented && si !== null ? (model.series[si]?.key ?? null) : null });
  };

  // ---- bars ------------------------------------------------------------------------------------------------------------
  const bars: ReactNode[] = [];
  const compSlot = 0;
  const mainSlot = comparison ? 1 : 0;
  if (!line) {
    model.categories.forEach((cat, ci) => {
      const cells = model.cells[ci] ?? [];
      const children: ReactNode[] = [];
      if (comparison) {
        const prev = comparison.values[ci];
        if (prev !== null && prev !== undefined && prev !== 0) {
          const top = y(Math.max(prev, 0));
          const bottom = y(Math.min(prev, 0));
          children.push(
            <Bar
              key="cmp"
              x={slotX(ci, compSlot)}
              y={top}
              width={slotWidth}
              height={bottom - top}
              top={prev >= 0 ? 'top' : 'bottom'}
              className={s.comparisonBar}
              data-testid="chart-comparison-bar"
              data-group={cat.key ?? ''}
              onMouseEnter={(e: MouseEvent) => pointer(e, ci, null)}
              onMouseMove={(e: MouseEvent) => pointer(e, ci, null)}
              onMouseLeave={leave}
            />,
          );
        }
      }
      if (model.stacked) {
        let pos = 0;
        let neg = 0;
        // The evidence draws no visible line between stacked segments of different colours; neighbours of the same
        // colour get the 1 px surface separator so they stay distinguishable.
        let prevPos: string | null = null;
        let prevNeg: string | null = null;
        const segments = cells
          .map((cell, si) => ({ cell, si }))
          .filter(
            (x): x is { cell: Cell & { value: number }; si: number } => x.cell.value !== null && x.cell.value !== 0,
          );
        const lastPos = segments.filter((x) => x.cell.value > 0).at(-1)?.si;
        const lastNeg = segments.filter((x) => x.cell.value < 0).at(-1)?.si;
        for (const { cell, si } of segments) {
          const v = cell.value;
          const from = v > 0 ? pos : neg;
          const to = from + v;
          if (v > 0) pos = to;
          else neg = to;
          const yTop = y(Math.max(from, to));
          const yBottom = y(Math.min(from, to));
          const series = model.series[si];
          const colour = series?.color ?? 'blue';
          const sameAsBelow = (v > 0 ? prevPos : prevNeg) === colour;
          if (v > 0) prevPos = colour;
          else prevNeg = colour;
          const dim = isDimmed(highlight, matchesHighlight(highlight.parsed, cat.key, series?.key ?? null));
          children.push(
            <Bar
              key={`s${si}`}
              x={slotX(ci, mainSlot)}
              y={yTop}
              width={slotWidth}
              height={Math.max(1, yBottom - yTop)}
              top={si === lastPos ? 'top' : si === lastNeg ? 'bottom' : null}
              stroke={sameAsBelow}
              className={cx(dim && s.dimmed, interactive && s.clickable)}
              fill={colorVar(series?.color ?? 'blue')}
              data-testid="chart-bar-segment"
              data-group={cat.key ?? ''}
              data-segment={series?.key ?? ''}
              data-value={v}
              onMouseEnter={(e: MouseEvent) => enter(e, ci, si)}
              onMouseMove={(e: MouseEvent) => pointer(e, ci, si)}
              onMouseLeave={leave}
              onClick={() => drill(ci, si)}
            />,
          );
        }
      } else {
        const count = model.segmented ? model.series.length : 1;
        for (let si = 0; si < count; si++) {
          const cell = cells[si];
          const v = cell?.value;
          if (v === null || v === undefined || v === 0) continue;
          const series = model.series[si];
          const slot = mainSlot + (model.segmented ? si : 0);
          const yTop = y(Math.max(v, 0));
          const yBottom = y(Math.min(v, 0));
          const dim = isDimmed(highlight, matchesHighlight(highlight.parsed, cat.key, series?.key ?? null));
          children.push(
            <Bar
              key={`s${si}`}
              x={slotX(ci, slot)}
              y={yTop}
              width={slotWidth}
              height={Math.max(1, yBottom - yTop)}
              top={v > 0 ? 'top' : 'bottom'}
              className={cx(dim && s.dimmed, interactive && s.clickable)}
              fill={colorVar(model.colorByCategory ? cat.color : (series?.color ?? 'blue'))}
              data-testid="chart-bar-segment"
              data-group={cat.key ?? ''}
              data-segment={model.segmented ? (series?.key ?? '') : undefined}
              data-value={v}
              onMouseEnter={(e: MouseEvent) => enter(e, ci, model.segmented ? si : null)}
              onMouseMove={(e: MouseEvent) => pointer(e, ci, model.segmented ? si : null)}
              onMouseLeave={leave}
              onClick={() => drill(ci, model.segmented ? si : null)}
            />,
          );
        }
      }
      bars.push(
        <g
          key={`${cat.key ?? '∅'}-${ci}`}
          className="visx-group"
          data-testid="chart-bar"
          data-group={cat.key ?? ''}
          data-label={cat.label}
        >
          {children}
        </g>,
      );
    });
  }

  // ---- lines ---------------------------------------------------------------------------------------------------------------
  const lines: ReactNode[] = [];
  if (line) {
    const cx0 = (ci: number) => layout.bandX(ci) + layout.bandWidth / 2;
    const seriesCount = model.series.length;
    model.series.forEach((series, si) => {
      const pts = model.categories
        .map((cat, ci) => ({ cat, ci, v: model.cells[ci]?.[si]?.value ?? null }))
        .filter((p): p is { cat: (typeof p)['cat']; ci: number; v: number } => p.v !== null);
      const colour = colorVar(model.segmented ? series.color : 'blue');
      const external = highlight.key !== null && highlight.key !== highlight.hoverKey;
      const dim = external && highlight.parsed?.segment !== undefined && !matchesSeries(highlight.parsed, series.key);
      // Segmented lines are drawn at half strength (evidence H/editor-insight-line-segmented-target.png: #D9DADE reads
      // #ECECEE); the series under the pointer or highlighted from outside is drawn in full.
      const focused = hover?.si === si || (external && matchesSeries(highlight.parsed, series.key));
      lines.push(
        <g
          key={`l${si}`}
          className={cx('visx-group', s.mark, dim && s.dimmed)}
          data-testid="chart-line"
          data-segment={series.key ?? ''}
        >
          <LinePath<(typeof pts)[number]>
            data={pts}
            x={(p) => cx0(p.ci)}
            y={(p) => y(p.v)}
            className={s.linePath}
            stroke={colour}
            strokeOpacity={model.segmented && !focused ? 0.5 : 1}
          />
          {pts.map((p) => {
            const active =
              (hover?.ci === p.ci && (hover.si === si || (hover.si === null && seriesCount === 1))) ||
              (external && matchesHighlight(highlight.parsed, p.cat.key, series.key));
            return (
              <g
                key={p.ci}
                data-testid="chart-point"
                data-group={p.cat.key ?? ''}
                data-segment={model.segmented ? (series.key ?? '') : undefined}
              >
                <circle
                  className={s.pointRing}
                  cx={cx0(p.ci)}
                  cy={y(p.v)}
                  r={active ? 4 : 3}
                  fill={colour}
                  strokeWidth={2}
                />
              </g>
            );
          })}
        </g>,
      );
    });
    if (comparison) {
      const pts = model.categories
        .map((_, ci) => ({ ci, v: comparison.values[ci] ?? null }))
        .filter((p): p is { ci: number; v: number } => p.v !== null);
      lines.unshift(
        <g key="cmp" className="visx-group" data-testid="chart-comparison-line">
          <LinePath<(typeof pts)[number]>
            data={pts}
            x={(p) => cx0(p.ci)}
            y={(p) => y(p.v)}
            className={s.linePath}
            stroke={COMPARISON_COLOR}
            strokeDasharray="4 3"
            strokeOpacity={0.7}
          />
          {pts.map((p) => (
            <circle key={p.ci} cx={cx0(p.ci)} cy={y(p.v)} r={3} fill={COMPARISON_COLOR} fillOpacity={0.7} />
          ))}
        </g>,
      );
    }
  }

  // Line hover: the nearest band, then the nearest series point in it.
  function lineMove(e: MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const ci = Math.max(0, Math.min(n - 1, Math.floor(px / layout.step)));
    let best: number | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    model.series.forEach((_, si) => {
      const v = model.cells[ci]?.[si]?.value;
      if (v === null || v === undefined) return;
      const d = Math.abs(y(v) - py);
      if (d < bestD) {
        bestD = d;
        best = si;
      }
    });
    if (best === null) {
      leave();
      return;
    }
    const cat = model.categories[ci];
    if (!hover || hover.ci !== ci || hover.si !== best) {
      highlight.hover(
        model.segmented
          ? cellHighlightKey(cat?.key ?? null, model.series[best]?.key ?? null)
          : groupHighlightKey(cat?.key ?? null),
      );
    }
    setHover({ ci, si: model.segmented ? best : null, anchor: { x: e.clientX, y: e.clientY } });
  }

  // ---- legend ------------------------------------------------------------------------------------------------------------------
  const entries: LegendEntry[] = [];
  if (comparison) {
    entries.push({ highlightKey: null, label: comparison.previousRange, color: COMPARISON_COLOR, shape: 'comparison' });
  }
  if (model.legend.length > 1) {
    for (const sr of model.legend) {
      entries.push({
        highlightKey: seriesHighlightKey(sr.key),
        label: sr.label,
        color: colorVar(sr.color),
        shape: line ? 'dash' : 'square',
      });
    }
  } else if (comparison) {
    entries.push({
      highlightKey: null,
      label: comparison.currentRange,
      color: colorVar('blue'),
      shape: line ? 'dash' : 'square',
    });
  }

  // ---- tooltip -------------------------------------------------------------------------------------------------------------
  const tooltip = hover ? cartesianTooltip(ctx, model, hover.ci, hover.si) : null;

  return (
    <>
      <svg
        className={s.svgLayer}
        width={width}
        height={height}
        role="img"
        aria-label={`${model.kind === 'line' ? 'Line' : 'Bar'} chart`}
      >
        <Group left={plot.x} top={plot.y} className="visx-group">
          <GridRows
            scale={y}
            width={plot.w}
            tickValues={layout.yTicks.filter((t) => t.value !== 0).map((t) => t.value)}
            className={s.gridLine}
            stroke={vars.color.stroke.secondary}
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          <rect className={s.baseline} x={0} y={baselineY - 1} width={plot.w} height={2} />
          {bars}
          {lines}
          {model.target !== null && (
            <line
              className={s.targetLine}
              data-testid="chart-target-line"
              stroke={TARGET_COLOR}
              x1={1}
              x2={plot.w - 1}
              y1={y(model.target)}
              y2={y(model.target)}
            />
          )}
          {line && (
            <rect
              x={0}
              y={0}
              width={plot.w}
              height={plot.h}
              fill="transparent"
              className={interactive ? s.clickable : undefined}
              onMouseMove={lineMove}
              onMouseLeave={leave}
              onClick={() => hover && drill(hover.ci, hover.si)}
            />
          )}
        </Group>
      </svg>
      {showLegend && entries.length > 0 && (
        <Legend entries={entries} maxWidth={plot.w} top={layout.legendTop} width={width} onFocus={highlight.focus} />
      )}
      <div className="visx-axis visx-axis-left" aria-hidden="true">
        {layout.yTicks.map((t) =>
          t.label === '' ? null : (
            <div key={t.value} className={s.yTick} style={{ left: 0, width: plot.x - 8, top: plot.y + t.y }}>
              {t.label}
            </div>
          ),
        )}
      </div>
      <div className="visx-axis visx-axis-bottom" aria-hidden="true">
        {layout.xLabels.map((l) =>
          layout.rotated ? (
            <div key={l.index} className={s.xTickRotated} style={{ left: plot.x + l.x, top: plot.y + plot.h + 17 }}>
              {l.text}
            </div>
          ) : (
            <div
              key={l.index}
              className={s.xTick}
              style={{
                left: plot.x + l.x - layout.xLabelWidth / 2,
                width: layout.xLabelWidth,
                top: plot.y + plot.h + 17,
              }}
            >
              {l.text}
            </div>
          ),
        )}
      </div>
      {layout.titles && (
        <>
          <div
            className={s.yAxisTitle}
            data-testid="chart-y-title"
            style={{ left: layout.titles.yX, top: plot.y + plot.h / 2, maxWidth: plot.h }}
          >
            <TitleText text={model.yTitle} />
          </div>
          {model.xTitle && (
            <div
              className={s.xAxisTitle}
              data-testid="chart-x-title"
              style={{ left: plot.x + plot.w / 2, top: layout.titles.xTop, maxWidth: plot.w }}
            >
              <TitleText text={model.xTitle} />
            </div>
          )}
        </>
      )}
      {hover && tooltip && <ChartTooltip content={tooltip} anchor={hover.anchor} />}
    </>
  );
}
