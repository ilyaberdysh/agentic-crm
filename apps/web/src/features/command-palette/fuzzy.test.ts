import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('ranks exact > prefix > word prefix > substring', () => {
    const exact = fuzzyScore('tasks', 'Tasks') as number;
    const prefix = fuzzyScore('task', 'Tasks') as number;
    const word = fuzzyScore('pipeline', '[seed] Project pipeline') as number;
    const sub = fuzzyScore('ipeline', '[seed] Project pipeline') as number;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
  });

  it('is case insensitive and matches every word in any order', () => {
    expect(fuzzyScore('SEED proj', '[seed] Project pipeline')).not.toBeNull();
    expect(fuzzyScore('pipeline seed', '[seed] Project pipeline')).not.toBeNull();
  });

  it('matches ordered letters for longer queries and rejects the rest', () => {
    expect(fuzzyScore('prjct', 'Project')).not.toBeNull();
    expect(fuzzyScore('xyz', 'Project')).toBeNull();
    // Two letters never match loosely.
    expect(fuzzyScore('pt', 'Project')).toBeNull();
  });

  it('an empty query matches everything with score 0', () => {
    expect(fuzzyScore('  ', 'anything')).toBe(0);
  });
});

describe('fuzzyFilter', () => {
  const items = [
    { title: 'Create task', keywords: ['todo', 'new'] },
    { title: 'Create note', keywords: ['write'] },
    { title: 'Use dark theme', keywords: ['appearance', 'night'] },
  ];
  const fields = (i: (typeof items)[number]) => i;

  it('keeps the source order for equal scores and finds keyword matches', () => {
    expect(fuzzyFilter(items, 'create', fields).map((r) => r.item.title)).toEqual(['Create task', 'Create note']);
    expect(fuzzyFilter(items, 'night', fields).map((r) => r.item.title)).toEqual(['Use dark theme']);
  });

  it('ranks a title match above a keyword match', () => {
    const list = [
      { title: 'Search records', keywords: ['find'] },
      { title: 'Find people', keywords: [] },
    ];
    expect(fuzzyFilter(list, 'find', (i) => i).map((r) => r.item.title)).toEqual(['Find people', 'Search records']);
  });
});
