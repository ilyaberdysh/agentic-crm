import { describe, expect, it } from 'vitest';
import { describeOutcome, duplicateMessage, invalidNotice, isEmailLike, splitTokens } from './tokens';

describe('splitTokens', () => {
  it('splits on commas, semicolons, spaces and line breaks', () => {
    expect(splitTokens('a.com, b@c.com d.io;e.org\nf.net')).toEqual(['a.com', 'b@c.com', 'd.io', 'e.org', 'f.net']);
  });

  it('drops empties and repeats (case-insensitive) and keeps the first spelling', () => {
    expect(splitTokens(' ,, A.com  a.COM ,b.com,, ')).toEqual(['A.com', 'b.com']);
    expect(splitTokens('')).toEqual([]);
    expect(splitTokens('   \n ')).toEqual([]);
  });
});

describe('duplicateMessage', () => {
  it('names addresses, domains or entries and agrees in number', () => {
    expect(duplicateMessage([])).toBeNull();
    expect(duplicateMessage(['a@b.com'])).toBe('1 duplicate email address was not added');
    expect(duplicateMessage(['a@b.com', 'c@d.com'])).toBe('2 duplicate email addresses were not added');
    expect(duplicateMessage(['b.com'])).toBe('1 duplicate domain was not added');
    expect(duplicateMessage(['b.com', 'd.org', 'e.io'])).toBe('3 duplicate domains were not added');
    expect(duplicateMessage(['b.com', 'a@d.org'])).toBe('2 duplicate entries were not added');
  });
});

describe('describeOutcome', () => {
  it('closes when everything was added', () => {
    const view = describeOutcome({ added: [{}, {}], duplicates: [], invalid: [] });
    expect(view.shouldClose).toBe(true);
    expect(view.leftoverNotice).toBeNull();
    expect(view.remaining).toBe('');
  });

  it('stays open and keeps the flagged tokens when nothing was added', () => {
    const view = describeOutcome({ added: [], duplicates: ['a.com'], invalid: ['not valid!'] });
    expect(view.shouldClose).toBe(false);
    expect(view.invalid).toEqual(['not valid!']);
    expect(view.duplicateMessage).toBe('1 duplicate domain was not added');
    expect(view.remaining).toBe('not valid! a.com');
    expect(view.leftoverNotice).toBeNull();
  });

  it('closes when something was added, and reports the leftovers once', () => {
    const view = describeOutcome({ added: [{}], duplicates: ['x@y.com'], invalid: ['bad', 'worse'] });
    expect(view.shouldClose).toBe(true);
    expect(view.leftoverNotice).toBe('2 invalid entries were not added. 1 duplicate email address was not added');
  });

  it('closes on an empty, harmless answer', () => {
    expect(describeOutcome({ added: [], duplicates: [], invalid: [] }).shouldClose).toBe(true);
  });
});

describe('small helpers', () => {
  it('tells addresses from domains', () => {
    expect(isEmailLike('a@b.com')).toBe(true);
    expect(isEmailLike('b.com')).toBe(false);
  });

  it('words the invalid count', () => {
    expect(invalidNotice(0)).toBeNull();
    expect(invalidNotice(1)).toBe('1 invalid entry was not added');
    expect(invalidNotice(2)).toBe('2 invalid entries were not added');
  });
});
