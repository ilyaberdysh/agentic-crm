// Settings page template (B README §2.8): header crumb (icon + title) + Help; 768 px column, 72 px top padding;
// H1 + description with "Learn more ↗"; rule; sections 40 px apart (16 px between a section header and its body).
import { EmptyState, Icon } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import { brand } from '../../lib/brand';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { HelpButton, PageHeader } from '../shell/PageHeader';
import * as shell from '../shell/shell.css';
import * as s from './settings.css';
import type { SettingsEntry } from './settingsNav';

export function SettingsPage({ entry, children }: { entry: SettingsEntry; children: ReactNode }) {
  useDocumentTitle(entry.label);
  return (
    <>
      <PageHeader crumbs={[{ label: entry.label, icon: entry.icon }]} actions={<HelpButton />} />
      <div className={shell.content}>
        <div className={s.page}>
          <h1 className={s.pageTitle}>{entry.label}</h1>
          <p className={s.pageDescription}>
            {entry.description}{' '}
            <a className={s.learnMore} href={brand.supportUrl} target="_blank" rel="noreferrer">
              Learn more
            </a>{' '}
            <Icon icon="arrowUpRight" size={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
          </p>
          <div className={s.pageRule} />
          <div className={s.sections}>{children}</div>
        </div>
      </div>
    </>
  );
}

export function SettingsSection({
  id,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  /** Right-aligned control on the header row (e.g. accent swatches). */
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const header = (
    <div>
      <h2 className={s.sectionTitle}>{title}</h2>
      {description && <p className={s.sectionDescription}>{description}</p>}
    </div>
  );
  return (
    <section id={id} className={s.section} aria-label={title}>
      {aside ? (
        <div className={s.sectionRow}>
          {header}
          {aside}
        </div>
      ) : (
        header
      )}
      {children}
    </section>
  );
}

/** Settings pages of later slices: the real template with an empty state. */
export function SettingsPlaceholderPage({ entry }: { entry: SettingsEntry }) {
  return (
    <SettingsPage entry={entry}>
      <EmptyState
        icon={entry.icon}
        title={`${entry.label} settings`}
        description="This page arrives in a later slice."
        style={{ padding: '48px 24px' }}
      />
    </SettingsPage>
  );
}
