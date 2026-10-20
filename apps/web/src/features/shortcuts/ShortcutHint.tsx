// Key caps for a shortcut: `mod+k` → ⌘ K; a sequence renders the literal word "then" between its
// steps (`g h` → G then). Used by tooltips, the help drawer and the palette.
import { Kbd, type KbdSize, type KbdVariant } from '@agentic-crm/ui';
import { shortcutKeys } from '../../lib/shortcuts';
import { catalogEntry } from './catalog';
import * as s from './help.css';

export function ShortcutCaps({
  shortcut,
  size = 16,
  variant = 'default',
}: {
  shortcut: string;
  size?: KbdSize;
  variant?: KbdVariant;
}) {
  const steps = shortcutKeys(shortcut);
  return (
    <span className={s.caps} data-shortcut={shortcut}>
      {steps.map((keys, i) => (
        <span key={i} className={s.capStep}>
          {i > 0 && <span className={s.then}>then</span>}
          <Kbd keys={keys} size={size} variant={variant} />
        </span>
      ))}
    </span>
  );
}

/** "Go to home page  G then H" — tooltip content. */
export function ShortcutTooltip({ description, shortcut }: { description: string; shortcut?: string }) {
  if (!shortcut) return <>{description}</>;
  return (
    <span className={s.tooltipRow}>
      {description}
      <ShortcutCaps shortcut={shortcut} size={20} variant="tooltip" />
    </span>
  );
}

/** Tooltip content for a catalog action: its description (or `label`) with its keys. */
export function ActionTooltip({ id, label }: { id: string; label?: string }) {
  const entry = catalogEntry(id);
  return <ShortcutTooltip description={label ?? entry.description} shortcut={entry.keys} />;
}
