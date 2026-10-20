import { describe, expect, it } from 'vitest';
import {
  blocksToPlainText,
  type Inline,
  parseBlocks,
  parseComponentJson,
  parseInline,
  parsePartialJson,
} from './parse';

const DEF = '11111111-1111-4111-8111-111111111111';
const REC = '22222222-2222-4222-8222-222222222222';

const text = (t: string): Inline => ({ t: 'text', text: t });

describe('inline markdown', () => {
  it('parses bold, italic, code and strike', () => {
    expect(parseInline('a **b** *c* `d` ~~e~~')).toEqual([
      text('a '),
      { t: 'bold', children: [text('b')] },
      text(' '),
      { t: 'italic', children: [text('c')] },
      text(' '),
      { t: 'code', text: 'd' },
      text(' '),
      { t: 'strike', children: [text('e')] },
    ]);
  });

  it('keeps snake_case words and lone asterisks literal', () => {
    expect(parseInline('use my_variable_name and 2 * 3')).toEqual([text('use my_variable_name and 2 * 3')]);
  });

  it('turns agentic-crm:// entity links into record chips', () => {
    const [chip] = parseInline(`[Acme](agentic-crm://entity-instance:${DEF}/${REC})`);
    expect(chip).toEqual({ t: 'record', entityDefinitionId: DEF, entityInstanceId: REC, label: 'Acme' });
  });

  it('keeps escaped brackets of a record label (server recordLink escapes them)', () => {
    const [chip] = parseInline(`[\\[seed\\] Jane](agentic-crm://entity-instance:${DEF}/${REC})`);
    expect(chip).toMatchObject({ t: 'record', label: '[seed] Jane' });
  });

  it('turns internal meeting links into meeting links and drops unknown links to text', () => {
    const meeting = '33333333-3333-4333-8333-333333333333';
    expect(parseInline(`[Kickoff](agentic-crm://meeting:${meeting})`)).toEqual([
      { t: 'meeting', meetingId: meeting, label: 'Kickoff' },
    ]);
    expect(parseInline('[Who](agentic-crm://workspace-member:abc)')).toEqual([text('Who')]);
  });

  it('links urls and bare domains, not text around them', () => {
    expect(parseInline('see https://a.example/x, ok')).toEqual([
      text('see '),
      { t: 'link', href: 'https://a.example/x', children: [text('https://a.example/x')] },
      text(', ok'),
    ]);
    const parts = parseInline('on northwind.example.com now');
    expect(parts[1]).toMatchObject({ t: 'link', href: 'http://northwind.example.com' });
  });

  it('renders unfinished syntax sensibly while streaming', () => {
    expect(parseInline('this is **bold so f', { streaming: true })).toEqual([
      text('this is '),
      { t: 'bold', children: [text('bold so f')] },
    ]);
    expect(parseInline('see [Acme](agentic-crm://entity-instance:1', { streaming: true })).toEqual([
      text('see [Acme](agentic-crm://entity-instance:1'),
    ]);
    expect(parseInline('a **', { streaming: true })).toEqual([text('a ')]);
    // Not streaming: the same text stays literal.
    expect(parseInline('this is **bold so f')).toEqual([text('this is **bold so f')]);
  });
});

