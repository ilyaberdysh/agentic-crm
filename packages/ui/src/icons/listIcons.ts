// Lists icons (slice 4, C2 README §2): list header menu, empty states, remove from list → Lucide glyphs. Kept in
// their own map (spread into iconMap) so parallel slices add icons without touching the same lines.
import { CopyPlus, GraduationCap, ListMinus } from 'lucide-react';
import type { IconGlyph } from './types';

export const listIconMap = {
  duplicate: CopyPlus,
  learn: GraduationCap,
  listRemove: ListMinus,
} satisfies Record<string, IconGlyph>;
