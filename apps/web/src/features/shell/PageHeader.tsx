// Page header pattern: 48 px + 1 px rule; left = Expand sidebar (when floating) +
// breadcrumbs (icon + label, non-last secondary, slash separators); right = page actions, e.g. Help.
import { type BreadcrumbItem, Breadcrumbs, Button, Icon, type IconName, IconTile, Kbd, Tooltip } from '@agentic-crm/ui';
import type { ReactElement, ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { openHelpDrawer } from '../shortcuts/helpStore';
import * as s from './shell.css';
import { useSidebar } from './sidebarState';

export interface Crumb {
  label: string;
  icon?: IconName | ReactElement;
  href?: string;
}

/** `start` replaces the breadcrumbs (e.g. the Notes / Templates tabs of the notes index). */
export function PageHeader({ crumbs, start, actions }: { crumbs?: Crumb[]; start?: ReactNode; actions?: ReactNode }) {
  const items: BreadcrumbItem[] = (crumbs ?? []).map((c, i) => ({
    id: `${i}:${c.label}`,
    label: c.label,
    href: c.href,
    icon: typeof c.icon === 'string' ? <Icon icon={c.icon} size={16} className={s.crumbIcon} /> : c.icon,
  }));
  return (
    <header className={s.pageHeader} data-testid="page-header">
      <div className={s.pageHeaderLeft}>
        <ExpandSidebarButton />
        {start ?? <Breadcrumbs items={items} />}
      </div>
      {actions && <div className={s.pageHeaderRight}>{actions}</div>}
    </header>
  );
}

/** Shown while the sidebar floats (collapsed or narrow): hover reveals it, click expands (or opens it). */
function ExpandSidebarButton() {
  const sidebar = useSidebar();
  if (sidebar.mode !== 'hover') return null;
  return (
    <Tooltip
      content={
        <>
          Expand sidebar <Kbd keys={['mod', '.']} size={20} variant="tooltip" />
        </>
      }
      placement="bottom"
    >
      <AriaButton
        aria-label="Expand sidebar"
        className={s.collapseButton}
        style={{ position: 'static', transform: 'none', width: 28, height: 28, borderRadius: 8 }}
        onHoverStart={sidebar.reveal}
        onHoverEnd={sidebar.conceal}
        onPress={() => (sidebar.collapsed ? sidebar.setCollapsed(false) : sidebar.reveal())}
      >
        <Icon icon="sidebar" size={16} />
      </AriaButton>
    </Tooltip>
  );
}

/** Settings pages use a 28 px ghost Help button with a HelpCircle icon. */
export function HelpButton() {
  return (
    <Tooltip content="Open help drawer" shortcut={['?']}>
      <Button variant="ghost" size={28} icon="help" onPress={() => openHelpDrawer()}>
        Help
      </Button>
    </Tooltip>
  );
}

/** Object crumb icon: the coloured tile used in the sidebar. */
export function TileCrumb({ icon, color }: { icon: IconName; color: Parameters<typeof IconTile>[0]['color'] }) {
  return <IconTile icon={icon} color={color} size={16} />;
}
