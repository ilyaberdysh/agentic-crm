// The shortcut engine (B-shell): combinations (`mod+.`) and key sequences separated by a space
// (`g h` = G, then H within ~1 s). Shortcuts do not fire while typing in a field or inside a dialog / menu / listbox
// unless that container has `data-allow-global-shortcuts`. When several components bind the same keys, the most
// recently mounted binding wins; a longer sequence beats a shorter one that ends the same way (`g t` over `t`).
//
// This is the one registry: every feature binds through `useShortcut` (or `useAction`, which looks the keys up in the
// catalog of features/shortcuts), the registry knows every live binding (`registered`), and the help drawer's
// Shortcuts view lists them all — the catalog supplies descriptions, anything registered without an entry is
// listed under "Other".
import { useEffect, useRef, useSyncExternalStore } from 'react';

export const SEQUENCE_WINDOW_MS = 1000;

type Handler = (event: KeyboardEvent) => void;

export interface ShortcutMeta {
  /** Catalog id (features/shortcuts/catalog) when the binding was made through `useAction`. */
  id?: string;
  /** Overrides the catalog description for this binding (page-local actions). */
  description?: string;
}

interface Binding {
  id: number;
  shortcut: string;
  steps: string[][];
  handler: Handler;
  meta: ShortcutMeta;
}

export interface RegisteredShortcut {
  /** Canonical form (`g h`, `mod+k`, `alt+right`): lower case, aliases folded, modifiers sorted. */
  shortcut: string;
  meta: ShortcutMeta;
}

const isApple = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  escape: 'esc',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  return: 'enter',
  option: 'alt',
  cmd: 'meta',
};

/** Canonical key name: lower case, aliases folded (`ArrowRight` → `right`, `Escape` → `esc`). */
export function normaliseKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/** `mod+shift+k` → ['meta','shift','k'] (on Apple) — modifiers sorted, key last, lower-cased. */
export function parseCombo(combo: string, apple = isApple()): string[] {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p === 'mod' ? (apple ? 'meta' : 'ctrl') : normaliseKey(p)));
  const key = parts.pop() ?? '';
  return [...parts.sort(), key];
}

/** The normalised combo of a keyboard event, e.g. ['meta', '.']. */
export function eventCombo(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>) {
  const mods: string[] = [];
  if (event.altKey) mods.push('alt');
  if (event.ctrlKey) mods.push('ctrl');
  if (event.metaKey) mods.push('meta');
  const key = normaliseKey(event.key);
  // Shift is implied by the produced character for symbols ("?"); keep it only for letters and named keys.
  if (event.shiftKey && (key.length > 1 || /[a-z]/.test(key))) mods.push('shift');
  return [...mods.sort(), key];
}

/**
 * One comparable form of a shortcut string: lower case, key aliases folded, modifiers sorted before the key
 * (`Shift+Mod+ArrowUp` → `mod+shift+up`); steps keep their order (`g h`).
 */
export function canonicalShortcut(shortcut: string): string {
  return shortcut
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((step) => {
      const parts = step
        .split('+')
        .map((p) => p.trim())
        .filter(Boolean)
        .map(normaliseKey);
      const key = parts.pop() ?? '';
      return [...parts.sort(), key].join('+');
    })
    .join(' ');
}

function sameCombo(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const BLOCKING_ROLES = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';

export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  const blocking = target.closest(BLOCKING_ROLES);
  return Boolean(blocking && !blocking.closest('[data-allow-global-shortcuts]'));
}

function pruned(meta: ShortcutMeta): ShortcutMeta {
  const out: ShortcutMeta = {};
  if (meta.id) out.id = meta.id;
  if (meta.description) out.description = meta.description;
  return out;
}

