// Gallery layout helpers: every section renders its specimens twice, light and dark.
import type { ReactNode } from 'react';
import { ThemeProvider } from '../../src';
import { cx } from '../../src/utils/cx';
import * as g from './gallery.css';

export function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={g.section} data-section={id}>
      <h2 className={g.sectionTitle}>{title}</h2>
      {note && <p className={g.sectionNote}>{note}</p>}
      {children}
    </section>
  );
}

/** Renders `render()` in a light and a dark panel side by side. */
export function Panels({ children, secondary }: { children: () => ReactNode; secondary?: boolean }) {
  return (
    <div className={g.panels}>
      {(['light', 'dark'] as const).map((identity) => (
        <ThemeProvider key={identity} identity={identity}>
          <div className={cx(g.panel, secondary && g.panelSecondary)} data-panel={identity}>
            <span className={g.panelLabel}>{identity}</span>
            {children()}
          </div>
        </ThemeProvider>
      ))}
    </div>
  );
}

export function Row({ label, children, top }: { label?: ReactNode; children: ReactNode; top?: boolean }) {
  return (
    <div className={cx(g.row, top && g.rowTop)}>
      {label !== undefined && <span className={g.label}>{label}</span>}
      {children}
    </div>
  );
}

export function Col({ children }: { children: ReactNode }) {
  return <div className={g.col}>{children}</div>;
}
