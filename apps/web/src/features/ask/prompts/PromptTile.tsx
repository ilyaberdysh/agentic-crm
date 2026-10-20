import { Icon } from '@agentic-crm/ui';
import { vars } from '@agentic-crm/ui/styles';
import { promptColor, promptIcon } from './icons';

const u = vars.color.utilities;

/** `utilities.<surface|content>.<hue>` for the prompt colours that have a subtle pair. */
function tones(color: string | null | undefined): { bg: string; fg: string } {
  const hue = promptColor(color);
  const surface = u.surface as Record<string, string>;
  const content = u.content as Record<string, string>;
  return {
    bg: surface[`${hue}Subtle`] ?? surface.greySubtle ?? 'transparent',
    fg: content[hue] ?? content.grey ?? 'currentColor',
  };
}

/** The icon tile of a prompt: its glyph in the prompt colour on a pastel rounded square. */
export function PromptTile({
  iconId,
  color,
  size = 20,
}: {
  iconId: string | null | undefined;
  color: string | null | undefined;
  size?: 20 | 24 | 28 | 40 | 56;
}) {
  const { bg, fg } = tones(color);
  const radius = size >= 40 ? 14 : size >= 28 ? 8 : 6;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: bg,
        color: fg,
      }}
    >
      <Icon icon={promptIcon(iconId)} size={Math.round(size * 0.55)} strokeWidth={size <= 28 ? 2 : 1.75} />
    </span>
  );
}
