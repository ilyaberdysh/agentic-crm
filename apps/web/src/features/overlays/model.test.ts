import { describe, expect, it, vi } from 'vitest';
import {
  closeEntry,
  detachWindow,
  EMPTY_OVERLAYS,
  expandWindow,
  type OverlayEntry,
  type OverlayState,
  openEntry,
  parseOverlaySearch,
  reconcile,
  sequencePosition,
  stepRecord,
  topOf,
  withOverlayParams,
} from './model';
import { OverlayStore } from './store';

const rec = (id: string, def = 'def-1') => ({ entityDefinitionId: def, entityInstanceId: id });
const note = (id: string): OverlayEntry => ({ type: 'window', kind: 'note', id });
const record = (id: string): OverlayEntry => ({ type: 'record', record: rec(id) });

describe('overlay URL params', () => {
  it('parses note, template, record and task overlays', () => {
    expect(parseOverlaySearch({ modal: 'note', id: 'n1' })).toEqual(note('n1'));
    expect(parseOverlaySearch({ modal: 'note-template', id: 't1' })).toEqual({
      type: 'window',
      kind: 'note-template',
      id: 't1',
    });
    expect(parseOverlaySearch({ modal: 'record', id: 'r1', object: 'def-1' })).toEqual(record('r1'));
    expect(parseOverlaySearch({ 'command-menu-page': 'task', id: 'k1' })).toEqual({ type: 'task', id: 'k1' });
  });

  it('ignores incomplete or unknown params', () => {
    expect(parseOverlaySearch({})).toBeNull();
    expect(parseOverlaySearch({ modal: 'note' })).toBeNull();
    expect(parseOverlaySearch({ modal: 'record', id: 'r1' })).toBeNull();
    expect(parseOverlaySearch({ modal: 'unknown', id: 'x' })).toBeNull();
    expect(parseOverlaySearch({ modal: 'note', id: 42 })).toBeNull();
  });

  it('rewrites only its own params and keeps the others', () => {
    expect(withOverlayParams('?sort=asc', note('n1'))).toBe('?sort=asc&modal=note&id=n1');
    expect(withOverlayParams('?sort=asc&modal=note&id=n1', null)).toBe('?sort=asc');
    expect(withOverlayParams('modal=note&id=n1', record('r1'))).toBe('?modal=record&id=r1&object=def-1');
    expect(withOverlayParams('', { type: 'task', id: 'k1' })).toBe('?command-menu-page=task&id=k1');
    expect(withOverlayParams('', null)).toBe('');
  });
});

describe('overlay stack', () => {
  it('pushes a note above a record overlay and closes back to it', () => {
    let s = openEntry(EMPTY_OVERLAYS, record('r1'));
    s = openEntry(s, note('n1'));
    expect(s.stack).toEqual([record('r1'), note('n1')]);
    s = closeEntry(s, note('n1'));
    expect(topOf(s)).toEqual(record('r1'));
  });

  it('Back to a lower layer truncates the stack; an empty URL closes everything', () => {
    let s = openEntry(openEntry(EMPTY_OVERLAYS, record('r1')), note('n1'));
    s = reconcile(s, record('r1'));
    expect(s.stack).toEqual([record('r1')]);
    expect(reconcile(s, null).stack).toEqual([]);
  });

  it('keeps one layer per type: a second note replaces the first', () => {
    let s = openEntry(EMPTY_OVERLAYS, record('r1'));
    s = openEntry(s, note('n1'));
    s = openEntry(s, note('n2'));
    expect(s.stack).toEqual([record('r1'), note('n2')]);
  });

  it('reconciling the current top is a no-op (same object)', () => {
    const s = openEntry(EMPTY_OVERLAYS, note('n1'));
    expect(reconcile(s, note('n1'))).toBe(s);
  });

  it('a record from the URL matches by instance id even when the object is a slug', () => {
    const s = openEntry(EMPTY_OVERLAYS, { type: 'record', record: rec('r1', 'uuid-of-projects') });
    expect(reconcile(s, { type: 'record', record: rec('r1', 'projects') })).toBe(s);
  });
});

