// Glyphs of the reports feature (report types and visualisations), drawn for this project on a 24 grid in the same
// line style as the shared icon map (the Icon component hands `size` and `strokeWidth`).
import type { IconGlyph } from '@agentic-crm/ui';
import type { SVGProps } from 'react';

type Props = Omit<SVGProps<SVGSVGElement>, 'ref'> & { size?: number | string; strokeWidth?: number | string };

function glyph(children: React.ReactNode): IconGlyph {
  return function Glyph({ size = 16, strokeWidth = 2, ...rest }: Props) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {children}
      </svg>
    );
  };
}

/** Insight: a pie with its slice pulled out. */
export const InsightIcon = glyph(
  <>
    <path d="M12 3a9 9 0 1 0 9 9h-9z" />
    <path d="M15 3.5A9 9 0 0 1 20.5 9H15z" />
  </>,
);
/** Historical values: a clock over a baseline. */
export const HistoricalIcon = glyph(
  <>
    <circle cx="14" cy="10" r="6" />
    <path d="M14 7v3l2 1.5" />
    <path d="M3 21h18" />
    <path d="M5 17v4M9 15v6" />
  </>,
);
/** Funnel report: a play-framed funnel. */
export const FunnelIcon = glyph(
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M8 9h8l-3 3.5V16h-2v-3.5z" />
  </>,
);
/** Time in stage: stage bars with a clock. */
export const TimeInStageIcon = glyph(
  <>
    <path d="M4 5v14M9 8v11M4 5h2M9 8h2" />
    <circle cx="16.5" cy="14.5" r="4.5" />
    <path d="M16.5 12.5v2l1.5 1" />
  </>,
);
/** Stage changed: stage bars with a move arrow. */
export const StageChangedIcon = glyph(
  <>
    <path d="M4 5v14M9 8v11M4 5h2M9 8h2" />
    <path d="M14 12h7M18 8l3 4-3 4" />
  </>,
);

export const SingleMetricIcon = glyph(
  <>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M9 15v-4l-1 1M13 11h3v4h-3z" />
  </>,
);
export const BarIcon = glyph(
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M8 16v-3M12 16V9M16 16v-5" />
  </>,
);
export const LineIcon = glyph(
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="m7 14 3.5-3 2.5 2 4-4" />
  </>,
);
export const PieIcon = glyph(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v9h9" />
  </>,
);
export const MapIcon = glyph(
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="12" cy="11" r="2.5" />
    <path d="M12 13.5V16" />
  </>,
);
export const FunnelAreaIcon = FunnelIcon;
export const FunnelStepsIcon = glyph(
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M7.5 16V9M12 16v-5M16.5 16v-3" />
  </>,
);
export const FunnelMetricIcon = glyph(
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M7 12h10M14 9l3 3-3 3" />
  </>,
);
/** Dashboard tile glyph (rows of the index). */
export const DashboardTileIcon = glyph(
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
  </>,
);
/** Report chip glyph (a chart in a frame). */
export const ReportIcon = BarIcon;
export const DocumentIcon = glyph(
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </>,
);
export const CompareIcon = glyph(
  <>
    <path d="M4 8h14l-3-3M20 16H6l3 3" />
  </>,
);
