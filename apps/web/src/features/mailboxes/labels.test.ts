import { describe, expect, it } from 'vitest';
import {
  actorName,
  ENFORCEMENT_OPTIONS,
  enforcementLabel,
  formatShortDate,
  googleReturnMessage,
  grantableMembers,
  MAILBOX_TABS,
  memberName,
  needsReconnection,
  providerLabel,
  RECORD_CREATION_OPTIONS,
  statusLabel,
  statusTone,
  syncedLabel,
  VISIBILITY_OPTIONS,
  visibilityLabel,
  visibleTab,
} from './labels';

describe('visibility levels', () => {
  it('offers the three cards in order with the contract values', () => {
    expect(VISIBILITY_OPTIONS.map((o) => [o.id, o.title])).toEqual([
      ['metadata-only', 'Metadata only'],
      ['subject-line', 'Subject line and metadata'],
      ['full-access', 'Full access'],
    ]);
    expect(visibilityLabel('subject-line')).toBe('Subject line and metadata');
  });
});

describe('record creation', () => {
  it('maps the cards onto the contract modes and marks the recommended one', () => {
    expect(RECORD_CREATION_OPTIONS.map((o) => o.id)).toEqual(['all', 'selective', 'none']);
    expect(RECORD_CREATION_OPTIONS.filter((o) => o.badge).map((o) => [o.id, o.badge])).toEqual([
      ['selective', 'Recommended'],
    ]);
  });
});

describe('enforcement', () => {
  it('has Protected and Blocked', () => {
    expect(ENFORCEMENT_OPTIONS.map((o) => o.id)).toEqual(['protected', 'blocked']);
    expect(enforcementLabel('blocked')).toBe('Blocked');
    expect(enforcementLabel('protected')).toBe('Protected');
  });
});

describe('mailbox status chip', () => {
  it('uses the observed labels', () => {
    expect(statusLabel('in-sync')).toBe('In Sync');
    expect(statusLabel('syncing')).toBe('Syncing...');
    expect(statusLabel('sync-error')).toBe('Sync Error');
    expect(statusLabel('archived')).toBe('Archived');
  });

  it('colours healthy green, errors red', () => {
    expect(statusTone('in-sync')).toBe('green');
    expect(statusTone('sync-error')).toBe('red');
    expect(statusTone('syncing')).toBe('blue');
    expect(statusTone('archived')).toBe('grey');
  });

  it('labels what syncs and who provides it', () => {
    expect(syncedLabel({ mailSyncEnabled: true, calendarSyncEnabled: true })).toBe('Email and Calendar');
    expect(syncedLabel({ mailSyncEnabled: true, calendarSyncEnabled: false })).toBe('Email');
    expect(providerLabel('gmail')).toBe('Google');
    expect(providerLabel('test')).toBe('Test');
  });
});

describe('mailbox tabs', () => {
  it('shows General, Mailbox-only blocklist and Signatures; advanced renders General', () => {
    expect(MAILBOX_TABS.map((t) => t.label)).toEqual(['General', 'Mailbox-only blocklist', 'Signatures']);
    expect(visibleTab('blocklist')).toBe('blocklist');
    expect(visibleTab('advanced')).toBe('general');
    expect(visibleTab('nope')).toBe('general');
  });
});

describe('protected contacts table', () => {
  it('formats the last update as a short date', () => {
    expect(formatShortDate('2026-10-14T21:30:00.000Z', 'UTC')).toBe('Oct 14, 2026');
  });

  it('names who added an entry', () => {
    const members = [{ id: 'm1', firstName: 'Ada', lastName: 'Tester', emailAddress: 'ada@x.io' }];
    expect(actorName({ type: 'workspace-member', id: 'm1' }, members)).toBe('Ada Tester');
    expect(actorName({ type: 'workspace-member', id: 'gone' }, members)).toBe('Former member');
    expect(actorName({ type: 'system', id: null }, members)).toBe('System');
    expect(actorName({ type: 'api-token', id: 't' }, members)).toBe('Api token');
  });
});

describe('individual sharing', () => {
  const members = [
    { id: 'owner', suspendedAt: null },
    { id: 'a', suspendedAt: null },
    { id: 'b', suspendedAt: null },
    { id: 'c', suspendedAt: '2026-01-01T00:00:00Z' },
    { id: 'd', suspendedAt: null, removedAt: '2026-01-01T00:00:00Z' },
  ];

  it('excludes the owner, granted, suspended and removed members', () => {
    expect(grantableMembers(members, 'owner', new Set(['a'])).map((m) => m.id)).toEqual(['b']);
  });

  it('names a member or falls back to the address', () => {
    expect(memberName({ firstName: 'Ada', lastName: 'Lovelace', emailAddress: 'ada@x.io' })).toBe('Ada Lovelace');
    expect(memberName({ firstName: '', lastName: '', emailAddress: 'ada@x.io' })).toBe('ada@x.io');
  });
});

describe('return from Google (7b)', () => {
  it('maps ?google=… onto a toast', () => {
    expect(googleReturnMessage('?google=connected&mailbox=x')).toMatchObject({
      tone: 'success',
      title: 'Google account connected',
    });
    expect(googleReturnMessage('?google=reconnected')).toMatchObject({ tone: 'success' });
    expect(googleReturnMessage('?google=error&reason=missing-scopes')).toMatchObject({
      tone: 'error',
      title: 'Some permissions were not granted',
    });
    expect(googleReturnMessage('?google=error&reason=not-configured')?.title).toBe(
      'Google is not configured on this server',
    );
    expect(googleReturnMessage('?google=error&reason=whatever')?.title).toBe('Could not connect the Google account');
    expect(googleReturnMessage('?tab=general')).toBeNull();
  });
});

describe('reconnect state (7b)', () => {
  it('Google mailboxes with a dead grant need reconnection', () => {
    expect(needsReconnection({ providerType: 'gmail', credentialState: 'error-detected', status: 'sync-error' })).toBe(
      true,
    );
    expect(needsReconnection({ providerType: 'gmail', credentialState: 'active', status: 'sync-error' })).toBe(false);
    expect(needsReconnection({ providerType: 'gmail', credentialState: 'disconnected', status: 'archived' })).toBe(
      false,
    );
    expect(needsReconnection({ providerType: 'test', credentialState: 'error-detected', status: 'sync-error' })).toBe(
      false,
    );
  });
});
