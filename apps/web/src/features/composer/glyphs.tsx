// Small glyphs the composer footer needs and the icon set lacks, drawn here on a 16 px grid in the same 1.5 px stroke
// (not derived from the artwork): the variable braces, an envelope with a pen (compose), stacked envelopes
// (email templates).
import type { IconGlyph } from '@agentic-crm/ui';
import type { ComponentProps } from 'react';

type Props = ComponentProps<IconGlyph>;

function Svg({ size = 16, strokeWidth, children, ...rest }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={Number(strokeWidth ?? 1.5)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** `{x}` — "Add variable". */
export const VariableGlyph: IconGlyph = (props) => (
  <Svg {...props}>
    <path d="M5.5 2.5c-1.2 0-1.8.5-1.8 1.7v1.1c0 .9-.4 1.5-1.2 1.7.8.2 1.2.8 1.2 1.7v1.1c0 1.2.6 1.7 1.8 1.7" />
    <path d="M10.5 2.5c1.2 0 1.8.5 1.8 1.7v1.1c0 .9.4 1.5 1.2 1.7-.8.2-1.2.8-1.2 1.7v1.1c0 1.2-.6 1.7-1.8 1.7" />
    <path d="M6.6 6.2l2.8 3.6M9.4 6.2L6.6 9.8" strokeWidth={1.25} />
  </Svg>
);

/** An envelope with a pen: "Compose email". */
export const ComposeGlyph: IconGlyph = (props) => (
  <Svg {...props}>
    <path d="M13.5 8V5.2c0-.9-.7-1.7-1.7-1.7H4.2c-1 0-1.7.8-1.7 1.7v5.6c0 .9.7 1.7 1.7 1.7H8" />
    <path d="M2.8 5.3 8 8.6l5.2-3.3" />
    <path d="M12.8 9.6l1.6 1.6-3 3-2 .4.4-2 3-3z" />
  </Svg>
);

/** Stacked envelopes: "Email templates". */
export const TemplatesGlyph: IconGlyph = (props) => (
  <Svg {...props}>
    <path d="M4 3.2h7.8c.9 0 1.5.6 1.5 1.5V9" />
    <rect x="2.2" y="5.6" width="10.2" height="7.4" rx="1.6" />
    <path d="M2.6 6.4 7.3 9.6l4.7-3.2" />
  </Svg>
);
