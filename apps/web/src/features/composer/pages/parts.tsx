// Shared pieces of the Emails page tabs: the toolbar and the empty state with its "Learn more" card.
import { Icon, type IconName } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import { brand } from '../../../lib/brand';
import * as n from '../../notes/notesPage.css';
import { EmptyIllustration } from '../../record/ui/EmptyIllustration';
import * as s from './pages.css';

export function Toolbar({ children }: { children?: ReactNode }) {
  return (
    <div className={n.toolbar} data-testid="emails-toolbar">
      <span className={n.toolbarSpacer} />
      <div className={s.toolbarActions}>{children}</div>
    </div>
  );
}

export function EmptyTab({
  icon,
  title,
  text,
  action,
  learn,
}: {
  icon: IconName;
  title: string;
  text: string;
  action?: ReactNode;
  /** The "Learn more" card at the bottom. */
  learn: string;
}) {
  return (
    <div className={s.empty} data-testid="emails-empty">
      <EmptyIllustration icon={icon} />
      <div className={s.emptyTitle}>{title}</div>
      <div className={s.emptyText}>{text}</div>
      {action && <div className={s.emptyAction}>{action}</div>}
      <div className={s.learn}>
        <span className={s.learnLabel}>Learn more</span>
        <a className={s.learnCard} href={brand.supportUrl} target="_blank" rel="noreferrer">
          <span className={s.learnTile}>
            <Icon icon="document" size={24} />
          </span>
          {learn}
        </a>
      </div>
    </div>
  );
}
