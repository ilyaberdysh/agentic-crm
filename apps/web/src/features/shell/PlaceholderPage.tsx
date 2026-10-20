// In-workspace pages that later slices build: the real header and shell with a tidy empty state.
import { EmptyState, type IconName } from '@agentic-crm/ui';
import type { ReactElement } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { type Crumb, PageHeader } from './PageHeader';
import * as s from './shell.css';

export function PlaceholderPage({
  title,
  icon,
  description,
  crumbs,
  emptyIcon,
}: {
  title: string;
  icon: IconName | ReactElement;
  description: string;
  crumbs?: Crumb[];
  emptyIcon?: IconName;
}) {
  useDocumentTitle(title);
  return (
    <>
      <PageHeader crumbs={crumbs ?? [{ label: title, icon }]} />
      <div className={s.content}>
        <div className={s.placeholder}>
          <EmptyState
            icon={emptyIcon ?? (typeof icon === 'string' ? icon : 'empty')}
            title={<span className={s.placeholderTitle}>{title}</span>}
            description={description}
          />
        </div>
      </div>
    </>
  );
}
