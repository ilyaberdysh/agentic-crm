import { Icon, type IconGlyph, type IconName } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import * as s from './empty.css';

const CORNERS = [
  { left: -3, top: -3 },
  { right: -3, top: -3 },
  { left: -3, bottom: -3 },
  { right: -3, bottom: -3 },
];

/** Dotted tile with corner marks and a framed glyph (drawn for this project). */
export function EmptyArt({ icon }: { icon: IconName | IconGlyph }) {
  return (
    <div className={s.art} aria-hidden="true">
      <span className={s.dots} />
      {CORNERS.map((pos) => (
        <span key={JSON.stringify(pos)} className={s.corner} style={pos} />
      ))}
      <span className={s.frame}>
        <Icon icon={icon} size={48} strokeWidth={1.25} />
      </span>
    </div>
  );
}

/** Art, title, description and the primary action, centred. */
export function EmptyBlock({
  icon,
  title,
  description,
  action,
  testId,
}: {
  icon: IconName | IconGlyph;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className={s.block} data-testid={testId}>
      <EmptyArt icon={icon} />
      <h2 className={s.title}>{title}</h2>
      <p className={s.description}>{description}</p>
      {action && <div className={s.action}>{action}</div>}
    </div>
  );
}
