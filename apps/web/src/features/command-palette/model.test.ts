import type { SearchRecordHit } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import type { ObjectSummary } from '../../data/objects';
import type { Favorite } from '../favorites/data';
import type { List } from '../lists/data';
import type { PaletteAction } from './contexts';
import { buildRootRows, jumpToRows, type RootSources, searchTermOf } from './model';

const action = (id: string, title: string, extra: Partial<PaletteAction> = {}): PaletteAction => ({
  id,
  title,
  icon: 'search',
  gesture: 'Open',
  run: () => {},
  ...extra,
});

const object = (id: string, plural: string, singular: string): ObjectSummary =>
  ({ id, pluralNoun: plural, singularNoun: singular, entityType: 'custom-record' }) as ObjectSummary;
const list = (id: string, name: string): List => ({ id, name }) as List;
const favorite = (id: string, label: string, favoriteType: Favorite['favoriteType'] = 'record'): Favorite =>
  ({ id, favoriteType, target: { state: 'ok', label, secondaryLabel: null } }) as unknown as Favorite;
const hit = (id: string): SearchRecordHit => ({ entityInstanceId: id, entityDefinitionId: 'o' }) as SearchRecordHit;

const base: RootSources = {
  query: '',
  favorites: [],
  objects: [object('o1', '[seed] Projects', '[seed] Project'), object('o2', 'Companies', 'Company')],
  lists: [list('l1', '[seed] Project pipeline')],
  contexts: [],
  quick: [
    action('create-task', 'Create task', { hint: 't' }),
    action('theme', 'Use dark theme', { searchOnly: true }),
    action('search-records', 'Search records'),
  ],
  help: [action('help', 'Open help drawer')],
  hits: null,
};

describe('palette rows', () => {
  it('the empty state lists the default actions only, under Quick Action then Help (no Jump To, no Search)', () => {
    const rows = buildRootRows(base);
    expect(rows.map((r) => [r.section, r.key])).toEqual([
      ['Quick Action', 'action:ws:create-task'],
      ['Quick Action', 'action:ws:search-records'],
      ['Help', 'action:ws:help'],
    ]);
  });

  it('a query adds Jump To (objects before lists), matching actions and the Create row', () => {
    const rows = buildRootRows({ ...base, query: 'seed' });
    expect(rows.map((r) => r.key)).toEqual(['jump:object:o1', 'jump:list:l1', 'create-record']);
    expect(rows[0]?.section).toBe('Jump To');
  });

  it('search-only actions show up when they match', () => {
    const rows = buildRootRows({ ...base, query: 'dark' });
    expect(rows.map((r) => r.key)).toContain('action:ws:theme');
  });

  it('Jump To takes at most three, favorites first, skipping reports', () => {
    const favorites = [
      favorite('f1', '[seed] Atlas deal'),
      favorite('f2', '[seed] Report', 'reporting-dashboard'),
      favorite('f3', '[seed] Wade'),
    ];
    const rows = jumpToRows({ ...base, favorites, query: 'seed' });
    expect(rows.map((r) => r.key)).toEqual(['jump:fav:f1', 'jump:fav:f3', 'jump:object:o1']);
  });

  it('the Search section: record rows, then See more beyond five hits, else Search for…, always Create last', () => {
    const few = buildRootRows({ ...base, query: 'wade', hits: [hit('a'), hit('b')] });
    expect(few.map((r) => r.key).slice(-4)).toEqual(['record:a', 'record:b', 'search-in', 'create-record']);
    const many = buildRootRows({ ...base, query: 'wade', hits: ['a', 'b', 'c', 'd', 'e', 'f'].map(hit) });
    expect(many.map((r) => r.key).slice(-2)).toEqual(['more', 'create-record']);
    const none = buildRootRows({ ...base, query: 'zzzz-no-match', hits: [] });
    expect(none.map((r) => r.key)).toEqual(['create-record']);
  });

  it('context actions come first, in a section named after the context', () => {
    const rows = buildRootRows({
      ...base,
      contexts: [{ id: 'record-page', title: 'Acme', actions: [action('add-to-list', 'Add to list')] }],
    });
    expect(rows[0]).toMatchObject({ section: 'Acme', key: 'action:record-page:add-to-list' });
  });
});

describe('searchTermOf', () => {
  it('reduces URLs to their hostname and leaves other text alone', () => {
    expect(searchTermOf('https://www.northwind.example.com/pricing')).toBe('northwind.example.com');
    expect(searchTermOf('www.acme.io')).toBe('acme.io');
    expect(searchTermOf('jane cooper')).toBe('jane cooper');
  });
});
