// Pie: a full pie from 12 o'clock, clockwise, biggest slice first, thin gaps (a 2 px surface stroke), legend above.

import { vars } from '@agentic-crm/ui/styles';
import { Pie } from '@visx/shape';
import { type MouseEvent, useMemo, useState } from 'react';
import { groupHighlightKey, matchesHighlight } from '../model/keys';
import { OTHER_KEY, type PieModel, type PieSlice } from '../model/pie';
import { pieTooltip } from '../model/tooltip';
import type { ChartContext, DrillTarget } from '../types';
import * as s from './chart.css';
import { colorVar } from './colors';
import { type HighlightState, isDimmed } from './hooks';
import { Legend, type LegendEntry } from './Legend';
import type { ChartSize } from './layout';
import { ChartTooltip, type TooltipAnchor } from './Tooltip';

export interface PieChartProps {
  ctx: ChartContext;
  model: PieModel;
  size: ChartSize;
  width: number;
  height: number;
  highlight: HighlightState;
  onDrill?: (target: DrillTarget) => void;
}

export function PieChart({ ctx, model, size, width, height, highlight, onDrill }: PieChartProps) {
  const [hover, setHover] = useState<{ slice: PieSlice; anchor: TooltipAnchor } | null>(null);
  const canvas = size === 'canvas';
  const compact = height < 300;
  const top = compact ? 56 : canvas ? 110 : 84;
  const bottom = compact ? 12 : canvas ? 64 : 32;
  const radius = Math.max(24, Math.min(width / 2 - 16, (height - top - bottom) / 2));
  const cx = width / 2;
  const cy = top + radius;

  const entries: LegendEntry[] = useMemo(
    () =>
      model.slices.map((sl) => ({
        highlightKey: groupHighlightKey(sl.key),
        label: sl.label,
        color: colorVar(sl.color),
        shape: 'square',
      })),
    [model.slices],
  );

  const move = (e: MouseEvent, slice: PieSlice) => setHover({ slice, anchor: { x: e.clientX, y: e.clientY } });
  const leave = () => {
    setHover(null);
    highlight.hover(null);
  };

  return (
    <>
      <svg className={s.svgLayer} width={width} height={height} role="img" aria-label="Pie chart">
        <g transform={`translate(${cx},${cy})`} className="visx-group">
          <Pie<PieSlice>
            data={model.slices}
            pieValue={(d) => d.value}
            pieSort={null}
            pieSortValues={null}
            outerRadius={radius}
            innerRadius={0}
          >
            {(pie) =>
              pie.arcs.map((arc) => {
                const slice = arc.data;
                const dim = isDimmed(highlight, matchesHighlight(highlight.parsed, slice.key));
                const drillable = Boolean(onDrill) && slice.key !== OTHER_KEY;
                return (
                  <path
                    key={slice.key ?? '∅'}
                    d={pie.path(arc) ?? undefined}
                    className={`${s.mark} ${dim ? s.dimmed : ''} ${drillable ? s.clickable : ''}`}
                    fill={colorVar(slice.color)}
                    strokeWidth={model.slices.length > 1 ? 2.5 : 0}
                    stroke={vars.color.surface.primary}
                    data-testid="chart-slice"
                    data-group={slice.key ?? ''}
                    data-label={slice.label}
                    data-value={slice.value}
                    onMouseEnter={(e) => {
                      move(e, slice);
                      highlight.hover(groupHighlightKey(slice.key));
                    }}
                    onMouseMove={(e) => move(e, slice)}
                    onMouseLeave={leave}
                    onClick={() => drillable && onDrill?.({ group: slice.key, segment: null })}
                  />
                );
              })
            }
          </Pie>
        </g>
      </svg>
      <Legend
        entries={entries}
        maxWidth={Math.max(120, width - 48)}
        top={compact ? 14 : 33}
        width={width}
        onFocus={highlight.focus}
      />
      {hover && <ChartTooltip content={pieTooltip(ctx, model, hover.slice)} anchor={hover.anchor} />}
    </>
  );
}
