// Copy and enum mappings of the email and calendar settings (F settings §1–4): visibility levels, mailbox status chips,
// record creation modes, enforcement levels, provider names. Pure, so they are unit-tested.
import type { Mailbox, ProtectedContact, WorkspaceEmailSettings } from './data';

export type VisibilityLevel = Mailbox['defaultVisibility'];
export type RecordCreationMode = WorkspaceEmailSettings['recordCreation'];
export type Enforcement = ProtectedContact['enforcement'];
export type MailboxStatus = Mailbox['status'];

export interface VisibilityOption {
  id: VisibilityLevel;
  title: string;
  description: string;
}

/** The three "Email visibility" cards, least to most visible (F settings §2.1). */
export const VISIBILITY_OPTIONS: readonly VisibilityOption[] = [
  {
    id: 'metadata-only',
    title: 'Metadata only',
    description: 'The email participants and timestamp will be visible to anyone in your workspace',
  },
  {
    id: 'subject-line',
    title: 'Subject line and metadata',
    description: "We'll share the subject, participants and timestamp with anyone in your workspace",
  },
  {
    id: 'full-access',
    title: 'Full access',
    description: 'Everything is shared with your workspace (including the body, subject line, attachments)',
  },
];

export function visibilityLabel(level: VisibilityLevel): string {
  return VISIBILITY_OPTIONS.find((o) => o.id === level)?.title ?? level;
}

export interface RecordCreationOption {
  id: RecordCreationMode;
  title: string;
  description: string;
  badge?: string;
}

/** "Default record creation" cards (F settings §4.2). */
export const RECORD_CREATION_OPTIONS: readonly RecordCreationOption[] = [
  {
    id: 'all',
    title: 'All contacts',
    description:
      'Records will be created for all contacts who appear in the emails and calendar events of your workspace members.',
  },
  {
    id: 'selective',
    title: 'Selective contact creation',
    badge: 'Recommended',
    description:
      'Records will only be created for contacts who receive emails from your workspace members, or appear in their calendar events.',
  },
  {
    id: 'none',
    title: 'None',
    description:
      'No records will automatically be created. Email and calendar events will still be linked with records created manually.',
  },
];

export const ENFORCEMENT_OPTIONS: readonly { id: Enforcement; label: string }[] = [
  { id: 'protected', label: 'Protected' },
  { id: 'blocked', label: 'Blocked' },
];

export function enforcementLabel(level: Enforcement): string {
  return level === 'blocked' ? 'Blocked' : 'Protected';
}

/** Row chip of the accounts list: "In Sync" / "Syncing..." / "Sync Error" / "Archived". */
export function statusLabel(status: MailboxStatus): string {
  switch (status) {
    case 'in-sync':
      return 'In Sync';
    case 'syncing':
      return 'Syncing...';
    case 'sync-error':
      return 'Sync Error';
    case 'archived':
      return 'Archived';
  }
}

export type StatusTone = 'green' | 'blue' | 'red' | 'grey';

export function statusTone(status: MailboxStatus): StatusTone {
  switch (status) {
    case 'in-sync':
      return 'green';
    case 'syncing':
      return 'blue';
    case 'sync-error':
      return 'red';
    case 'archived':
      return 'grey';
  }
}

/** Sub-label of an account row: what syncs ("Email and Calendar" / "Email"). */
export function syncedLabel(mailbox: Pick<Mailbox, 'mailSyncEnabled' | 'calendarSyncEnabled'>): string {
  return mailbox.calendarSyncEnabled ? 'Email and Calendar' : 'Email';
}

/** A Google mailbox whose grant is gone (revoked / expired / missing permissions): it needs "Reconnect". */
export function needsReconnection(mailbox: Pick<Mailbox, 'providerType' | 'credentialState' | 'status'>): boolean {
  return mailbox.providerType === 'gmail' && mailbox.status !== 'archived' && mailbox.credentialState !== 'active';
}

export function providerLabel(provider: Mailbox['providerType']): string {
  return provider === 'gmail' ? 'Google' : 'Test';
}