describe('detached windows', () => {
  it('minimise takes the modal off the stack and adds a dock bubble', () => {
    let s: OverlayState = openEntry(EMPTY_OVERLAYS, note('n1'));
    s = detachWindow(s, 'note', 'n1', 'minimized');
    expect(s.stack).toEqual([]);
    expect(s.detached).toEqual([{ kind: 'note', id: 'n1', mode: 'minimized' }]);
  });

  it('one floating panel at a time; bubbles keep their order', () => {
    let s = detachWindow(EMPTY_OVERLAYS, 'note', 'a', 'minimized');
    s = detachWindow(s, 'note', 'b', 'minimized');
    s = detachWindow(s, 'note', 'a', 'floating');
    expect(s.detached.map((w) => `${w.id}:${w.mode}`)).toEqual(['a:floating', 'b:minimized']);
    s = detachWindow(s, 'note', 'b', 'floating');
    expect(s.detached.map((w) => `${w.id}:${w.mode}`)).toEqual(['a:minimized', 'b:floating']);
  });

  it('expand moves a detached window back to the modal layer', () => {
    let s = detachWindow(EMPTY_OVERLAYS, 'note', 'a', 'floating');
    s = expandWindow(s, 'note', 'a');
    expect(s.detached).toEqual([]);
    expect(topOf(s)).toEqual(note('a'));
  });

  it('opening a detached note from the URL removes its bubble', () => {
    const s = reconcile(detachWindow(EMPTY_OVERLAYS, 'note', 'a', 'minimized'), note('a'));
    expect(s.detached).toEqual([]);
    expect(s.stack).toEqual([note('a')]);
  });

  it('closing a detached window forgets it', () => {
    const s = closeEntry(detachWindow(EMPTY_OVERLAYS, 'note', 'a', 'floating'), note('a'));
    expect(s).toEqual(EMPTY_OVERLAYS);
  });
});

describe('record sequence (K / J)', () => {
  const sequence = { label: 'All projects', records: [rec('a'), rec('b'), rec('c')] };

  it('reports the position and neighbours', () => {
    expect(sequencePosition(sequence, rec('a'))).toMatchObject({ index: 0, total: 3, previous: null, next: rec('b') });
    expect(sequencePosition(sequence, rec('c'))).toMatchObject({ index: 2, previous: rec('b'), next: null });
    expect(sequencePosition(sequence, rec('z'))).toBeNull();
    expect(sequencePosition(undefined, rec('a'))).toBeNull();
  });

  it('steps keep the sequence and drop layers above the record', () => {
    let s = openEntry(EMPTY_OVERLAYS, { type: 'record', record: rec('a'), sequence });
    s = openEntry(s, note('n1'));
    s = stepRecord(s, rec('b'));
    expect(s.stack).toEqual([{ type: 'record', record: rec('b'), sequence }]);
  });
});

describe('OverlayStore', () => {
  it('pushes the URL on open and replaces it on close / minimise', () => {
    const store = new OverlayStore(EMPTY_OVERLAYS);
    const nav = vi.fn();
    store.setNavigator(nav);
    store.open(note('n1'));
    expect(nav).toHaveBeenLastCalledWith(note('n1'), { replace: false });
    store.detach('note', 'n1', 'minimized');
    expect(nav).toHaveBeenLastCalledWith(null, { replace: true });
    store.expand('note', 'n1');
    expect(nav).toHaveBeenLastCalledWith(note('n1'), { replace: false });
    store.close(note('n1'));
    expect(nav).toHaveBeenLastCalledWith(null, { replace: true });
    expect(nav).toHaveBeenCalledTimes(4);
  });

  it('does not navigate when the URL is the source of the change, or the top is unchanged', () => {
    const store = new OverlayStore(EMPTY_OVERLAYS);
    const nav = vi.fn();
    store.setNavigator(nav);
    store.syncFromUrl(note('n1'));
    store.open(note('n1'));
    store.detach('note', 'other', 'floating');
    expect(nav).not.toHaveBeenCalled();
    expect(store.getState().stack).toEqual([note('n1')]);
  });

  it('notifies subscribers', () => {
    const store = new OverlayStore(EMPTY_OVERLAYS);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.open(record('r1'));
    store.stepRecord(rec('r2'));
    off();
    store.closeTop();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
