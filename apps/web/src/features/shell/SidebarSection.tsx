// Collapsible sidebar section: header click / Space / Enter toggles; state per section key in
// localStorage (default open); hover reveals the section actions.
import { Icon } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { usePersistentState } from '../../lib/storage';
import * as s from './shell.css';

export function SidebarSection({
  id,
  title,
  actions,
  actionsOpen,
  children,
}: {
  id: string;
  title: string;
  actions?: ReactNode;
  /** Keep the actions visible while one of their menus is open. */
  actionsOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = usePersistentState<boolean>(`sidebar-collapsible-section:${id}`, true);
  return (
    <section className={s.navGroup} aria-label={title} data-collapsed={open ? undefined : true}>
      <div className={s.sectionHeader}>
        <Button className={s.sectionToggle} aria-expanded={open} onPress={() => setOpen(!open)}>
          <Icon icon="chevronDown" size={12} className={s.sectionChevron} />
          {title}
        </Button>
        {actions && (
          <div className={s.sectionActions} data-open={actionsOpen || undefined}>
            {actions}
          </div>
        )}
      </div>
      <div className={s.collapsible} data-collapsed={open ? undefined : true} inert={!open}>
        <div className={s.collapsibleInner}>
          <div className={s.sectionBody}>{children}</div>
        </div>
      </div>
    </section>
  );
}
