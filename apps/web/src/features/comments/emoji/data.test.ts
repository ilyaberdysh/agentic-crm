import { emojiSchema } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { EMOJI_CATEGORIES, emojiName, searchEmoji } from './data';

describe('emoji set', () => {
  it('every emoji is accepted by the reaction schema', () => {
    const bad = EMOJI_CATEGORIES.flatMap((c) => c.emojis).filter((e) => !emojiSchema.safeParse(e.emoji).success);
    expect(bad).toEqual([]);
  });

  it('searches by CLDR name words (E README §2.8: "thumbs" → 👍 👎)', () => {
    expect(searchEmoji('thumbs').map((e) => e.emoji)).toEqual(['👍', '👎']);
    expect(searchEmoji('red heart').map((e) => e.emoji)).toContain('❤️');
    expect(emojiName('🎉')).toBe('party popper');
  });

  it('starts with Smileys & Emotion and People & Body', () => {
    expect(EMOJI_CATEGORIES.slice(0, 2).map((c) => c.name)).toEqual(['Smileys & Emotion', 'People & Body']);
  });
});
