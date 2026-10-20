import { describe, expect, it } from 'vitest';
import {
  activeQuery,
  applyTextEdit,
  insertMention,
  type MentionText,
  mentionEndingAt,
  mentionedRecords,
  removeMention,
  segments,
} from './model';

const rec = { kind: 'record' as const, entityDefinitionId: 'd', entityInstanceId: 'r1', label: 'Cedar Health' };

function withMention(): MentionText {
  const base: MentionText = { text: 'Demo for @Ced', mentions: [] };
  return insertMention(base, 9, 13, rec).value;
}

describe('mention text', () => {
  it('inserts a picked mention in place of "@query" with a trailing space', () => {
    const v = withMention();
    expect(v.text).toBe('Demo for @Cedar Health ');
    expect(v.mentions).toEqual([
      { kind: 'record', start: 9, length: 13, entityDefinitionId: 'd', entityInstanceId: 'r1' },
    ]);
  });

  it('shifts mentions after an edit and drops ones the edit touched', () => {
    const v = withMention();
    const typedBefore = applyTextEdit(v, `Big ${v.text}`);
    expect(typedBefore.mentions[0]?.start).toBe(13);
    const typedAfter = applyTextEdit(v, `${v.text}tomorrow`);
    expect(typedAfter.mentions[0]?.start).toBe(9);
    const broken = applyTextEdit(v, 'Demo for @Cedar Heath ');
    expect(broken.mentions).toEqual([]);
  });

  it('Backspace at a mention end removes it whole', () => {
    const v = withMention();
    const m = mentionEndingAt(v, 22);
    expect(m).not.toBeNull();
    expect(removeMention(v, m as NonNullable<typeof m>)).toEqual({ text: 'Demo for  ', mentions: [] });
  });

  it('finds the query being typed', () => {
    expect(activeQuery({ text: 'Ping @ana', mentions: [] }, 9)).toEqual({ start: 5, query: 'ana' });
    expect(activeQuery({ text: 'Ping @cedar hea', mentions: [] }, 15)).toEqual({ start: 5, query: 'cedar hea' });
    expect(activeQuery({ text: 'mail a@b.com', mentions: [] }, 12)).toBeNull();
    expect(activeQuery({ text: 'no mention', mentions: [] }, 10)).toBeNull();
    const v = withMention();
    expect(activeQuery(v, 15)).toBeNull();
  });

  it('segments and linked records', () => {
    const v = withMention();
    expect(segments(v).map((s) => [s.text, Boolean(s.mention)])).toEqual([
      ['Demo for ', false],
      ['@Cedar Health', true],
      [' ', false],
    ]);
    expect(mentionedRecords(v)).toEqual([{ entityDefinitionId: 'd', entityInstanceId: 'r1' }]);
  });
});