export const MAILBOX_TABS = [
  { id: 'general', label: 'General' },
  { id: 'blocklist', label: 'Mailbox-only blocklist' },
  { id: 'signatures', label: 'Signatures' },
] as const;

export type VisibleMailboxTab = (typeof MAILBOX_TABS)[number]['id'];

/** `advanced` is flag-gated (F settings §2.4): its URL renders General. */
export function visibleTab(tab: string): VisibleMailboxTab {
  return MAILBOX_TABS.some((t) => t.id === tab) ? (tab as VisibleMailboxTab) : 'general';
}

/** Members who can still be given individual full access: not the owner, not yet granted, not suspended/removed. */
export function grantableMembers<M extends { id: string; suspendedAt: string | null; removedAt?: string | null }>(
  members: readonly M[],
  ownerId: string,
  grantedIds: ReadonlySet<string>,
): M[] {
  return members.filter((m) => m.id !== ownerId && !grantedIds.has(m.id) && !m.suspendedAt && !m.removedAt);
}

/** "First Last", falling back to the address. */
export function memberName(m: { firstName: string; lastName: string; emailAddress: string }): string {
  const name = `${m.firstName} ${m.lastName}`.trim();
  return name || m.emailAddress;
}

/** "Oct 14, 2026" (the "Last update" column). */
export function formatShortDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(
    new Date(iso),
  );
}

/** Who added an entry: the member's name, "System" or the actor type ("Api token"). */
export function actorName(
  actor: { type: string; id: string | null },
  members: readonly { id: string; firstName: string; lastName: string; emailAddress: string }[],
): string {
  if (actor.type === 'workspace-member') {
    const member = members.find((m) => m.id === actor.id);
    return member ? memberName(member) : 'Former member';
  }
  if (actor.type === 'system') return 'System';
  const label = actor.type.replace(/-/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export interface ReturnMessage {
  tone: 'success' | 'error';
  title: string;
  description?: string;
}

const TRY_AGAIN = 'Please try again.';

/** Texts of `?google=error&reason=…` (apps/api integrations/google.ts GoogleReturnReason). */
const GOOGLE_ERRORS: Record<string, { title: string; description: string }> = {
  'not-configured': {
    title: 'Google is not configured on this server',
    description: 'Ask an administrator to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
  },
  'access-denied': { title: 'Google account not connected', description: 'The Google sign-in was cancelled.' },
  'missing-scopes': {
    title: 'Some permissions were not granted',
    description: 'Connect again and allow every permission: read and send email, and read your calendar.',
  },
  'already-connected': {
    title: 'This email address is already connected',
    description: 'Another account in this workspace already syncs it.',
  },
  'account-mismatch': {
    title: 'You signed in to a different Google account',
    description: 'Reconnect with the Google account of this mailbox.',
  },
  'unverified-email': { title: 'The Google account address is not verified', description: TRY_AGAIN },
  expired: { title: 'The Google sign-in expired', description: TRY_AGAIN },
  'invalid-state': { title: 'The Google sign-in expired', description: TRY_AGAIN },
  'cookie-mismatch': { title: 'The Google sign-in expired', description: TRY_AGAIN },
  'session-mismatch': {
    title: 'The Google sign-in was started by another session',
    description: 'Sign in again and retry from this page.',
  },
};

/**
 * The toast for the browser's return from Google (`?google=connected|reconnected|error&reason=…`); null when the URL
 * carries no outcome.
 */
export function googleReturnMessage(search: string): ReturnMessage | null {
  const params = new URLSearchParams(search);
  const outcome = params.get('google');
  if (outcome === 'connected') {
    return {
      tone: 'success',
      title: 'Google account connected',
      description: 'Your emails and calendar events are syncing.',
    };
  }
  if (outcome === 'reconnected') return { tone: 'success', title: 'Google account reconnected' };
  if (outcome !== 'error') return null;
  const known = GOOGLE_ERRORS[params.get('reason') ?? ''];
  return { tone: 'error', ...(known ?? { title: 'Could not connect the Google account', description: TRY_AGAIN }) };
}
