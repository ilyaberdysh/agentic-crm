// List icons use the stored `emoji:<shortname>` format (default `emoji:clipboard`) and render
// the emoji at 16–20 px. We keep that format; a raw emoji or an unknown name falls back sensibly (📋).
import { EMOJI_CATEGORIES } from '../comments/emoji/data';
import * as s from './lists.css';

export const DEFAULT_EMOJI = '📋';

const ENTRIES = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
const BY_NAME = new Map(ENTRIES.map((e) => [shortName(e.name), e.emoji] as const));
const BY_EMOJI = new Map(ENTRIES.map((e) => [e.emoji, shortName(e.name)] as const));

function shortName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** The emoji character of a stored list icon. */
export function listEmoji(icon: string | null | undefined): string {
  if (!icon) return DEFAULT_EMOJI;
  if (icon.startsWith('emoji:')) return BY_NAME.get(shortName(icon.slice(6))) ?? DEFAULT_EMOJI;
  // A raw emoji (no ASCII letters) is shown as is.
  return /[a-z]/i.test(icon) ? DEFAULT_EMOJI : icon;
}

/** The stored form of a picked emoji (`emoji:rocket`). */
export function iconOfEmoji(emoji: string): string {
  const name = BY_EMOJI.get(emoji);
  return name ? `emoji:${name}` : emoji;
}

/** A list's emoji at a given size (sidebar 16, header 18, settings tile 20+). */
export function ListIcon({ icon, size = 16 }: { icon: string | null | undefined; size?: number }) {
  return (
    <span className={s.emoji} style={{ fontSize: Math.round(size * 0.92), width: size, height: size }} aria-hidden>
      {listEmoji(icon)}
    </span>
  );
}
