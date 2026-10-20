// Projection round-trips for every block type and every mark: blocks ↔ ProseMirror JSON ↔ Yjs state, and
// blocks ↔ markdown for everything markdown can carry (E editor.md §6, E README §6).
import { Node as PMNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  type Block,
  blocksToMarkdown,
  blocksToPlaintext,
  blocksToPmJson,
  blocksToState,
  getDocumentSchema,
  imageBlock,
  listNumbers,
  markdownToBlocks,
  mentionsOf,
  normalizeStyles,
  parseInlineMarkdown,
  pmJsonToBlocks,
  presenceColor,
  projectState,
  replaceYDocContent,
  type StyleRange,
  stateToBlocks,
  textBlock,
  yDocFromState,
  yDocToBlocks,
} from '../src/model/index.ts';

const viaPm = (blocks: Block[]) => {
  const json = blocksToPmJson(blocks);
  // Must be a valid document of the shared schema.
  const node = PMNode.fromJSON(getDocumentSchema(), json);
  node.check();
  return pmJsonToBlocks(node.toJSON());
};
const viaYjs = (blocks: Block[]) => stateToBlocks(blocksToState(blocks));
const viaMarkdown = (blocks: Block[]) => markdownToBlocks(blocksToMarkdown(blocks));

/** A style range without the whitespace at its edges (markdown delimiters hug non-space characters). */
const trimRange = (text: string, s: StyleRange): StyleRange | null => {
  let start = s.start;
  let end = s.start + s.length;
  while (start < end && /\s/.test(text[start] as string)) start++;
  while (end > start && /\s/.test(text[end - 1] as string)) end--;
  return end > start ? { ...s, start, length: end - start } : null;
};

/** Blocks as markdown can carry them: no colours, mentions or images; styles trimmed of edge whitespace. */
const markdownSubset = (blocks: Block[]) =>
  blocks
    .filter((b) => b.type !== 'image-embed')
    .map((b) => ({
      ...b,
      mentions: [],
      styles: b.styles
        .filter((s) => s.style !== 'COLORED')
        .map((s) => (s.style === 'HIGHLIGHTED' ? { ...s, color: 'pastel_yellow' } : { ...s }))
        .map((s) => trimRange(b.text, s))
        .filter((s): s is StyleRange => s !== null),
    }))
    .map((b) => ({ ...b, styles: normalizeStyles(b.styles) }));

const everyBlockType: Block[] = [
  textBlock('h1', 'Heading one'),
  textBlock('h2', 'Heading two'),
  textBlock('h3', 'Heading three'),
  textBlock('unstyled', 'Body text'),
  textBlock('ul', 'Bullet level 0'),
  textBlock('ul', 'Bullet level 1', { indent: 1 }),
  textBlock('ul', 'Bullet level 6', { indent: 6 }),
  textBlock('ol', 'Number level 0'),
  textBlock('ol', 'Number level 1', { indent: 1 }),
  textBlock('ol', 'Number again'),
  imageBlock({ src: 'https://cdn.example.com/a.png', assetId: 'asset-1', width: 240, height: 120 }),
  imageBlock({ src: null, assetId: 'asset-2', alignment: 'right', caption: 'A caption' }),
  textBlock('unstyled', 'Line one\nLine two'),
];

