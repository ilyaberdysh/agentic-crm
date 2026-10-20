// Glyphs of the email settings that the shared icon map lacks, drawn for this project on the Lucide 24 grid (stroke
// glyphs that take `size` and `strokeWidth` like every other icon, so `<Icon icon={MailMetadataGlyph} />` works).
import type { IconGlyph } from '@agentic-crm/ui';
import type { ReactNode } from 'react';

function glyph(children: ReactNode): IconGlyph {
  return function Glyph({ size = 24, strokeWidth = 2, ...rest }) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        {children}
      </svg>
    );
  };
}

/** Closed envelope: "Metadata only". */
export const MailMetadataGlyph = glyph(
  <>
    <rect x="2.5" y="5" width="19" height="14" rx="3" />
    <path d="m3.5 8.5 8.5 5.5 8.5-5.5" />
  </>,
);

/** Envelope with a lifted flap: "Subject line and metadata". */
export const MailSubjectGlyph = glyph(
  <>
    <path d="M3 10.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7.5" />
    <path d="m3 10.5 7.2-5.1a3 3 0 0 1 3.6 0l7.2 5.1" />
    <path d="m3 10.5 9 5.5 9-5.5" />
  </>,
);

/** Letter with text lines inside an envelope: "Full access". */
export const MailFullGlyph = glyph(
  <>
    <path d="M3 11v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="m3 11 9 5.5 9-5.5" />
    <path d="M6.5 13V4.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1V13" />
    <path d="M10 7h4M10 9.5h4" />
  </>,
);

/** Person with a "not allowed" badge: the Mailbox-only blocklist tab and its empty state. */
export const UserBlockGlyph = glyph(
  <>
    <circle cx="9" cy="7.5" r="3.5" />
    <path d="M2.5 20.5v-1A5.5 5.5 0 0 1 8 14h2" />
    <circle cx="17.5" cy="17.5" r="4" />
    <path d="m14.7 20.3 5.6-5.6" />
  </>,
);

/** Person with a small gear: "Selective contact creation" and the Record creation tab. */
export const UserCogGlyph = glyph(
  <>
    <circle cx="9" cy="7.5" r="3.5" />
    <path d="M2.5 20.5v-1A5.5 5.5 0 0 1 8 14h1.5" />
    <circle cx="17.5" cy="17.5" r="2" />
    <path d="M17.5 13.5v1.2M17.5 20.3v1.2M13.5 17.5h1.2M20.3 17.5h1.2M14.7 14.7l.85.85M19.45 19.45l.85.85M20.3 14.7l-.85.85M15.55 19.45l-.85.85" />
  </>,
);

/** A square with a diagonal stroke: "None". */
export const NoneGlyph = glyph(
  <>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="m9 15 6-6" />
  </>,
);

/** Envelope with a small globe: the Email visibility tab. */
export const MailGlobeGlyph = glyph(
  <>
    <path d="M13 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3" />
    <path d="m3.5 8 8.5 5.5L20.5 8" />
    <circle cx="17.5" cy="17.5" r="4" />
    <path d="M13.5 17.5h8M17.5 13.5c-1.4 1.3-1.4 6.7 0 8M17.5 13.5c1.4 1.3 1.4 6.7 0 8" />
  </>,
);

/** Envelope with a small shield: protected contacts. */
export const ShieldMailGlyph = glyph(
  <>
    <path d="M12 3 5 6v5c0 4.4 2.9 8.2 7 9.5 4.1-1.3 7-5.1 7-9.5V6l-7-3Z" />
    <path d="m9 11.5 3 2 3-2" />
  </>,
);
