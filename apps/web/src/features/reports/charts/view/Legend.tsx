// The legend row above the plot: 12×12 swatches (radius 3) with 12 px labels, 16 px apart, overflowing into "+N more".
import { cx } from '@agentic-crm/ui';
import { useMemo } from 'react';
import * as s from './chart.css';
import { measureText } from './hooks';

export interface LegendEntry {
  /** Highlight key hovering this item reports (null = none). */
  highlightKey: string | null;
  label: string;
  /** CSS colour. */
  color: string;
  /** Square (bars, pie), short dash (lines), or the previous-period swatch. */
  shape: 'square' | 'dash' | 'comparison';
}

const SWATCH = 12;
const GAP = 16;
const LABEL_GAP = 6;
const itemWidth = (label: string) => SWATCH + LABEL_GAP + measureText(label);

/** How many entries fit `maxWidth` next to a "+N more" item. */
export function legendFit(labels: readonly string[], maxWidth: number): number {
  const total = labels.reduce((w, l, i) => w + itemWidth(l) + (i > 0 ? GAP : 0), 0);
  if (total <= maxWidth) return labels.length;
  let k = labels.length - 1;
  while (k > 1) {
    const used = labels.slice(0, k).reduce((w, l, i) => w + itemWidth(l) + (i > 0 ? GAP : 0), 0);
    if (used + GAP + itemWidth(`+${labels.length - k} more`) <= maxWidth) break;
    k--;
  }
  return Math.max(1, k);
}

function Swatch({ entry }: { entry: LegendEntry }) {
  if (entry.shape === 'comparison') return <span className={s.legendComparisonSwatch} />;
  if (entry.shape === 'dash') return <span className={s.legendDash} style={{ backgroundColor: entry.color }} />;
  return <span className={s.legendSwatch} style={{ backgroundColor: entry.color }} />;
}

export interface LegendProps {
  entries: LegendEntry[];
  /** Widest the row may get (the plot width). */
  maxWidth: number;
  top: number;
  /** Total width of the chart: the row is centred in it. */
  width: number;
  onFocus: (key: string | null) => void;
}

export function Legend({ entries, maxWidth, top, width, onFocus }: LegendProps) {
  const fit = useMemo(
    () =>
      legendFit(
        entries.map((e) => e.label),
        maxWidth,
      ),
    [entries, maxWidth],
  );
  const shown = entries.slice(0, fit);
  const hidden = entries.slice(fit);
  return (
    <div className={s.legend} style={{ left: 0, width, top }} data-testid="chart-legend">
      {shown.map((e) => (
        <span
          key={`${e.highlightKey}-${e.label}`}
          className={s.legendItem}
          data-testid="chart-legend-item"
          data-label={e.label}
          onMouseEnter={() => e.highlightKey && onFocus(e.highlightKey)}
          onMouseLeave={() => e.highlightKey && onFocus(null)}
        >
          <Swatch entry={e} />
          {e.label}
        </span>
      ))}
      {hidden.length > 0 && (
        <span className={s.legendMore} data-testid="chart-legend-more">
          <span className={s.legendMulti}>
            {hidden.slice(0, 4).map((h, i) => (
              <span key={i} className={s.legendMultiCell} style={{ backgroundColor: h.color }} />
            ))}
          </span>
          +{hidden.length} more
          <span className={s.legendOverflow}>
            {hidden.map((e) => (
              <span
                key={`${e.highlightKey}-${e.label}`}
                className={cx(s.legendItem)}
                onMouseEnter={() => e.highlightKey && onFocus(e.highlightKey)}
                onMouseLeave={() => e.highlightKey && onFocus(null)}
              >
                <Swatch entry={e} />
                {e.label}
              </span>
            ))}
          </span>
        </span>
      )}
    </div>
  );
}
