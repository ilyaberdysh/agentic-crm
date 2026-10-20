// Single metric (and Funnel Metric, which shares the layout): blue square + caption, the value, a sub-caption.
import { cx } from '@agentic-crm/ui';
import type { FunnelMetricModel } from '../model/funnel';
import type { SingleMetricModel } from '../model/single';
import * as s from './chart.css';
import type { ChartSize } from './layout';

export function SingleMetric({ model, size }: { model: SingleMetricModel; size: ChartSize }) {
  return (
    <div className={s.single} data-testid="chart-single-metric">
      <div className={s.singleCaption} data-testid="chart-single-caption">
        <span className={s.singleSquare} />
        {model.caption}
      </div>
      <div className={cx(s.singleValue, size === 'cell' && s.singleValueCell)} data-testid="chart-single-value">
        {model.value}
      </div>
      <div className={s.singleSub} data-testid="chart-single-sub">
        {model.subCaption}
      </div>
    </div>
  );
}

function PathChevron() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path
        d="M2.8 1.2 5.6 4 2.8 6.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FunnelMetric({ model, size }: { model: FunnelMetricModel; size: ChartSize }) {
  return (
    <div className={s.single} data-testid="chart-single-metric" data-funnel-metric="">
      <div className={s.singleCaption} data-testid="chart-single-caption">
        <span className={s.singleSquare} />
        {model.caption}
      </div>
      <div className={cx(s.singleValue, size === 'cell' && s.singleValueCell)} data-testid="chart-single-value">
        {model.value}
      </div>
      <div className={s.funnelPath} data-testid="chart-funnel-path">
        {model.path.map((label, i) => (
          <span key={`${label}-${i}`} style={{ display: 'contents' }}>
            {i > 0 && <PathChevron />}
            <span className={s.funnelPathItem} title={label}>
              {label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
