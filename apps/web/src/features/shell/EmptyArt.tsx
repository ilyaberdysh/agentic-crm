// Quiet line-art for empty states (system-ui §3, notifications §2/§3): a 138 px dotted square with crosshair marks at
// its corners and a thin grey glyph in the middle — the bell of the inbox, the magnifier of "no search results".
import { Icon, type IconName } from '@agentic-crm/ui';
import * as s from './emptyArt.css';

/** `glyph` is the glyph's share of the square (the inbox's bell is large), `stroke` its line weight. */
export function EmptyArt({
  icon,
  size = 138,
  glyph = 0.42,
  stroke = 1.1,
}: {
  icon: IconName;
  size?: number;
  glyph?: number;
  stroke?: number;
}) {
  return (
    <div className={s.art} style={{ width: size, height: size }} aria-hidden="true">
      <span className={`${s.mark} ${s.markTopLeft}`} />
      <span className={`${s.mark} ${s.markTopRight}`} />
      <span className={`${s.mark} ${s.markBottomLeft}`} />
      <span className={`${s.mark} ${s.markBottomRight}`} />
      <Icon icon={icon} size={Math.round(size * glyph)} strokeWidth={stroke} />
    </div>
  );
}