const everyMark: Block[] = [
  textBlock('unstyled', 'bold text', { styles: [{ start: 0, length: 4, style: 'BOLD' }] }),
  textBlock('unstyled', 'italic text', { styles: [{ start: 0, length: 6, style: 'ITALIC' }] }),
  textBlock('unstyled', 'struck text', { styles: [{ start: 0, length: 6, style: 'STRIKETHROUGH' }] }),
  textBlock('unstyled', 'see the docs', {
    styles: [{ start: 8, length: 4, style: 'LINK', link: 'https://docs.example.com/a_(b)?q=1' }],
  }),
  textBlock('unstyled', 'red word', { styles: [{ start: 0, length: 3, style: 'COLORED', color: 'block_red' }] }),
  textBlock('unstyled', 'green mark', {
    styles: [{ start: 0, length: 5, style: 'HIGHLIGHTED', color: 'pastel_green' }],
  }),
  textBlock('ul', 'nested bold and italic', {
    styles: [
      { start: 7, length: 15, style: 'BOLD' },
      { start: 16, length: 6, style: 'ITALIC' },
    ],
  }),
  textBlock('h2', 'link with bold inside', {
    styles: [
      { start: 0, length: 21, style: 'LINK', link: 'https://example.com' },
      { start: 10, length: 4, style: 'BOLD' },
    ],
  }),
  textBlock('unstyled', 'all at once', {
    styles: [
      { start: 0, length: 11, style: 'BOLD' },
      { start: 0, length: 11, style: 'ITALIC' },
      { start: 0, length: 11, style: 'STRIKETHROUGH' },
      { start: 0, length: 11, style: 'HIGHLIGHTED', color: 'pastel_blue' },
      { start: 4, length: 2, style: 'COLORED', color: 'block_purple' },
    ],
  }),
  textBlock('unstyled', 'Mention test @Ada Lovelace and @[seed] Atlas Ventures end', {
    mentions: [
      { type: 'member', start: 13, length: 13, id: 'member-1' },
      { type: 'record', start: 31, length: 22, id: 'record-1', entityDefinitionId: 'companies-def' },
    ],
    // Mentions carry no marks: a strike over the whole line skips them.
    styles: [
      { start: 0, length: 13, style: 'STRIKETHROUGH' },
      { start: 26, length: 5, style: 'STRIKETHROUGH' },
      { start: 53, length: 4, style: 'STRIKETHROUGH' },
    ],
  }),
];

describe('blocks ↔ ProseMirror ↔ Yjs', () => {
  it('round-trips every block type through the schema', () => {
    expect(viaPm(everyBlockType)).toEqual(everyBlockType);
  });

  it('round-trips every mark through the schema', () => {
    expect(viaPm(everyMark)).toEqual(everyMark);
  });

  it('round-trips every block type and mark through a Yjs state', () => {
    expect(viaYjs(everyBlockType)).toEqual(everyBlockType);
    expect(viaYjs(everyMark)).toEqual(everyMark);
  });

  it('keeps a mention as one atomic `@label` token', () => {
    const [block] = viaYjs([everyMark[9] as Block]);
    expect(block?.text.slice(13, 26)).toBe('@Ada Lovelace');
    expect(mentionsOf([block as Block])).toEqual([
      { type: 'member', id: 'member-1' },
      { type: 'record', id: 'record-1', entityDefinitionId: 'companies-def' },
    ]);
  });

  it('projects an empty state to no blocks', () => {
    expect(projectState(null)).toEqual({ blocks: [], markdown: '', plaintext: '', searchText: '' });
    expect(stateToBlocks(new Y.Doc() && Y.encodeStateAsUpdate(new Y.Doc()))).toEqual([]);
  });

  it('drops marks and nodes outside the model (pasted underline, unknown colours)', () => {
    const blocks = pmJsonToBlocks({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'under', marks: [{ type: 'underline' }] },
            { type: 'text', text: 'colour', marks: [{ type: 'textColor', attrs: { color: 'hotpink' } }] },
          ],
        },
      ],
    });
    expect(blocks).toEqual([textBlock('unstyled', 'undercolour')]);
  });

  it('replaces content as a diff that keeps concurrent edits', () => {
    const base = blocksToState([textBlock('unstyled', 'first'), textBlock('unstyled', 'second')]);
    const server = yDocFromState(base);
    const client = yDocFromState(base);
    // A client appends a block while the server replaces the first one.
    replaceYDocContent(client, [
      textBlock('unstyled', 'first'),
      textBlock('unstyled', 'second'),
      textBlock('ul', 'client item'),
    ]);
    replaceYDocContent(server, [textBlock('h1', 'Replaced'), textBlock('unstyled', 'second')]);
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client));
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    expect(yDocToBlocks(server)).toEqual(yDocToBlocks(client));
    expect(yDocToBlocks(server).map((b) => b.text)).toEqual(['Replaced', 'second', 'client item']);
  });
});

