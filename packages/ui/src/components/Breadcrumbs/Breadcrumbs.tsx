import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { type Key, Link, Breadcrumb as RACBreadcrumb, Breadcrumbs as RACBreadcrumbs } from 'react-aria-components';
import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import { cx } from '../../utils/cx';
import * as s from './Breadcrumbs.css';

export interface BreadcrumbItem {
  id: Key;
  label: ReactNode;
  icon?: IconName | IconGlyph | ReactElement;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  onAction?: (id: Key) => void;
  className?: string;
}

function renderIcon(icon: BreadcrumbItem['icon']): ReactNode {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  return <Icon icon={icon as IconName | IconGlyph} size={16} />;
}

/** Page-header breadcrumbs: crumbs 24 px, last one primary, skewed-rule separators. */
export function Breadcrumbs({ items, onAction, className }: BreadcrumbsProps) {
  return (
    <RACBreadcrumbs items={items} onAction={onAction} className={cx(s.list, className)}>
      {(item) => (
        <RACBreadcrumb id={item.id} className={s.item}>
          {({ isCurrent }) => (
            <>
              <Link href={item.href} className={s.crumb}>
                {renderIcon(item.icon)}
                <span className={s.crumbText}>{item.label}</span>
              </Link>
              {!isCurrent && <span className={s.separator} aria-hidden="true" />}
            </>
          )}
        </RACBreadcrumb>
      )}
    </RACBreadcrumbs>
  );
}
