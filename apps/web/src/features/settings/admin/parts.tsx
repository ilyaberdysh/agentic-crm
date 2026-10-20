// Shared pieces of the slice-6 settings pages: the header of tab pages ("Members and teams", "Developers": title,
// description with "Learn more ↗", tab row), autosaving inputs, member avatars and the write helper that notes the
// change seq (I4a).
import { Avatar, type AvatarSize, Icon, type IconName, Tab, TabList, TabPanel, Tabs, TextInput } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { api, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../../data/trpc';
import { brand } from '../../../lib/brand';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { type Crumb, HelpButton, PageHeader } from '../../shell/PageHeader';
import * as shell from '../../shell/shell.css';
import { useWorkspace } from '../../shell/workspaceContext';
import * as os from '../objects/objects.css';
import * as s from './admin.css';

// ---- write helper ---------------------------------------------------------------------------------------------

/** Awaits a mutation and notes its change seq so later reads are never older than the write (I4a). */
export async function written<T extends { seq?: string | null }>(ws: WorkspaceRef, call: Promise<T>): Promise<T> {
  const result = await call;
  noteAcceptAfter(ws.id, result.seq);
  return result;
}

// ---- copy -------------------------------------------------------------------------------------------------------

export function LearnMore({ href = brand.supportUrl, label = 'Learn more' }: { href?: string; label?: string }) {
  return (
    <>
      <a className={s.learnMore} href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
      <Icon icon="arrowUpRight" size={12} className={s.learnMoreArrow} />
    </>
  );
}

export function memberName(m: { firstName?: string | null; lastName?: string | null; emailAddress?: string | null }) {
  return `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.emailAddress || 'Unknown member';
}

// ---- tab pages --------------------------------------------------------------------------------------------------

export interface PageTab<T extends string> {
  id: T;
  label: string;
  icon: IconName;
  count?: number;
}

/**
 * Header of a settings page with tabs (teams-list.png, s74-webhooks.png): crumbs, 24 px title, description + "Learn
 * more ↗", the tab row with its rule, then the panel (40 px below the rule).
 */
export function TabsPage<T extends string>({
  crumbs,
  title,
  description,
  tabs,
  tab,
  onTab,
  documentTitle,
  children,
  learnMoreHref,
}: {
  crumbs: Crumb[];
  title: string;
  description: ReactNode;
  tabs: PageTab<T>[];
  tab: T;
  onTab: (tab: T) => void;
  documentTitle?: string;
  children: ReactNode;
  /** `false` leaves the trailing "Learn more ↗" out (the description carries its own link). */
  learnMoreHref?: string | false;
}) {
  useDocumentTitle(documentTitle ?? title);
  return (
    <>
      <PageHeader crumbs={crumbs} actions={<HelpButton />} />
      <div className={shell.content}>
        <div className={os.page}>
          <h1 className={os.pageTitle}>{title}</h1>
          <p className={os.pageDescription}>
            {description} {learnMoreHref !== false && <LearnMore href={learnMoreHref} />}
          </p>
          <Tabs
            selectedKey={tab}
            onSelectionChange={(k) => onTab(k as T)}
            className={os.tabs}
            style={{ marginTop: 24 }}
          >
            <div className={os.tabRow}>
              <TabList aria-label={title}>
                {tabs.map((t) => (
                  <Tab key={t.id} id={t.id} icon={t.icon} count={t.count}>
                    {t.label}
                  </Tab>
                ))}
              </TabList>
            </div>
            <TabPanel id={tab} className={os.tabPanel}>
              {children}
            </TabPanel>
          </Tabs>
        </div>
      </div>
    </>
  );
}

/** A settings page without tabs but with the object-settings column (member detail, team page headers). */
export function PlainPage({
  crumbs,
  documentTitle,
  children,
}: {
  crumbs: Crumb[];
  documentTitle?: string;
  children: ReactNode;
}) {
  useDocumentTitle(documentTitle ?? crumbs[crumbs.length - 1]?.label);
  return (
    <>
      <PageHeader crumbs={crumbs} actions={<HelpButton />} />
      <div className={shell.content}>
        <div className={os.page}>{children}</div>
      </div>
    </>
  );
}

// ---- inputs ------------------------------------------------------------------------------------------------------

/** Text input that saves on blur or Enter; Escape reverts. `allowEmpty` false reverts empty values. */
export function AutosaveInput({
  label,
  value,
  isDisabled,
  allowEmpty = false,
  onSave,
  placeholder,
  size = 32,
  ...rest
}: {
  label: string;
  value: string;
  isDisabled?: boolean;
  allowEmpty?: boolean;
  placeholder?: string;
  size?: 28 | 32 | 34;
  onSave: (value: string) => void | Promise<void>;
  'data-testid'?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (!next && !allowEmpty) {
      setDraft(value);
      return;
    }
    if (next !== value) void onSave(next);
  };
  return (
    <TextInput
      label={label}
      size={size}
      value={draft}
      onChange={setDraft}
      isDisabled={isDisabled}
      placeholder={placeholder}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={{ flex: 1 }}
      {...rest}
    />
  );
}

// ---- avatars -----------------------------------------------------------------------------------------------------

/** A short-lived signed URL of an uploaded file (avatars, workspace logo); null while unknown or when it fails. */
export function useFileUrl(entryId: string | null | undefined): string | null {
  const { workspace } = useWorkspace();
  const q = useQuery({
    queryKey: ['ws', workspace.id, 'file-url', entryId ?? ''],
    queryFn: () =>
      api.files.downloadUrl.query({ entryId: entryId as string, disposition: 'inline' }, inWorkspace(workspace)),
    enabled: Boolean(entryId),
    staleTime: 4 * 60_000,
    gcTime: 5 * 60_000,
    retry: false,
  });
  return q.data?.url ?? null;
}

export function MemberAvatar({
  member,
  size = 24,
}: {
  member: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    emailAddress?: string | null;
    avatarFileId?: string | null;
  };
  size?: AvatarSize;
}) {
  const src = useFileUrl(member.avatarFileId);
  return <Avatar name={memberName(member)} src={src} kind="member" size={size} seed={member.id} />;
}
