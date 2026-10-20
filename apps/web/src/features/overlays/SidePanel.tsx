// Right side panel frame (CROSS-DOMAIN B.16 "Right panels": comments 320 px, full height, 1 px left border). The
// page lays it out next to its content (flex row); one panel at a time per page.
import { cx } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import * as s from './overlays.css';

export function SidePanel({
  width = 320,
  label,
  children,
  className,
  testId,
}: {
  width?: number;
  label: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <aside className={cx(s.sidePanel, className)} style={{ width }} aria-label={label} data-testid={testId}>
      {children}
    </aside>
  );
}
