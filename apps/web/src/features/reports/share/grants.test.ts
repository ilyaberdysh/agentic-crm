import type { PermissionGrant } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { filterTargets, freeTargets, type Grants, splitGrants, withGrant, withoutGrant } from './grants';
import { DASHBOARD_LEVEL_DESCRIPTION, inheritanceOf, inheritedFrom, LEVEL_LABEL, LEVELS } from './levels';

const WS = '00000000-0000-4000-8000-000000000001';
const DASH = '00000000-0000-4000-8000-0000000000d1';
const ADA = '00000000-0000-4000-8000-00000000ada1';
const GRACE = '00000000-0000-4000-8000-00000000c0de';
const TEAM = '00000000-0000-4000-8000-0000000007e4';

const row = (
  type: 'workspace' | 'team' | 'member',
  id: string,
  level: PermissionGrant['level'],
  extra: Partial<PermissionGrant> = {},
): PermissionGrant => ({
  id: `grant-${type}-${id}`,
  resourceKind: 'dashboard',
  resourceId: DASH,
  target: { type, id },
  level,
  flags: {},
  targetName: null,
  targetDetail: null,
  effective: { level, source: { type: type === 'member' ? 'member' : type, id, name: null } },
  createdBy: null,
  createdAt: null,
  updatedAt: null,
  ...extra,
});

const grants = (rows: PermissionGrant[]): Grants => ({
  resourceKind: 'dashboard',
  resourceId: DASH,
  resourceName: 'Dashboard',
  levels: [...LEVELS],
  canManage: true,
  grants: rows,
});

const base = grants([
  row('workspace', WS, 'full-access'),
  row('member', ADA, 'full-access', { targetName: 'Ada Tester', targetDetail: 'e2e@mymeet.ai' }),
  row('team', TEAM, 'read-only', { targetName: 'Sales', targetDetail: '3' }),
]);

describe('levels', () => {
  it('names the four levels and explains them as the level menu does', () => {
    expect(LEVELS.map((l) => LEVEL_LABEL[l])).toEqual(['Full access', 'Read and write', 'Read only', 'No access']);
    expect(DASHBOARD_LEVEL_DESCRIPTION['full-access']).toBe('Can manage reporting dashboard permissions');
    expect(DASHBOARD_LEVEL_DESCRIPTION['read-write']).toBe('Can update the reporting dashboard');
    expect(DASHBOARD_LEVEL_DESCRIPTION['read-only']).toBe('Can only view the reporting dashboard');
    expect(DASHBOARD_LEVEL_DESCRIPTION['no-access']).toBe('Has no access to the reporting dashboard');
  });
  it('words where an inherited level comes from', () => {
    expect(inheritedFrom({ type: 'workspace', id: null, name: null })).toBe('from the workspace');
    expect(inheritedFrom({ type: 'team', id: TEAM, name: 'Sales' })).toBe('from the "Sales" team');
    expect(inheritedFrom({ type: 'team', id: TEAM, name: null })).toBe('from a team');
    expect(inheritedFrom({ type: 'member', id: ADA, name: null })).toBe('from another permission');
  });
  it('reports inheritance only when the effective level is higher than the own one', () => {
    const lower = row('member', GRACE, 'read-only', {
      effective: { level: 'full-access', source: { type: 'workspace', id: WS, name: null } },
    });
    expect(inheritanceOf(lower)).toEqual({
      level: 'full-access',
      hint: 'Inheriting "Full access" from the workspace',
    });
    expect(inheritanceOf(row('member', GRACE, 'read-only'))).toBeNull();
    expect(inheritanceOf(row('workspace', WS, 'read-only'))).toBeNull();
  });
});

