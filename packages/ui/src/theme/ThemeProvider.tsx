import { MotionConfig } from 'motion/react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AccentColor, SurfaceMode, ThemeIdentity, ThemePreference } from '../tokens';
import { accentColors } from '../tokens/theme.gen';
import { cx } from '../utils/cx';
import './fonts';
import { layerRoot, noTransitionsCss, themeRoot } from './global.css';
import { accentClass, elevatedClass, identityClass } from './themes.css';

export interface ThemeState {
  identity: ThemeIdentity;
  accent: AccentColor;
  surfaceMode: SurfaceMode;
}

interface ThemeContextValue extends ThemeState {
  settings: ThemeSettings | null;
}

export interface ThemeSettings {
  /** The stored preference (`system` follows `prefers-color-scheme`). */
  theme: ThemePreference;
  accent: AccentColor;
  setTheme: (theme: ThemePreference) => void;
  setAccent: (accent: AccentColor) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DEFAULT_STATE: ThemeState = { identity: 'light', accent: 'blue', surfaceMode: 'base' };

/** Storage keys for the device-local Appearance setting (system-ui §8). */
export const THEME_STORAGE_KEY = 'ar:preferred-theme';
export const ACCENT_STORAGE_KEY = 'ar:theme-accent-color';

/** The full class list for a theme triple; apply it to any element to re-theme its subtree. */
export function themeClassName({ identity, accent, surfaceMode }: ThemeState): string {
  return cx(
    identityClass[identity],
    accent !== 'blue' && accentClass[accent][identity],
    surfaceMode === 'elevated' && elevatedClass[identity],
  );
}

function colorScheme(identity: ThemeIdentity): 'light' | 'dark' {
  return identity === 'light' ? 'light' : 'dark';
}

/** Applies `* { transition: none }` for one tick so colours do not cross-fade on theme switch. */
export function suppressTransitionsForOneTick(doc: Document = document): void {
  const el = doc.createElement('style');
  el.textContent = noTransitionsCss;
  doc.head.appendChild(el);
  // Force a style flush while transitions are disabled, then restore on the next tick.
  void doc.defaultView?.getComputedStyle(doc.body).opacity;
  setTimeout(() => el.remove(), 0);
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {}
}

function parseTheme(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function parseAccent(value: string | null): AccentColor {
  return (accentColors as readonly string[]).includes(value ?? '') ? (value as AccentColor) : 'blue';
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function useSystemDark(enabled: boolean): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DARK_QUERY).matches : false,
  );
  useEffect(() => {
    if (!enabled || !window.matchMedia) return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => setDark(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [enabled]);
  return dark;
}

export interface ThemeProviderProps {
  children?: ReactNode;
  /**
   * Root providers only: the Appearance preference. When omitted the root provider manages it
   * itself, persisted in localStorage and synced across tabs.
   */
  theme?: ThemePreference;
  /** Force an identity for this subtree (e.g. tooltips force `dark`). Overrides `theme`. */
  identity?: ThemeIdentity;
  accent?: AccentColor;
  surfaceMode?: SurfaceMode;
  /**
   * Root providers write the classes onto `document.body` (default). Pass `false` to render a
   * wrapper element instead, e.g. for side-by-side previews.
   */
  applyToBody?: boolean;
  onThemeChange?: (theme: ThemePreference) => void;
  onAccentChange?: (accent: AccentColor) => void;
}

/**
 * Applies a theme triple (identity × accent × surface mode). The outermost provider owns the
 * Appearance preference and writes classes onto <body>; nested providers inherit unset values
 * and re-apply the full class list on a `display: contents` wrapper.
 */
export function ThemeProvider(props: ThemeProviderProps) {
  const parent = useContext(ThemeContext);
  return parent ? <NestedTheme parent={parent} {...props} /> : <RootTheme {...props} />;
}

function RootTheme({
  children,
  theme: themeProp,
  identity: identityProp,
  accent: accentProp,
  surfaceMode = 'base',
  applyToBody = true,
  onThemeChange,
  onAccentChange,
}: ThemeProviderProps) {
  const [storedTheme, setStoredTheme] = useState<ThemePreference>(() => parseTheme(readStorage(THEME_STORAGE_KEY)));
  const [storedAccent, setStoredAccent] = useState<AccentColor>(() => parseAccent(readStorage(ACCENT_STORAGE_KEY)));
  const preference = themeProp ?? storedTheme;
  const accent = accentProp ?? storedAccent;
  const systemDark = useSystemDark(preference === 'system' && !identityProp);
  const identity: ThemeIdentity =
    identityProp ?? (preference === 'system' ? (systemDark ? 'dark' : 'light') : preference);

  // Live sync across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) setStoredTheme(parseTheme(e.newValue));
      if (e.key === ACCENT_STORAGE_KEY) setStoredAccent(parseAccent(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      if (themeProp === undefined) {
        setStoredTheme(next);
        writeStorage(THEME_STORAGE_KEY, next === 'system' ? null : next);
      }
      onThemeChange?.(next);
    },
    [themeProp, onThemeChange],
  );
  const setAccent = useCallback(
    (next: AccentColor) => {
      if (accentProp === undefined) {
        setStoredAccent(next);
        writeStorage(ACCENT_STORAGE_KEY, next);
      }
      onAccentChange?.(next);
    },
    [accentProp, onAccentChange],
  );

  const state: ThemeState = { identity, accent, surfaceMode };
  const className = themeClassName(state);
  const value = useMemo<ThemeContextValue>(
    () => ({ identity, accent, surfaceMode, settings: { theme: preference, accent, setTheme, setAccent } }),
    [identity, accent, surfaceMode, preference, setTheme, setAccent],
  );

  const applied = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!applyToBody) return;
    const body = document.body;
    const classes = cx(className, themeRoot).split(' ');
    if (applied.current !== null && applied.current !== className) suppressTransitionsForOneTick();
    applied.current = className;
    body.classList.add(...classes);
    body.style.colorScheme = colorScheme(identity);
    return () => {
      body.classList.remove(...classes);
      body.style.colorScheme = '';
    };
  }, [applyToBody, className, identity]);

  const content = (
    <ThemeContext.Provider value={value}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </ThemeContext.Provider>
  );
  if (applyToBody) return content;
  return (
    <div className={cx(className, themeRoot)} style={{ colorScheme: colorScheme(identity) }}>
      {content}
    </div>
  );
}