describe('blocks', () => {
  it('flattens headings to bold paragraphs', () => {
    expect(parseBlocks('## People (4)')).toEqual([
      { t: 'p', children: [{ t: 'bold', children: [text('People (4)')] }] },
    ]);
  });

  it('parses paragraphs separated by blank lines and soft breaks', () => {
    expect(parseBlocks('one\ntwo\n\nthree')).toEqual([
      { t: 'p', children: [text('one two')] },
      { t: 'p', children: [text('three')] },
    ]);
  });

  it('parses nested bullet lists and keeps ordered list numbering', () => {
    const blocks = parseBlocks('- a\n  - a1\n  - a2\n- b\n\n3. x\n4. y');
    expect(blocks[0]).toMatchObject({
      t: 'ul',
      items: [
        [
          { t: 'p', children: [text('a')] },
          { t: 'ul', items: [[{ t: 'p', children: [text('a1')] }], [{ t: 'p', children: [text('a2')] }]] },
        ],
        [{ t: 'p', children: [text('b')] }],
      ],
    });
    expect(blocks[1]).toMatchObject({ t: 'ol', start: 3 });
  });

  it('parses GFM tables with alignment and record chips in cells', () => {
    const md = `| Name | Role |\n| :-- | --: |\n| [Jane](agentic-crm://entity-instance:${DEF}/${REC}) | CEO |`;
    const [table] = parseBlocks(md);
    expect(table).toMatchObject({ t: 'table', align: ['left', 'right'] });
    if (table?.t !== 'table') throw new Error('no table');
    expect(table.head).toEqual([[text('Name')], [text('Role')]]);
    expect(table.rows[0]?.[0]?.[0]).toMatchObject({ t: 'record', label: 'Jane' });
    expect(table.rows[0]?.[1]).toEqual([text('CEO')]);
  });

  it('hides a table row still being typed while streaming', () => {
    const md = '| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | ';
    const streaming = parseBlocks(md, { streaming: true })[0];
    const done = parseBlocks(md)[0];
    expect(streaming?.t === 'table' && streaming.rows).toHaveLength(1);
    expect(done?.t === 'table' && done.rows).toHaveLength(2);
  });

  it('turns agentic-crm: fences into component blocks with block keys', () => {
    const md =
      'Done.\n\n```agentic-crm:task-embed\n{"task_id":"t1"}\n```\n\n```agentic-crm:task-embed\n{"task_id":"t2"}\n```';
    const blocks = parseBlocks(md);
    expect(blocks[1]).toEqual({
      t: 'component',
      id: 'task-embed',
      data: '{"task_id":"t1"}',
      partial: false,
      key: 'task-embed:0',
    });
    expect(blocks[2]).toMatchObject({ key: 'task-embed:1' });
  });

  it('marks an unclosed component fence partial only while streaming', () => {
    const md = '```agentic-crm:entity-embed\n{"entity_definition_id": "';
    expect(parseBlocks(md, { streaming: true })[0]).toMatchObject({ t: 'component', partial: true });
    expect(parseBlocks(md)[0]).toMatchObject({ t: 'component', partial: false });
  });

  it('keeps other fences as code blocks', () => {
    expect(parseBlocks('```sql\nSELECT 1\n```')).toEqual([
      { t: 'code', lang: 'sql', text: 'SELECT 1', partial: false },
    ]);
  });

  it('parses quotes', () => {
    expect(parseBlocks('> hello **you**')[0]).toMatchObject({ t: 'quote' });
  });

  it('extracts plain text for the copy button', () => {
    const plain = blocksToPlainText(parseBlocks('**Hi** there\n\n- a\n- b\n\n| X | Y |\n| - | - |\n| 1 | 2 |'));
    expect(plain).toBe('Hi there\n- a\n- b\nX | Y\n1 | 2');
  });
});

describe('component json', () => {
  it('parses complete bodies and rejects arrays and garbage', () => {
    expect(parseComponentJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseComponentJson('[1]')).toBeNull();
    expect(parseComponentJson('{"a":')).toBeNull();
  });

  it('closes unfinished json for call snippets that are still streaming', () => {
    const partial = parsePartialJson(
      '{"meeting_id":"m","call_recording_id":"c","snippets":[{"title":"Budget","start_time":"1:02","end_time":"1:3',
    );
    expect(partial).toMatchObject({ meeting_id: 'm', snippets: [{ title: 'Budget', start_time: '1:02' }] });
    expect(parsePartialJson('{"a":1,')).toEqual({ a: 1 });
  });
});
