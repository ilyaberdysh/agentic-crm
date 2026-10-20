// Settings → Appearance (system-ui §8; evidence/B/settings-appearance-light.png / -dark.png): Theme as three cards
// (Light / Dark / System with a mini app preview) and Accent color as 7 swatches, right-aligned. Applies instantly
// app-wide, persisted device-locally and synced across tabs by the ui ThemeProvider.
import { AccentPicker, Icon, type IconName, type ThemePreference, useThemeSettings } from '@agentic-crm/ui';
import { Radio, RadioGroup } from 'react-aria-components';
import { SettingsPage, SettingsSection } from './SettingsPage';
import * as s from './settings.css';
import { findSettingsEntry } from './settingsNav';

const THEMES: Array<{ id: ThemePreference; label: string; icon: IconName }> = [
  { id: 'light', label: 'Light', icon: 'themeLight' },
  { id: 'dark', label: 'Dark', icon: 'themeDark' },
  { id: 'system', label: 'System', icon: 'themeSystem' },
];

const PALETTE = {
  light: { bg: '#ffffff', side: '#fbfbfb', line: '#eeeff1', bar: '#e6e7ea', strong: '#d9dade' },
  dark: { bg: '#101112', side: '#141517', line: '#232427', bar: '#2c2d31', strong: '#3a3b40' },
} as const;

function MiniApp({ mode, x = 0 }: { mode: 'light' | 'dark'; x?: number }) {
  const p = PALETTE[mode];
  const rows = [0, 1, 2, 3, 4, 5, 6];
  return (
    <g transform={`translate(${x} 0)`}>
      <rect width="214" height="113" fill={p.bg} />
      <rect width="56" height="113" fill={p.side} />
      <rect x="56" width="1" height="113" fill={p.line} />
      <rect x="8" y="9" width="7" height="7" rx="2" fill={p.strong} />
      <rect x="19" y="11" width="24" height="3" rx="1.5" fill={p.bar} />
      {[24, 34, 44, 54, 64, 74].map((y, i) => (
        <g key={y}>
          <rect x="8" y={y} width="5" height="5" rx="1.5" fill={p.bar} />
          <rect x="16" y={y + 1} width={[22, 30, 18, 26, 20, 28][i]} height="3" rx="1.5" fill={p.bar} />
        </g>
      ))}
      <rect x="57" y="20" width="157" height="1" fill={p.line} />
      <rect x="66" y="8" width="26" height="4" rx="2" fill={p.bar} />
      <rect x="186" y="8" width="20" height="4" rx="2" fill={p.bar} />
      {rows.map((r) => (
        <g key={r}>
          <rect x="57" y={32 + r * 11} width="157" height="1" fill={p.line} />
          <rect x="66" y={26 + r * 11} width={20 + ((r * 7) % 14)} height="3" rx="1.5" fill={p.bar} />
          <rect x="112" y={26 + r * 11} width={16 + ((r * 5) % 12)} height="3" rx="1.5" fill={p.bar} />
          <rect x="152" y={26 + r * 11} width={18 + ((r * 3) % 16)} height="3" rx="1.5" fill={p.bar} />
        </g>
      ))}
      <rect x="104" y="44" width="34" height="11" rx="1" fill="none" stroke="#266df0" strokeWidth="1" />
      <rect x="108" y="48" width="20" height="3" rx="1.5" fill="#266df0" />
    </g>
  );
}

export function ThemePreview({ theme }: { theme: ThemePreference }) {
  const clipId = `split-${theme}`;
  return (
    <svg viewBox="0 0 214 113" preserveAspectRatio="xMidYMid slice" className={s.themePreview} aria-hidden="true">
      {theme === 'system' ? (
        <>
          <defs>
            <clipPath id={clipId}>
              <rect x="107" width="107" height="113" />
            </clipPath>
          </defs>
          <MiniApp mode="light" />
          <g clipPath={`url(#${clipId})`}>
            <MiniApp mode="dark" />
          </g>
        </>
      ) : (
        <MiniApp mode={theme} />
      )}
    </svg>
  );
}

export function AppearancePage() {
  const entry = findSettingsEntry('appearance');
  const settings = useThemeSettings();
  if (!entry || !settings) return null;
  return (
    <SettingsPage entry={entry}>
      <SettingsSection id="theme" title="Theme" description="Select a theme to personalize your platform’s appearance">
        <RadioGroup
          aria-label="Theme"
          orientation="horizontal"
          value={settings.theme}
          onChange={(v) => settings.setTheme(v as ThemePreference)}
          className={s.themeCards}
        >
          {THEMES.map((t) => (
            <Radio key={t.id} value={t.id} className={s.themeCard} aria-label={t.label}>
              <ThemePreview theme={t.id} />
              <span className={s.themeLabel}>
                <Icon icon={t.icon} size={16} />
                {t.label}
              </span>
            </Radio>
          ))}
        </RadioGroup>
      </SettingsSection>
      <SettingsSection
        id="accent-color"
        title="Accent color"
        description="Choose the main color that defines the overall tone"
        aside={<AccentPicker value={settings.accent} onChange={settings.setAccent} />}
      />
    </SettingsPage>
  );
}