function NestedTheme({
  parent,
  children,
  theme,
  identity,
  accent,
  surfaceMode,
}: ThemeProviderProps & { parent: ThemeContextValue }) {
  const resolvedIdentity: ThemeIdentity =
    identity ?? (theme && theme !== 'system' ? theme : undefined) ?? parent.identity;
  const state: ThemeState = {
    identity: resolvedIdentity,
    accent: accent ?? parent.accent,
    surfaceMode: surfaceMode ?? parent.surfaceMode,
  };
  const value = useMemo<ThemeContextValue>(
    () => ({ ...state, settings: parent.settings }),
    [state.identity, state.accent, state.surfaceMode, parent.settings],
  );
  return (
    <ThemeContext.Provider value={value}>
      <div
        className={cx(themeClassName(state), layerRoot)}
        style={{ display: 'contents', colorScheme: colorScheme(state.identity) }}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

/** The resolved theme of the current subtree. */
export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  return ctx ? { identity: ctx.identity, accent: ctx.accent, surfaceMode: ctx.surfaceMode } : DEFAULT_STATE;
}

/** The Appearance preference and its setters (null outside a root ThemeProvider). */
export function useThemeSettings(): ThemeSettings | null {
  return useContext(ThemeContext)?.settings ?? null;
}

/**
 * Class list that re-applies the current theme with overrides — for portalled layers, whose
 * DOM sits outside the subtree that defines the theme. Floating layers pass
 * `{ surfaceMode: 'elevated' }`; tooltips also force `{ identity: 'dark' }`.
 */
export function useThemeClassName(overrides: Partial<ThemeState> = {}): string {
  const theme = useTheme();
  return cx(themeClassName({ ...theme, ...overrides }), layerRoot);
}

/** Re-themes a subtree (display: contents) — e.g. content you portal yourself. */
export function ThemeLayer({ children, ...overrides }: Partial<ThemeState> & { children?: ReactNode }) {
  const parent = useContext(ThemeContext);
  return (
    <ThemeProvider applyToBody={parent ? undefined : false} {...overrides}>
      {children}
    </ThemeProvider>
  );
}
