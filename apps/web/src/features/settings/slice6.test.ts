// Slice 6 settings: navigation search and role filtering, the inheritance hint, requirement vocabulary and value
// conversions, invite validation and date formatting.
import type { PermissionGrant } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { splitEmails } from './members/data';
import { inviteProblem } from './members/InviteDialog';
import { inheritanceHint, LEVEL_META } from './permissions/data';
import {
  needsValue,
  requirementLabel,
  requirementOperatorsFor,
  requirementValueKind,
  toEditorValue,
  toStoredValue,
} from './rules/data';
import { searchSettings, settingsGroups } from './settingsNav';
import { formatAddedAt } from './teams/TeamPage';

describe('settings navigation', () => {
  it('lists subsections that match, with their tab route for tab pages', () => {
    const hits = searchSettings(settingsGroups, 'webhooks');
    const dev = hits.flatMap((h) => h.entries).find((e) => e.entry.path === 'developers');
    expect(dev?.subsections.map((s) => [s.title, s.to])).toEqual([['Webhooks', 'webhooks']]);
    expect(searchSettings(settingsGroups, 'zzz')).toEqual([]);
  });

  it('has a read-only Members page for non-admins next to the admin-only Members and teams', () => {
    const entries = settingsGroups.flatMap((g) => g.entries);
    expect(entries.find((e) => e.path === 'members-and-teams')?.adminOnly).toBe(true);
    expect(entries.find((e) => e.path === 'members-read-only')?.nonAdminOnly).toBe(true);
    for (const path of ['workspace', 'developers', 'security'])
      expect(entries.find((e) => e.path === path)?.adminOnly).toBe(true);
  });
});

function grant(
  level: PermissionGrant['level'],
  effective: PermissionGrant['level'],
  source: PermissionGrant['effective']['source'],
): PermissionGrant {
  return {
    id: 'g',
    resourceKind: 'object',
    resourceId: 'o',
    target: { type: 'member', id: 'm' },
    level,
    flags: {},
    targetName: 'Someone',
    targetDetail: null,
    effective: { level: effective, source },
    createdBy: null,
    createdAt: null,
    updatedAt: null,
  };
}

describe('permissions tab', () => {
  it('explains inherited access only when the row is below what it inherits', () => {
    expect(inheritanceHint(grant('read-only', 'full-access', { type: 'team', id: 't', name: 'Sales' }))).toBe(
      'Inheriting "Full access" from the "Sales" team',
    );
    expect(inheritanceHint(grant('read-only', 'read-write', { type: 'workspace', id: 'w', name: null }))).toBe(
      'Inheriting "Read and write" from the workspace',
    );
    expect(inheritanceHint(grant('read-only', 'read-write', { type: 'team', id: 't', name: null }))).toBe(
      'Inheriting "Read and write" from a team',
    );
    expect(inheritanceHint(grant('read-only', 'read-write', { type: 'workflow', id: 'w', name: null }))).toBe(
      'Inheriting "Read and write" from another permission',
    );
    expect(inheritanceHint(grant('full-access', 'full-access', { type: 'member', id: 'm', name: null }))).toBeNull();
  });

  it('describes the four levels', () => {
    expect(Object.values(LEVEL_META).map((l) => l.label)).toEqual([
      'Full access',
      'Read and write',
      'Read only',
      'No access',
    ]);
  });
});

describe('requirement rules vocabulary', () => {
  it('offers comparisons only on ordered types and labels dates as before / after', () => {
    expect(requirementOperatorsFor({ type: 'text' })).toEqual(['required', 'empty', 'eq']);
    expect(requirementOperatorsFor({ type: 'number' })).toEqual(['required', 'empty', 'eq', 'lt', 'lte', 'gt', 'gte']);
    expect(requirementLabel('gt', { type: 'number' })).toBe('must be greater than');
    expect(requirementLabel('gte', { type: 'date' })).toBe('must be on or after');
    expect(requirementLabel('required', null)).toBe('is required');
    expect(needsValue('required')).toBe(false);
    expect(needsValue('lt')).toBe(true);
  });

  it('maps attribute types to value editors and converts values both ways', () => {
    expect(requirementValueKind({ type: 'number' })).toBe('number');
    expect(requirementValueKind({ type: 'select' })).toBe('option');
    expect(requirementValueKind({ type: 'checkbox' })).toBeNull();
    expect(toStoredValue('date', { kind: 'exact', date: '2026-01-01' })).toBe('2026-01-01');
    expect(toStoredValue('date', { kind: 'relative', duration: 'P1D' })).toBeUndefined();
    expect(toStoredValue('record', { entityInstanceId: 'r1' })).toBe('r1');
    expect(toStoredValue('actor', { kind: 'member', id: 'm1' })).toBe('m1');
    expect(toStoredValue('actor', { kind: 'current-member' })).toBeUndefined();
    expect(toStoredValue('number', 10)).toBe(10);
    expect(toEditorValue('date', '2026-01-01')).toEqual({ kind: 'exact', date: '2026-01-01' });
    expect(toEditorValue('record', 'r1')).toEqual({ entityInstanceId: 'r1' });
    expect(toEditorValue('number', undefined)).toBeUndefined();
  });
});

describe('invite validation', () => {
  it('splits pasted lists and applies the dialog messages', () => {
    expect(splitEmails('a@x.com, b@x.com;c@x.com\nd@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
    expect(inviteProblem([])).toBe('Provide at least one email to invite');
    expect(inviteProblem(Array.from({ length: 11 }, (_, i) => `u${i}@x.com`))).toBe(
      'Provide at most 10 emails to invite',
    );
    expect(inviteProblem(['nope'])).toBe('This email looks invalid');
    expect(inviteProblem(['a@x.com', 'A@x.com'])).toBe('This email is already in the list');
    expect(inviteProblem(['a@x.com', 'b@x.com'])).toBeNull();
  });
});

describe('formatAddedAt', () => {
  it('uses ordinal days: 9th Oct 2026', () => {
    expect(formatAddedAt('2026-10-09T10:00:00Z')).toMatch(/^(8|9|10)(th|st|nd|rd) Oct 2026$/);
    expect(formatAddedAt('2026-03-01T12:00:00Z')).toBe('1st Mar 2026');
    expect(formatAddedAt('2026-03-02T12:00:00Z')).toBe('2nd Mar 2026');
    expect(formatAddedAt('2026-03-03T12:00:00Z')).toBe('3rd Mar 2026');
    expect(formatAddedAt('2026-03-11T12:00:00Z')).toBe('11th Mar 2026');
  });
});
