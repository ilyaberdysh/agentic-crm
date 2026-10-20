import {
  AccentPicker,
  NavItem,
  NavSectionLabel,
  SegmentedControl,
  type ThemePreference,
  useThemeSettings,
} from '../../src';
import * as g from './gallery.css';
import { Buttons } from './sections/Buttons';
import { Display, Navigation } from './sections/Display';
import { Feedback } from './sections/Feedback';
import { Forms } from './sections/Forms';
import { Foundations } from './sections/Foundations';
import { Overlays } from './sections/Overlays';

const toc: Array<[string, Array<[string, string]>]> = [
  [
    'Foundations',
    [
      ['colors', 'Colours'],
      ['utilities', 'Utility hues'],
      ['typography', 'Typography'],
      ['elevation', 'Elevation'],
      ['scales', 'Spacing & radii'],
      ['icons', 'Icons'],
    ],
  ],
  [
    'Controls',
    [
      ['buttons', 'Button'],
      ['icon-buttons', 'IconButton, Kbd'],
      ['inputs', 'Inputs'],
      ['toggles', 'Checkbox, Radio, Switch'],
      ['selects', 'Select, ComboBox'],
    ],
  ],
  [
    'Overlays',
    [
      ['menus', 'Menu'],
      ['popovers', 'Popover, Tooltip'],
      ['dialogs', 'Dialogs'],
      ['toasts', 'Toast'],
    ],
  ],
  [
    'Navigation & display',
    [
      ['tabs', 'Tabs, Segmented'],
      ['nav', 'Nav items'],
      ['avatars', 'Avatars'],
      ['tags', 'Badges, tags, chips'],
      ['banners', 'Banners'],
      ['states', 'States'],
    ],
  ],
];

export function App() {
  const settings = useThemeSettings();
  return (
    <div className={g.shell}>
      <aside className={g.nav}>
        <div className={g.brand}>agentic-crm UI</div>
        {toc.map(([group, items]) => (
          <div key={group}>
            <NavSectionLabel>{group}</NavSectionLabel>
            {items.map(([id, label]) => (
              <NavItem key={id} href={`#${id}`}>
                {label}
              </NavItem>
            ))}
          </div>
        ))}
      </aside>
      <div className={g.main}>
        <header className={g.topbar}>
          <span className={g.topbarTitle}>Design system gallery</span>
          {settings && (
            <>
              <SegmentedControl
                aria-label="Theme"
                value={settings.theme}
                onChange={(v) => settings.setTheme(v as ThemePreference)}
                options={[
                  { id: 'light', label: 'Light', icon: 'themeLight' },
                  { id: 'dark', label: 'Dark', icon: 'themeDark' },
                  { id: 'system', label: 'System', icon: 'themeSystem' },
                ]}
              />
              <AccentPicker value={settings.accent} onChange={settings.setAccent} />
            </>
          )}
        </header>
        <main className={g.content}>
          <Foundations />
          <Buttons />
          <Forms />
          <Overlays />
          <Navigation />
          <Display />
          <Feedback />
        </main>
      </div>
    </div>
  );
}
