// Axis titles and column headers: "Budget › Sum" with the separator drawn as a small chevron.
import * as s from './chart.css';

/** "Budget › Sum": the separators are drawn as small chevrons. */
export function TitleText({ text }: { text: string }) {
  const parts = text.split('›').map((p) => p.trim());
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && (
            <svg className={s.titleChevron} viewBox="0 0 8 8" fill="none" aria-hidden="true">
              <path
                d="M2.8 1.2 5.6 4 2.8 6.8"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <span>{p}</span>
        </span>
      ))}
    </>
  );
}