describe('splitGrants', () => {
  it('puts the workspace row first and sorts teams and members by name', () => {
    const s = splitGrants(
      grants([
        row('member', GRACE, 'read-only', { targetName: 'Grace Hopper' }),
        row('workspace', WS, 'read-write'),
        row('member', ADA, 'full-access', { targetName: 'Ada Tester' }),
        row('team', TEAM, 'read-only', { targetName: 'Sales' }),
      ]),
    );
    expect(s.workspace?.level).toBe('read-write');
    expect(s.members.map((m) => m.targetName)).toEqual(['Ada Tester', 'Grace Hopper']);
    expect(s.teams.map((t) => t.targetName)).toEqual(['Sales']);
  });
  it('copes with nothing loaded', () => {
    expect(splitGrants(undefined)).toEqual({ workspace: undefined, teams: [], members: [] });
  });
});

describe('withGrant', () => {
  it('changes the level of the workspace row and refreshes its flags', () => {
    const next = withGrant(base, { type: 'workspace', id: WS }, 'read-only');
    const ws = splitGrants(next).workspace;
    expect(ws?.level).toBe('read-only');
    expect(ws?.flags).toEqual({
      administrate_reporting_dashboard_permissions: false,
      read_reporting_dashboard: true,
      update_reporting_dashboard: false,
      delete_reporting_dashboard: false,
    });
    expect(base.grants[0]?.level).toBe('full-access'); // input untouched
  });
  it('adds a new member row with its name and email, never below the workspace level', () => {
    const next = withGrant(base, { type: 'member', id: GRACE }, 'read-only', {
      name: 'Grace Hopper',
      detail: 'grace@mymeet.ai',
    });
    const grace = splitGrants(next).members.find((m) => m.target.id === GRACE);
    expect(grace).toMatchObject({
      id: null,
      level: 'read-only',
      targetName: 'Grace Hopper',
      targetDetail: 'grace@mymeet.ai',
    });
    // The workspace has Full access: Grace effectively gets it (the ⚠ "Inheriting" hint).
    expect(grace?.effective).toMatchObject({ level: 'full-access', source: { type: 'workspace' } });
    expect(grace && inheritanceOf(grace)?.hint).toBe('Inheriting "Full access" from the workspace');
  });
  it('changes an existing team row in place', () => {
    const next = withGrant(base, { type: 'team', id: TEAM }, 'read-write');
    expect(splitGrants(next).teams[0]).toMatchObject({ level: 'read-write', targetName: 'Sales' });
    expect(next.grants).toHaveLength(base.grants.length);
  });
});

describe('withoutGrant and freeTargets', () => {
  it('removes a member override only', () => {
    const next = withoutGrant(base, { type: 'member', id: ADA });
    expect(next.grants.map((g) => g.target.type)).toEqual(['workspace', 'team']);
  });
  it('offers the members and teams that have no grant yet, by name', () => {
    const members = [
      { id: GRACE, name: 'Grace Hopper', email: 'grace@mymeet.ai' },
      { id: ADA, name: 'Ada Tester', email: 'e2e@mymeet.ai' },
    ];
    const teams = [
      { id: TEAM, name: 'Sales', memberCount: 3 },
      { id: 'other', name: 'Ops', memberCount: 1 },
    ];
    const free = freeTargets(base, members, teams);
    expect(free.members.map((m) => m.name)).toEqual(['Grace Hopper']);
    expect(free.teams.map((t) => t.name)).toEqual(['Ops']);
    expect(freeTargets(undefined, members, teams).members.map((m) => m.name)).toEqual(['Ada Tester', 'Grace Hopper']);
  });
  it('filters the add row by name or email', () => {
    const free = {
      members: [
        { id: GRACE, name: 'Grace Hopper', email: 'grace@mymeet.ai' },
        { id: ADA, name: 'Ada Tester', email: 'e2e@mymeet.ai' },
      ],
      teams: [{ id: TEAM, name: 'Sales', memberCount: 3 }],
    };
    expect(filterTargets(free, 'gra').members.map((m) => m.name)).toEqual(['Grace Hopper']);
    expect(filterTargets(free, 'E2E@').members.map((m) => m.name)).toEqual(['Ada Tester']);
    expect(filterTargets(free, 'sal').teams.map((t) => t.name)).toEqual(['Sales']);
    expect(filterTargets(free, 'zzz')).toEqual({ members: [], teams: [] });
    expect(filterTargets(free, '  ').members).toHaveLength(2);
  });
});