describe('blocks ↔ markdown', () => {
  it('round-trips every block type (images omitted)', () => {
    expect(viaMarkdown(everyBlockType)).toEqual(markdownSubset(everyBlockType));
  });

  it('round-trips every mark markdown can express (colours and mentions dropped)', () => {
    expect(viaMarkdown(everyMark)).toEqual(markdownSubset(everyMark));
  });

  it("matches Attio's public markdown mapping", () => {
    const blocks: Block[] = [
      textBlock('h1', 'Title'),
      textBlock('unstyled', 'alpha beta gamma delta', {
        styles: [
          { start: 0, length: 5, style: 'BOLD' },
          { start: 6, length: 4, style: 'ITALIC' },
          { start: 11, length: 5, style: 'COLORED', color: 'block_red' },
          { start: 17, length: 5, style: 'HIGHLIGHTED', color: 'pastel_green' },
        ],
      }),
      textBlock('ul', 'level0'),
      textBlock('ul', 'level1', { indent: 1 }),
      textBlock('ol', 'one'),
      textBlock('ol', 'two'),
      imageBlock({ src: 'https://x/y.png' }),
      textBlock('unstyled', 'Owner @Ilya Berdysh', { mentions: [{ type: 'member', start: 6, length: 13, id: 'm' }] }),
    ];
    expect(blocksToMarkdown(blocks)).toBe(
      [
        '# Title',
        '**alpha** *beta* gamma ==delta==',
        '- level0',
        '  - level1',
        '1. one',
        '2. two',
        'Owner @Ilya Berdysh',
      ].join('\n'),
    );
    expect(blocksToPlaintext(blocks).split('\n')[6]).toBe('');
  });

  it('keeps unsupported markdown literal', () => {
    const blocks = markdownToBlocks(
      ['> Next review in two weeks.', '`code`', '1) not a list', '#### Deep heading', '---', '[ ] task'].join('\n'),
    );
    expect(blocks.map((b) => [b.type, b.text])).toEqual([
      ['unstyled', '> Next review in two weeks.'],
      ['unstyled', '`code`'],
      ['unstyled', '1) not a list'],
      ['unstyled', '#### Deep heading'],
      ['unstyled', '---'],
      ['unstyled', '[ ] task'],
    ]);
  });

  it('parses API markdown input: lists by 2 or 4 spaces, __bold__, _italic_, links with titles', () => {
    const blocks = markdownToBlocks(
      [
        '## Agenda',
        '* Introductions',
        '    + Current __tooling__',
        '',
        '1. Owner _today_',
        'A [link](https://a.example "Title") and snake_case_word',
      ].join('\n'),
    );
    expect(blocks).toEqual([
      textBlock('h2', 'Agenda'),
      textBlock('ul', 'Introductions'),
      textBlock('ul', 'Current tooling', { indent: 1, styles: [{ start: 8, length: 7, style: 'BOLD' }] }),
      textBlock('ol', 'Owner today', { styles: [{ start: 6, length: 5, style: 'ITALIC' }] }),
      textBlock('unstyled', 'A link and snake_case_word', {
        styles: [{ start: 2, length: 4, style: 'LINK', link: 'https://a.example' }],
      }),
    ]);
  });

  it('escapes markdown-significant text so it survives a round trip', () => {
    const tricky: Block[] = [
      textBlock('unstyled', '# not a heading'),
      textBlock('unstyled', '- not a list'),
      textBlock('unstyled', '12. not numbered'),
      textBlock('unstyled', 'a*b*c **d** __e__ _f_ ~~g~~ ==h== [i](j) back\\slash'),
      textBlock('ul', '[seed] Atlas Ventures'),
      textBlock('unstyled', 'ends with a break\n'),
      textBlock('unstyled', 'after'),
    ];
    expect(viaMarkdown(tricky)).toEqual(tricky);
  });

  it('serialises overlapping styles so they parse back', () => {
    const overlapping = [
      textBlock('unstyled', 'abc', {
        styles: [
          { start: 0, length: 2, style: 'BOLD' },
          { start: 1, length: 2, style: 'ITALIC' },
        ],
      }),
      textBlock('unstyled', 'abcd', {
        styles: [
          { start: 0, length: 2, style: 'BOLD' },
          { start: 0, length: 1, style: 'ITALIC' },
          { start: 2, length: 2, style: 'STRIKETHROUGH' },
        ],
      }),
    ];
    expect(viaMarkdown(overlapping)).toEqual(overlapping);
  });

  it('parses nested emphasis runs', () => {
    expect(parseInlineMarkdown('***both*** and **b *i* b**')).toEqual({
      text: 'both and b i b',
      styles: [
        { start: 0, length: 4, style: 'BOLD' },
        { start: 0, length: 4, style: 'ITALIC' },
        { start: 9, length: 5, style: 'BOLD' },
        { start: 11, length: 1, style: 'ITALIC' },
      ],
    });
    expect(parseInlineMarkdown('2 * 3 * 4 and ** lonely').text).toBe('2 * 3 * 4 and ** lonely');
  });
});

