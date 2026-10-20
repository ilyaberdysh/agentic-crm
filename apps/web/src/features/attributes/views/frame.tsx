// The density root every View renders into (C1 cells.md §1: data-align / data-numeric / data-expanded hooks for the
// table; D §2.3 field rows with the "Set {title}" placeholder).
import { cx } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import type { Density } from '../types';
import * as s from '../ui/ui.css';

export type FrameKind = 'text' | 'chips' | 'checkbox';

export interface ValueFrameProps {
  density: Density;
  kind?: FrameKind;
  align?: 'start' | 'end';
  expanded?: boolean;
  isEmpty?: boolean;
  /** Field density placeholder shown when empty. */
  placeholder?: string;
  /** Replaces the placeholder in every density (e.g. interaction "No contact"). */
  emptyText?: string;
  children?: ReactNode;
  title?: string;
}

export function ValueFrame({
  density,
  kind = 'text',
  align = 'start',
  expanded,
  isEmpty,
  placeholder,
  emptyText,
  children,
  title,
}: ValueFrameProps) {
  const empty = isEmpty ? (
    emptyText ? (
      <span className={cx(s.placeholder, s.truncate)}>{emptyText}</span>
    ) : density === 'field' && placeholder ? (
      <span className={cx(s.placeholder, s.truncate)}>{placeholder}</span>
    ) : null
  ) : null;
  const content = isEmpty ? empty : children;
  const data = {
    'data-density': density,
    'data-align': align === 'end' ? 'right' : 'left',
    'data-numeric': align === 'end' ? 'true' : 'false',
    'data-expanded': expanded ? 'true' : undefined,
    'data-empty': isEmpty ? 'true' : undefined,
  };
  if (density === 'chip') {
    return (
      <span className={s.chipRoot} title={title} {...data}>
        {content}
      </span>
    );
  }
  if (density === 'field') {
    return (
      <div
        className={cx(s.field, kind === 'chips' && !isEmpty && s.fieldChips, align === 'end' && s.alignEnd)}
        title={title}
        {...data}
      >
        {content}
      </div>
    );
  }
  return (
    <div
      className={cx(
        s.cell,
        kind === 'chips' && !isEmpty && s.cellChips,
        kind === 'checkbox' && s.checkboxCell,
        align === 'end' && s.alignEnd,
        expanded && kind === 'chips' && s.cellExpanded,
      )}
      title={title}
      {...data}
    >
      {content}
    </div>
  );
}

/** "Set categories" from "Categories" (first character lower-cased: "Set [seed] J Text", "Set deal value"). */
export function setPlaceholder(title: string): string {
  return `Set ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}
