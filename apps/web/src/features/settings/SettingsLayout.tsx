// Settings shell (`/$workspaceSlug/settings/*`, B README §2.8): the settings nav replaces the main sidebar (same
// width, background and floating behaviour). Header "‹ Settings" (back to the workspace), "Search settings..."
// filtering sections and their subsections ("theme" → Appearance › Theme), then the groups.
import { IconButton, NavItem, NavSectionLabel, SearchField } from '@agentic-crm/ui';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Fragment, Suspense, useState } from 'react';
import { OverlayHost } from '../overlays/OverlayHost';
import { ContentSpinner } from '../shell/AppShell';
import { ShellFrame } from '../shell/WorkspaceLayout';
import { useWorkspace } from '../shell/workspaceContext';
import * as s from './settings.css';
import { searchSettings, settingsGroups } from './settingsNav';

export function SettingsLayout() {
  return (
    <ShellFrame sidebar={<SettingsSidebar />} label="Settings">
      <Suspense fallback={<ContentSpinner />}>
        <Outlet />
      </Suspense>
      {/* ⌘K actions (Create task / note, note templates…) and `t` / `n` work from settings too. */}
      <OverlayHost />
    </ShellFrame>
  );
}

function SettingsSidebar() {
  const { href, isAdmin } = useWorkspace();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const [query, setQuery] = useState('');
  const groups = settingsGroups
    .map((g) => ({ ...g, entries: g.entries.filter((e) => (isAdmin ? !e.nonAdminOnly : !e.adminOnly)) }))
    .filter((g) => g.entries.length > 0);
  const results = searchSettings(groups, query);

  return (
    <>
      <div className={s.navHeader}>
        <IconButton
          icon="chevronLeft"
          aria-label="Go back"
          variant="ghost"
          size={28}
          onPress={() => void navigate({ href: href() })}
        />
        <h2 className={s.navTitle}>Settings</h2>
      </div>
      <div className={s.navSearch}>
        <SearchField
          aria-label="Search settings"
          placeholder="Search settings..."
          size={28}
          value={query}
          onChange={setQuery}
        />
      </div>
      <nav className={s.navScroll} aria-label="Settings">
        {results.length === 0 && <div className={s.navEmpty}>No results found</div>}
        {results.map(({ group, entries }) => (
          <Fragment key={group.id}>
            {group.title === null && <div className={s.navRule} />}
            <div className={s.navGroup} role="group" aria-label={group.title ?? undefined}>
              {group.title && <NavSectionLabel>{group.title}</NavSectionLabel>}
              {entries.map(({ entry, subsections }) => {
                const to = href(`settings/${entry.path}`);
                return (
                  <Fragment key={entry.path}>
                    <NavItem href={to} icon={entry.icon} isCurrent={pathname === to || pathname.startsWith(`${to}/`)}>
                      {entry.label}
                    </NavItem>
                    {subsections.map((sub) => (
                      <NavItem
                        key={sub.id}
                        href={sub.to ? `${to}/${sub.to}` : `${to}#${sub.id}`}
                        className={s.navChild}
                      >
                        {sub.title}
                      </NavItem>
                    ))}
                  </Fragment>
                );
              })}
            </div>
          </Fragment>
        ))}
      </nav>
    </>
  );
}
