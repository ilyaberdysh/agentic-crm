// Small shared pieces of the email settings pages: the page frame, sections, route tabs, provider tile, Learn more.
import { Icon, type IconGlyph, type IconName, Tab, TabList, TabPanel, Tabs } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import { brand } from '../../lib/brand';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { type Crumb, HelpButton, PageHeader } from '../shell/PageHeader';
import * as shell from '../shell/shell.css';
import type { Mailbox } from './data';
import { MailMetadataGlyph } from './glyphs';
import * as s from './page.css';

/** Page header (crumbs + Help) and the 768 px settings column. */
export function SettingsFrame({
  crumbs,
  title,
  children,
}: {
  crumbs: Crumb[];
  /** Browser tab title. */
  title: string;
  children: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <>
      <PageHeader crumbs={crumbs} actions={<HelpButton />} />
      <div className={shell.content}>
        <div className={s.page} data-testid="email-settings-page">
          {children}
        </div>
      </div>
    </>
  );
}

export function LearnMore() {
  return (
    <>
      <a className={s.learnMore} href={brand.supportUrl} target="_blank" rel="noreferrer">
        Learn more
      </a>{' '}
      <Icon icon="arrowUpRight" size={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
    </>
  );
}

export function Section({
  id,
  title,
  description,
  aside,
  tall,
  compact,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  /** Right-aligned control on the header row. */
  aside?: ReactNode;
  /** Page-level section: 24 px title line. */
  tall?: boolean;
  /** Body 12 px under the header (default 16). */
  compact?: boolean;
  children?: ReactNode;
}) {
  const head = (
    <div className={s.sectionHeadText}>
      <h2 className={tall ? `${s.sectionTitle} ${s.sectionTitleTall}` : s.sectionTitle}>{title}</h2>
      {description && <p className={s.sectionDescription}>{description}</p>}
    </div>
  );
  return (
    <section id={id} className={compact ? `${s.section} ${s.sectionCompact}` : s.section} aria-label={title}>
      {aside ? (
        <div className={s.sectionHead}>
          {head}
          {aside}
        </div>
      ) : (
        head
      )}
      {children}
    </section>
  );
}

/** Sub-block of a section (14 px / 600 title, 12 px description, optional right-hand control). */
export function Block({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={s.block}>
      <div className={s.blockHead}>
        <div>
          <h3 className={s.blockTitle}>{title}</h3>
          {description && <p className={s.blockDescription}>{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

export interface RouteTab<T extends string> {
  id: T;
  label: string;
  icon: IconName | IconGlyph;
}

/** Underline tabs whose selection is a route: `selected` comes from the URL, `onSelect` navigates. */
export function RouteTabs<T extends string>({
  label,
  tabs,
  selected,
  onSelect,
  plainPanel,
  children,
}: {
  label: string;
  tabs: readonly RouteTab<T>[];
  selected: T;
  onSelect: (id: T) => void;
  /** The panel holds one block instead of stacked sections. */
  plainPanel?: boolean;
  children: ReactNode;
}) {
  return (
    <Tabs selectedKey={selected} onSelectionChange={(key) => onSelect(key as T)} className={s.tabs}>
      <TabList aria-label={label}>
        {tabs.map((t) => (
          <Tab key={t.id} id={t.id} icon={t.icon} className={s.routeTab}>
            {t.label}
          </Tab>
        ))}
      </TabList>
      <TabPanel id={selected} className={plainPanel ? s.tabPanelPlain : s.tabPanel}>
        {children}
      </TabPanel>
    </Tabs>
  );
}

/** Provider logo tile of an account (a neutral envelope tile: provider marks are not reproduced). */
export function ProviderTile({ provider, size = 40 }: { provider: Mailbox['providerType']; size?: 40 | 56 }) {
  return (
    <span
      className={`${s.providerTile} ${s.providerTileSize[size]} ${provider === 'test' ? s.providerTileTest : ''}`}
      data-provider={provider}
      aria-hidden="true"
    >
      <Icon icon={MailMetadataGlyph} size={size === 56 ? 24 : 18} />
    </span>
  );
}
