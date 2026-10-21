// Empty-state illustration of record tabs (Files, Tasks, Calls…): a dotted tile with corner marks and a framed
// glyph. Drawn for this project (the illustrations are not reused).
import { Icon, type IconName } from '@agentic-crm/ui';
import * as s from './ui.css';

const CORNERS = [
  { left: -3, top: -3 },
  { right: -3, top: -3 },
  { left: -3, bottom: -3 },
  { right: -3, bottom: -3 },
];

export function EmptyIllustration({ icon }: { icon: IconName }) {
  return (
    <div className={s.illustration} aria-hidden="true">
      <span className={s.illustrationDots} />
      {CORNERS.map((pos) => (
        <span key={JSON.stringify(pos)} className={s.illustrationCorner} style={pos} />
      ))}
      <span className={s.illustrationFrame}>
        <Icon icon={icon} size={48} strokeWidth={1.25} />
      </span>
    </div>
  );
}