export class ShortcutRegistry {
  private bindings: Binding[] = [];
  private nextId = 1;
  private buffer: string[][] = [];
  private bufferAt = 0;
  private paused = 0;
  private listeners = new Set<() => void>();
  private snapshot: RegisteredShortcut[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  bind(shortcut: string, handler: Handler, meta: ShortcutMeta = {}): () => void {
    const binding: Binding = {
      id: this.nextId++,
      shortcut,
      steps: shortcut
        .split(' ')
        .filter(Boolean)
        .map((s) => parseCombo(s)),
      handler,
      meta,
    };
    this.bindings.push(binding);
    this.changed();
    return () => {
      this.bindings = this.bindings.filter((b) => b.id !== binding.id);
      this.changed();
    };
  }

  private changed(): void {
    this.snapshot = this.compute();
    for (const l of this.listeners) l();
  }

  private compute(): RegisteredShortcut[] {
    const latest = new Map<string, RegisteredShortcut>();
    for (const b of this.bindings) {
      const shortcut = canonicalShortcut(b.shortcut);
      // The most recent binding of a shortcut supplies the metadata; its position is that of the first one.
      const prev = latest.get(shortcut);
      latest.set(shortcut, { shortcut, meta: { ...prev?.meta, ...pruned(b.meta) } });
    }
    return [...latest.values()];
  }

  /** Distinct live bindings (the most recent binding of a shortcut supplies the metadata). Stable between changes. */
  registered = (): RegisteredShortcut[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Suspends every global shortcut while the returned function has not been called (counter-based). */
  pause(): () => void {
    this.paused += 1;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.paused -= 1;
    };
  }

  /** Returns true when a binding handled the event. */
  handle(event: KeyboardEvent): boolean {
    if (this.paused > 0 || event.isComposing || event.repeat) return false;
    const combo = eventCombo(event);
    const lastKey = combo[combo.length - 1] ?? '';
    if (['meta', 'control', 'ctrl', 'alt', 'shift'].includes(lastKey)) return false;
    // Combinations with ⌘/Ctrl work from fields too (e.g. ⌘. while typing); plain keys never do.
    const hasCommandModifier = combo.includes('meta') || combo.includes('ctrl');
    if (isTypingTarget(event.target) && !hasCommandModifier) {
      this.buffer = [];
      return false;
    }

    const t = this.now();
    if (t - this.bufferAt > SEQUENCE_WINDOW_MS) this.buffer = [];
    this.buffer.push(combo);
    this.bufferAt = t;

    // Full sequence match on the tail of the buffer: the longest sequence wins (`g t` beats a plain `t`), then the
    // most recently bound.
    let match: Binding | null = null;
    for (let i = this.bindings.length - 1; i >= 0; i--) {
      const b = this.bindings[i] as Binding;
      const n = b.steps.length;
      if (n > this.buffer.length || (match && match.steps.length >= n)) continue;
      const tail = this.buffer.slice(-n);
      if (tail.every((c, j) => sameCombo(c, b.steps[j] as string[]))) match = b;
    }
    if (match) {
      this.buffer = [];
      event.preventDefault();
      match.handler(event);
      return true;
    }
    // Keep the buffer only while it is the start of some sequence (else restart from this key).
    if (!isPrefixOfAny(this.bindings, this.buffer)) {
      this.buffer = isPrefixOfAny(this.bindings, [combo]) ? [combo] : [];
    }
    return false;
  }
}

function isPrefixOfAny(bindings: Binding[], buffer: string[][]): boolean {
  return bindings.some(
    (b) => b.steps.length > buffer.length && buffer.every((c, j) => sameCombo(c, b.steps[j] as string[])),
  );
}

export const shortcuts = new ShortcutRegistry();

let installed = false;
function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', (event) => {
    shortcuts.handle(event);
  });
  // Dev builds: the registry on window for e2e and manual checks.
  if (import.meta.env.DEV) {
    (window as unknown as { __shortcuts: unknown }).__shortcuts = {
      registered: () => shortcuts.registered().map((r) => r.shortcut),
      canonical: canonicalShortcut,
    };
  }
}

/** Binds a global shortcut while the component is mounted. The handler may change between renders. */
export function useShortcut(shortcut: string | null, handler: Handler, meta?: ShortcutMeta): void {
  const ref = useRef(handler);
  ref.current = handler;
  const description = meta?.description;
  const id = meta?.id;
  useEffect(() => {
    if (!shortcut) return;
    install();
    return shortcuts.bind(shortcut, (e) => ref.current(e), { id, description });
  }, [shortcut, id, description]);
}

/** Suspends every global shortcut while `active` (counter-based, e.g. while a key-capturing control is focused). */
export function useShortcutsPaused(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return shortcuts.pause();
  }, [active]);
}

/** Every live binding; re-renders when one is added or removed. */
export function useRegisteredShortcuts(): RegisteredShortcut[] {
  return useSyncExternalStore(shortcuts.subscribe, shortcuts.registered, shortcuts.registered);
}

/** The key groups of a shortcut for caps: `g h` → [['g'], ['h']]; `mod+k` → [['mod', 'k']]. */
export function shortcutKeys(shortcut: string): string[][] {
  return shortcut
    .split(' ')
    .filter(Boolean)
    .map((step) => step.split('+'));
}