describe('list numbering and presence colours', () => {
  it('numbers runs of numbered items per depth', () => {
    const items = [
      { type: 'ol', indent: 0 },
      { type: 'ol', indent: 1 },
      { type: 'ol', indent: 1 },
      { type: 'ol', indent: 0 },
      { type: 'ul', indent: 0 },
      { type: 'ol', indent: 0 },
      { type: 'unstyled', indent: 0 },
      { type: 'ol', indent: 0 },
    ];
    expect(listNumbers(items)).toEqual([1, 1, 2, 2, null, 1, null, 1]);
  });

  it('derives the presence colour from the member id (XOR of char codes mod 8)', () => {
    expect(presenceColor('a')).toBe('#00D17E'); // 97 % 8 = 1 → green
    expect(presenceColor('')).toBe('#266DF0'); // blue
  });
});

describe('placeholder variables (B.11)', () => {
  const block: Block = {
    ...textBlock('unstyled', 'Hi _, welcome to _!'),
    styles: [{ start: 0, length: 2, style: 'BOLD' }],
    variables: [
      {
        start: 3,
        length: 1,
        path: [{ entityDefinitionId: 'people', attributeDefinitionId: 'name' }],
        field: 'first_name',
        fallback: 'there',
        label: 'Name › First',
      },
      {
        start: 17,
        length: 1,
        path: [
          { entityDefinitionId: 'people', attributeDefinitionId: 'company' },
          { entityDefinitionId: 'companies', attributeDefinitionId: 'name' },
        ],
        field: null,
        fallback: null,
      },
    ],
  };

  it('round-trips through ProseMirror JSON and Yjs state', () => {
    expect(pmJsonToBlocks(blocksToPmJson([block]))).toEqual([block]);
    expect(stateToBlocks(blocksToState([block]))).toEqual([block]);
  });

  it('drops variables that do not sit on a placeholder character', () => {
    const variable = block.variables?.[0];
    if (!variable) throw new Error('fixture');
    const stray: Block = { ...textBlock('unstyled', 'abc'), variables: [{ ...variable, start: 1 }] };
    expect(pmJsonToBlocks(blocksToPmJson([stray]))).toEqual([textBlock('unstyled', 'abc')]);
  });
});
