import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  themeClassName,
  useTheme,
  useThemeClassName,
  useThemeSettings,
} from '../src';
import { accentClass, elevatedClass, identityClass } from '../src/theme/themes.css';

function Probe() {
  const theme = useTheme();
  const cls = useThemeClassName({ surfaceMode: 'elevated' });
  return (
    <span data-testid="probe" data-identity={theme.identity} data-accent={theme.accent} data-mode={theme.surfaceMode}>
      {cls}
    </span>
  );
}

describe('themeClassName', () => {
  it('combines identity, accent and surface classes', () => {
    expect(themeClassName({ identity: 'light', accent: 'blue', surfaceMode: 'base' })).toBe(identityClass.light);
    const cls = themeClassName({ identity: 'dark', accent: 'purple', surfaceMode: 'elevated' }).split(' ');
    expect(cls).toEqual([identityClass.dark, accentClass.purple.dark, elevatedClass.dark]);
  });
});

describe('ThemeProvider', () => {
  it('writes the root theme onto <body> and removes it on unmount', () => {
    const { unmount } = render(
      <ThemeProvider theme="dark" accent="green">
        <Probe />
      </ThemeProvider>,
    );
    expect(document.body.classList.contains(identityClass.dark)).toBe(true);
    expect(document.body.classList.contains(accentClass.green.dark)).toBe(true);
    expect(document.body.style.colorScheme).toBe('dark');
    unmount();
    expect(document.body.classList.contains(identityClass.dark)).toBe(false);
  });

  it('nested providers inherit unset values and re-apply classes on a display:contents wrapper', () => {
    render(
      <ThemeProvider theme="light" accent="pink">
        <ThemeProvider identity="dark">
          <Probe />
        </ThemeProvider>
      </ThemeProvider>,
    );
    const probe = screen.getByTestId('probe');
    expect(probe.dataset.identity).toBe('dark');
    expect(probe.dataset.accent).toBe('pink');
    const wrapper = probe.parentElement as HTMLElement;
    expect(wrapper.style.display).toBe('contents');
    expect(wrapper.className).toContain(identityClass.dark);
    expect(wrapper.className).toContain(accentClass.pink.dark);
    // Portalled layers ask for the same theme with the elevated surface mode.
    expect(probe.textContent).toContain(elevatedClass.dark);
  });

  it('follows prefers-color-scheme for the System preference', () => {
    const listeners: Array<() => void> = [];
    let dark = true;
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return query.includes('dark') ? dark : false;
      },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.push(l),
      removeEventListener: () => {},
    }));
    render(
      <ThemeProvider theme="system">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').dataset.identity).toBe('dark');
    act(() => {
      dark = false;
      for (const l of listeners) l();
    });
    expect(screen.getByTestId('probe').dataset.identity).toBe('light');
    vi.unstubAllGlobals();
  });

  it('persists the uncontrolled preference and disables transitions for one tick on switch', () => {
    vi.useFakeTimers();
    let settings: ReturnType<typeof useThemeSettings> = null;
    function Capture() {
      settings = useThemeSettings();
      return null;
    }
    render(
      <ThemeProvider>
        <Capture />
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe').dataset.identity).toBe('light');
    const noTransition = () =>
      [...document.head.querySelectorAll('style')].filter((s) => s.textContent?.includes('transition:none')).length;
    const before = noTransition();
    act(() => settings?.setTheme('dark'));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByTestId('probe').dataset.identity).toBe('dark');
    expect(noTransition()).toBe(before + 1);
    act(() => vi.runAllTimers());
    expect(noTransition()).toBe(before);
    vi.useRealTimers();
  });
});
