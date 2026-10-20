// The centred empty / error / gated state of a chart: our own illustration (a bar glyph in a rounded square on a dotted
// grid with crosses in the corners), a title and a subtitle (evidence H/dashboard-empty.png, editor-type-picker.png).

import { cx } from '@agentic-crm/ui';
import { vars } from '@agentic-crm/ui/styles';
import { type ReactNode, useId } from 'react';
import {
  type ChartMessageCopy,
  MESSAGE_NO_COMPARISON,
  MESSAGE_NO_DATA,
  MESSAGE_PIE_NEGATIVE,
  MESSAGE_WRONG_VISUALISATION,
  tooManyMessage,
} from './messages';
import type { ChartStateKind } from './model/cartesian';
import * as s from './view/chart.css';

/** The illustration: 160×160, drawn from theme tokens (it switches with the theme). */
export function ChartGlyph({ className }: { className?: string }) {
  const id = useId();
  const dot = vars.color.stroke.secondary;
  const cross = vars.color.stroke.secondary;
  const frame = vars.color.stroke.secondary;
  const bar = vars.color.stroke.tertiary;
  return (
    <svg
      className={cx(s.messageArt, className)}
      viewBox="0 0 160 160"
      fill="none"
      aria-hidden="true"
      data-testid="chart-message-art"
    >
      <defs>
        <pattern id={`${id}-dots`} width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="0.6" fill={dot} />
        </pattern>
      </defs>
      <rect x="6" y="6" width="148" height="148" fill={`url(#${id}-dots)`} />
      {[
        [6, 6],
        [154, 6],
        [6, 154],
        [154, 154],
      ].map(([x, y]) => (
        <path
          key={`${x}-${y}`}
          d={`M${(x ?? 0) - 4} ${y}H${(x ?? 0) + 4}M${x} ${(y ?? 0) - 4}V${(y ?? 0) + 4}`}
          stroke={cross}
          strokeWidth="1"
        />
      ))}
      <rect
        x="28"
        y="28"
        width="104"
        height="104"
        rx="30"
        fill={vars.color.surface.primary}
        stroke={vars.color.stroke.primary}
        strokeWidth="7"
      />
      <rect
        x="26"
        y="26"
        width="108"
        height="108"
        rx="32"
        fill="none"
        stroke={vars.color.stroke.tertiary}
        strokeWidth="1.25"
      />
      <g stroke={bar} strokeWidth="4" strokeLinecap="round">
        <path d="M55 66V102" />
        <path d="M81 56V102" />
        <path d="M105 84V102" />
      </g>
    </svg>
  );
}

export interface ChartMessageProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

/** Title + subtitle under the illustration, centred in the chart box. */
export function ChartMessage({ title, subtitle, action, className }: ChartMessageProps) {
  return (
    <div className={cx(s.message, className)} role="status" data-testid="chart-message">
      <ChartGlyph />
      <div className={s.messageTitle} data-testid="chart-message-title">
        {title}
      </div>
      {subtitle ? (
        <div className={s.messageSub} data-testid="chart-message-subtitle">
          {subtitle}
        </div>
      ) : null}
      {action ? <div className={s.messageAction}>{action}</div> : null}
    </div>
  );
}

/** The copy of a chart state. */
export function stateCopy(state: ChartStateKind): ChartMessageCopy {
  switch (state.kind) {
    case 'empty':
      return MESSAGE_NO_DATA;
    case 'noComparison':
      return MESSAGE_NO_COMPARISON;
    case 'negative':
      return MESSAGE_PIE_NEGATIVE;
    case 'tooMany':
      return tooManyMessage(state.nouns);
    case 'unsupported':
      return MESSAGE_WRONG_VISUALISATION;
  }
}
