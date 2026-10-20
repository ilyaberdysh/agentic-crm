// Our own drop-zone illustration (clean room: Attio's artwork is not copied): a folder holding a spreadsheet, with an
// upload arrow. Strokes follow the text colour; the sheet's grid uses the accent.
export function UploadIllustration() {
  return (
    <svg width="88" height="96" viewBox="0 0 88 96" fill="none" aria-hidden="true">
      <g stroke="var(--ar-color-content-accent)" strokeWidth="1" opacity="0.9">
        <rect x="20" y="6" width="52" height="44" rx="3" fill="var(--ar-color-surface-primary)" />
        <path d="M20 16h52M20 26h52M20 36h52M33 6v44M46 6v44M59 6v44" />
      </g>
      <path
        d="M10 34.5a3.5 3.5 0 0 1 3.5-3.5h16l5 5h35a3.5 3.5 0 0 1 3.5 3.5V76a3.5 3.5 0 0 1-3.5 3.5h-56A3.5 3.5 0 0 1 10 76z"
        fill="var(--ar-color-surface-primary)"
        stroke="var(--ar-color-content-primary)"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M14 42.5a3 3 0 0 1 3-3h56a3 3 0 0 1 3 3V76"
        stroke="var(--ar-color-content-primary)"
        strokeWidth="1"
        opacity="0.45"
      />
      <path
        d="M52 90c13-2 20-11 19-24"
        stroke="var(--ar-color-content-primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M64 71l7-7 6 7.5"
        stroke="var(--ar-color-content-primary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
