import { describe, expect, it } from 'vitest';
import {
  activeQuery,
  applyTextEdit,
  type ComposerText,
  fromAnnotations,
  fuzzyMatch,
  insertToken,
  insertTokenAtCaret,
  removeToken,
  segments,
  tokenEndingAt,
  toSendable,
} from './model';

const DEF = '11111111-1111-4111-8111-111111111111';
const REC = '22222222-2222-4222-8222-222222222222';
const record = { kind: 'record' as const, entityDefinitionId: DEF, entityInstanceId: REC, label: 'Northwind Robotics' };

function mentioned(): ComposerText {
  return insertToken({ text: 'Summary of @North', tokens: [] }, 11, 17, record).value;
}

describe('composer tokens', () => {
  it('inserts a picked record in place of "@query" and records its range', () => {
    const v = mentioned();
    expect(v.text).toBe('Summary of @Northwind Robotics ');
    expect(v.tokens).toEqual([
      { kind: 'record', start: 11, length: 19, entityDefinitionId: DEF, entityInstanceId: REC },
    ]);
  });

  it('shifts tokens after an edit before them and dissolves a touched one', () => {
    const v = mentioned();
    const shifted = applyTextEdit(v, `Please. ${v.text}`);
    expect(shifted.tokens[0]).toMatchObject({ start: 19, length: 19 });
    expect(shifted.text.slice(19, 38)).toBe('@Northwind Robotics');
    const touched = applyTextEdit(v, v.text.replace('Northwind', 'Northwand'));
    expect(touched.tokens).toEqual([]);
  });

  it('removes a token whole and closes the gap', () => {
    const v = mentioned();
    const token = tokenEndingAt(v, 30);
    expect(token?.kind).toBe('record');
    const out = removeToken(v, token as NonNullable<typeof token>);
    expect(out).toEqual({ text: 'Summary of  ', tokens: [] });
  });

  it('finds the "@query" and "/query" being typed', () => {
    expect(activeQuery({ text: 'Hi @Nor', tokens: [] }, 7)).toEqual({ trigger: '@', start: 3, query: 'Nor' });
    expect(activeQuery({ text: '/dai', tokens: [] }, 4)).toEqual({ trigger: '/', start: 0, query: 'dai' });
    expect(activeQuery({ text: 'mail me at a@b.co', tokens: [] }, 17)).toBeNull();
    expect(activeQuery({ text: 'https://example.com/path', tokens: [] }, 24)).toBeNull();
    expect(activeQuery({ text: 'see @one two three four', tokens: [] }, 23)).toBeNull();
    // A caret inside an existing token does not reopen the menu.
    const v = mentioned();
    expect(activeQuery(v, 20)).toBeNull();
  });

  it('inserts a prompt chip at the caret with a separating space', () => {
    const out = insertTokenAtCaret({ text: 'Help', tokens: [] }, 4, {
      kind: 'prompt',
      promptId: 'daily-brief',
      label: 'Daily brief',
    });
    expect(out.value.text).toBe('Help /Daily brief ');
    expect(out.value.tokens[0]).toEqual({ kind: 'prompt', start: 5, length: 12, promptId: 'daily-brief' });
    expect(out.caret).toBe(out.value.text.length);
  });

  it('serializes annotations for the trimmed text', () => {
    const inserted = insertToken({ text: '  Hello @Nor  ', tokens: [] }, 8, 12, record).value;
    expect(inserted.text).toBe('  Hello @Northwind Robotics   ');
    const { content, annotations } = toSendable(inserted);
    expect(content).toBe('Hello @Northwind Robotics');
    expect(annotations).toEqual([
      { type: 'entity-instance', start: 6, length: 19, entityDefinitionId: DEF, entityInstanceId: REC },
    ]);
    expect(content.slice(6, 25)).toBe('@Northwind Robotics');
  });

  it('maps every token kind to its annotation and back', () => {
    let v: ComposerText = { text: '', tokens: [] };
    v = insertToken(v, 0, 0, { kind: 'object', entityDefinitionId: DEF, label: 'Deals' }).value;
    v = insertToken(v, v.text.length, v.text.length, {
      kind: 'member',
      memberId: '33333333-3333-4333-8333-333333333333',
      label: 'Ada Tester',
    }).value;
    v = insertToken(v, v.text.length, v.text.length, {
      kind: 'prompt',
      promptId: 'meeting-prep',
      label: 'Meeting prep',
    }).value;
    const { content, annotations } = toSendable(v);
    expect(annotations.map((a) => a.type)).toEqual(['entity-definition', 'workspace-member', 'prompt']);
    const back = fromAnnotations(content, annotations);
    expect(back.tokens.map((t) => t.kind)).toEqual(['object', 'member', 'prompt']);
    expect(
      segments(back)
        .filter((s) => s.token)
        .map((s) => s.text),
    ).toEqual(['@Deals', '@Ada Tester', '/Meeting prep']);
  });

  it('matches prompt titles loosely', () => {
    expect(fuzzyMatch('brief', 'Daily brief')).toBe(true);
    expect(fuzzyMatch('dbf', 'Daily brief')).toBe(true);
    expect(fuzzyMatch('xyz', 'Daily brief')).toBe(false);
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });
});
