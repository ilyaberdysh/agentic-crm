// Funnel (one continuous blue area joined by S-curves, a stage card with the conversion above every column) and
// Funnel Steps (a bar per stage with the faded ghost of the previous stage and a floating badge).

import { vars } from '@agentic-crm/ui/styles';
import { curveMonotoneX } from '@visx/curve';
import { LinearGradient } from '@visx/gradient';
import { Area, BarRounded } from '@visx/shape';
import { type MouseEvent, useId, useState } from 'react';
import { formatPercentValue } from '../model/format';
import type { FunnelModel, FunnelStage } from '../model/funnel';
import { formatStageValue } from '../model/funnel';
import { groupHighlightKey, matchesHighlight } from '../model/keys';
import { funnelTooltip } from '../model/tooltip';
import * as s from './chart.css';
import { colorVar } from './colors';
import { type HighlightState, isDimmed } from './hooks';
import type { ChartSize } from './layout';
import { ChartTooltip, type TooltipAnchor } from './Tooltip';

export interface FunnelChartProps {
  model: FunnelModel;
  size: ChartSize;
  width: number;
  height: number;
  highlight: HighlightState;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const BLUE = colorVar('blue');

interface Hover {
  stage: FunnelStage;
  anchor: TooltipAnchor;
}

function useFunnelHover(highlight: HighlightState) {
  const [hover, setHover] = useState<Hover | null>(null);
  return {
    hover,
    props: (stage: FunnelStage) => ({
      onMouseEnter: (e: MouseEvent) => {
        setHover({ stage, anchor: { x: e.clientX, y: e.clientY } });
        highlight.hover(groupHighlightKey(stage.key));
      },
      onMouseMove: (e: MouseEvent) => setHover({ stage, anchor: { x: e.clientX, y: e.clientY } }),
      onMouseLeave: () => {
        setHover(null);
        highlight.hover(null);
      },
    }),
  };
}

export function FunnelAreaChart({ model, size, width, height, highlight }: FunnelChartProps) {
  const id = useId();
  const canvas = size === 'canvas';
  const { hover, props } = useFunnelHover(highlight);
  const n = model.stages.length;
  const padX = canvas ? clamp(width * 0.108, 16, 90) : clamp(width * 0.04, 16, 44);
  const cardTop = 28;
  const areaTop = height < 320 ? 96 : 121;
  const areaH = Math.max(40, height - areaTop - (height < 320 ? 24 : 38));
  const colW = (width - padX * 2) / n;
  const cy = areaTop + areaH / 2;
  const hOf = (i: number) => areaH * (model.stages[i]?.height ?? 0);

  const columns = model.stages.map((stage, i) => {
    const x0 = padX + i * colW;
    const hl = i === 0 ? hOf(0) : hOf(i - 1);
    return { stage, x0, x1: x0 + colW, hl };
  });
  // One continuous area: a monotone curve through the stage values at the column boundaries (the first column is
  // flat at its own value), so the edge stays smooth across the 5 px cuts (evidence H/editor-funnel.png).
  const points = [{ x: padX, h: hOf(0) }, ...model.stages.map((_, i) => ({ x: padX + (i + 1) * colW, h: hOf(i) }))];
  const dimOthers = highlight.key !== null && highlight.key !== highlight.hoverKey;

  return (
    <div data-testid="chart-funnel" data-chart-kind="funnel">
      <svg className={s.svgLayer} width={width} height={height} role="img" aria-label="Funnel chart">
        <defs>
          <LinearGradient id={`${id}-area`} from={BLUE} to={BLUE} vertical />
        </defs>
        <g className="visx-group">
          <Area<{ x: number; h: number }>
            data={points}
            x={(p) => p.x}
            y0={(p) => cy + p.h / 2}
            y1={(p) => cy - p.h / 2}
            curve={curveMonotoneX}
            fill={`url(#${id}-area)`}
            className={s.mark}
            data-testid="chart-funnel-area"
          />
          {/* A 5 px surface gap where the area is cut between two stages… */}
          {columns.slice(1).map(({ stage, x0, hl }) => (
            <line
              key={`g${stage.key ?? '∅'}`}
              x1={x0}
              x2={x0}
              y1={cy - hl / 2}
              y2={cy + hl / 2}
              stroke={vars.color.surface.primary}
              strokeWidth={5}
              pointerEvents="none"
            />
          ))}
          {/* …with the 1 px hairline of the stage boundary over the whole height, on top of it. */}
          {Array.from({ length: n }, (_, i) => (
            <line
              key={`b${i}`}
              x1={padX + (i + 1) * colW + 0.5}
              x2={padX + (i + 1) * colW + 0.5}
              y1={areaTop - 4}
              y2={areaTop + areaH + 5}
              stroke={vars.color.stroke.secondary}
              strokeWidth={1}
              className="visx-line"
              pointerEvents="none"
            />
          ))}
          {/* The highlighted stage keeps its colour; the others are veiled. */}
          {columns.map(({ stage, x0 }) =>
            dimOthers && !matchesHighlight(highlight.parsed, stage.key) ? (
              <rect
                key={`v${stage.key ?? '∅'}`}
                x={x0}
                y={areaTop - 2}
                width={colW}
                height={areaH + 4}
                fill={vars.color.surface.primary}
                fillOpacity={0.6}
                pointerEvents="none"
              />
            ) : null,
          )}
          {/* Hit areas: one per stage column. */}
          {columns.map(({ stage, x0 }) => (
            <rect
              key={`h${stage.key ?? '∅'}`}
              x={x0}
              y={areaTop - 4}
              width={colW}
              height={areaH + 8}
              fill="transparent"
              data-testid="chart-funnel-stage"
              data-group={stage.key ?? ''}
              data-label={stage.label}
              {...props(stage)}
            />
          ))}
        </g>
      </svg>
      {columns.map(({ stage, x0 }) => (
        <div
          key={stage.key ?? '∅'}
          className={s.funnelCard}
          style={{
            left: x0 + colW / 2,
            top: cardTop,
            maxWidth: Math.max(56, colW - 8),
            padding: colW < 80 ? '5px 4px 6px' : undefined,
          }}
          data-testid="chart-funnel-card"
          data-label={stage.label}
        >
          <span className={s.funnelChip}>{formatPercentValue(stage.converted)}</span>
          <span className={s.funnelCardLabel}>{stage.label}</span>
        </div>
      ))}
      {hover && <ChartTooltip content={funnelTooltip(model, hover.stage)} anchor={hover.anchor} />}
    </div>
  );
}

export function FunnelStepsChart({ model, width, height, highlight }: FunnelChartProps) {
  const id = useId();
  const { hover, props } = useFunnelHover(highlight);
  const n = model.stages.length;
  const padX = clamp(width * 0.04, 12, 32);
  const top = 33;
  const bottom = height < 320 ? 56 : 78;
  const plotH = Math.max(40, height - top - bottom);
  const colW = (width - padX * 2) / n;
  const barW = colW * 0.94;
  const topOf = (i: number) => top + plotH * (1 - (model.stages[i]?.height ?? 0));
  const baseline = top + plotH;

  return (
    <div data-testid="chart-funnel" data-chart-kind="steps">
      <svg className={s.svgLayer} width={width} height={height} role="img" aria-label="Funnel steps chart">
        <defs>
          <LinearGradient id={`${id}-ghost`} from={BLUE} to={BLUE} fromOpacity={0.3} toOpacity={0.06} vertical />
        </defs>
        <g className="visx-group">
          {model.stages.map((stage, i) => {
            const x = padX + i * colW;
            const y = topOf(i);
            const dim = isDimmed(highlight, matchesHighlight(highlight.parsed, stage.key));
            const ghostTop = i > 0 ? topOf(i - 1) : y;
            return (
              <g
                key={stage.key ?? '∅'}
                className={`${s.mark} ${dim ? s.dimmed : ''}`}
                data-testid="chart-funnel-stage"
                data-group={stage.key ?? ''}
                data-label={stage.label}
                {...props(stage)}
              >
                {i > 0 && y > ghostTop && (
                  <BarRounded
                    x={x}
                    y={ghostTop}
                    width={barW}
                    height={y - ghostTop}
                    radius={8}
                    top
                    fill={`url(#${id}-ghost)`}
                  />
                )}
                <BarRounded
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(0, baseline - y)}
                  radius={i === 0 ? 8 : 0}
                  top={i === 0}
                  fill={BLUE}
                />
              </g>
            );
          })}
        </g>
      </svg>
      {model.stages.map((stage, i) => {
        const x = padX + i * colW;
        const y = topOf(i);
        return (
          <div key={stage.key ?? '∅'}>
            <div
              className={s.stepBadge}
              style={{ left: x + barW / 2, top: i === 0 ? y + 8 + 28 : y }}
              data-testid="chart-funnel-card"
              data-label={stage.label}
            >
              <span className={s.funnelChip}>{formatPercentValue(stage.converted)}</span>
              <span>{formatStageValue(model, stage.value)}</span>
            </div>
            <div
              className={s.stepLabel}
              style={{ left: x, top: baseline + 16, width: barW }}
              data-testid="chart-funnel-step-label"
            >
              <span className={s.stepLabelIndex}>{i + 1}.</span> {stage.label}
            </div>
          </div>
        );
      })}
      {hover && <ChartTooltip content={funnelTooltip(model, hover.stage)} anchor={hover.anchor} />}
    </div>
  );
}
