import { describe, expect, it } from 'vitest';
import { safeOrigin } from './origin';
import { eventCombo, parseCombo, ShortcutRegistry } from './shortcuts';
import { isValidSlug, kebabCase } from './slug';

describe('slug', () => {
  it('kebab-cases company names for handle fields', () => {
    expect(kebabCase('Acme, Inc.')).toBe('acme-inc');
    expect(kebabCase('  Mymeet AI  ')).toBe('mymeet-ai');
    expect(kebabCase('Café Zürich')).toBe('cafe-zurich');
    expect(kebabCase('---')).toBe('');
    expect(kebabCase('a'.repeat(80))).toHaveLength(64);
  });

  it('validates handles', () => {
    expect(isValidSlug('my-workspace')).toBe(true);
    expect(isValidSlug('My-Workspace')).toBe(false);
    expect(isValidSlug('double--hyphen')).toBe(false);
    expect(isValidSlug('-leading')).toBe(false);
    expect(isValidSlug('')).toBe(false);
  });
});

describe('safeOrigin', () => {
  it('only honours same-origin paths', () => {
    expect(safeOrigin('/mymeet/home')).toBe('/mymeet/home');
    expect(safeOrigin('/auth/join/acme?invite=1')).toBe('/auth/join/acme?invite=1');
    expect(safeOrigin('//evil.com')).toBeNull();
    expect(safeOrigin('https://evil.com')).toBeNull();
    expect(safeOrigin('/auth/sign-in?origin=x')).toBeNull();
    expect(safeOrigin(undefined)).toBeNull();
  });
});

describe('shortcuts', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
    ({
      key: k,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
      repeat: false,
      target: null,
      preventDefault() {},
      ...mods,
    }) as unknown as KeyboardEvent;

  it('normalises combos', () => {
    expect(parseCombo('mod+.', true)).toEqual(['meta', '.']);
    expect(parseCombo('mod+.', false)).toEqual(['ctrl', '.']);
    expect(eventCombo(key('.', { metaKey: true }))).toEqual(['meta', '.']);
    expect(eventCombo(key('?', { shiftKey: true }))).toEqual(['?']);
  });

  it('fires sequences within the window, most recent binding wins', () => {
    let now = 0;
    const registry = new ShortcutRegistry(() => now);
    const calls: string[] = [];
    registry.bind('g h', () => calls.push('home'));
    const unbind = registry.bind('g h', () => calls.push('home-2'));
    registry.bind('g t', () => calls.push('tasks'));

    registry.handle(key('g'));
    now += 800;
    registry.handle(key('h'));
    expect(calls).toEqual(['home-2']);

    unbind();
    registry.handle(key('g'));
    now += 300;
    registry.handle(key('h'));
    expect(calls).toEqual(['home-2', 'home']);

    // Too slow: G → (1.3 s) → T does nothing.
    registry.handle(key('g'));
    now += 1300;
    registry.handle(key('t'));
    expect(calls).toEqual(['home-2', 'home']);
  });

  it('a sequence beats a single key bound later (`g t` vs the new-task `t`)', () => {
    let now = 0;
    const registry = new ShortcutRegistry(() => now);
    const calls: string[] = [];
    registry.bind('g t', () => calls.push('go-tasks'));
    registry.bind('t', () => calls.push('new-task'));
    registry.handle(key('g'));
    now += 200;
    registry.handle(key('t'));
    now += 2000;
    registry.handle(key('t'));
    expect(calls).toEqual(['go-tasks', 'new-task']);
  });

  it('pauses while a pause handle is held', () => {
    const registry = new ShortcutRegistry();
    let n = 0;
    registry.bind('t', () => n++);
    const resume = registry.pause();
    registry.handle(key('t'));
    resume();
    registry.handle(key('t'));
    expect(n).toBe(1);
  });
});
