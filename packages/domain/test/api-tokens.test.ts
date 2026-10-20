import { describe, expect, it } from 'vitest';
import { memberContext } from '../src/index.ts';
import { createUser, createWorkspace, domain, expectCode } from './support/harness.ts';

describe('API tokens', () => {
  it('creates a token whose secret is shown once and authenticates it to its workspace', async () => {
    const ws = await createWorkspace();
    const created = await domain.apiTokens.create(ws.ctx, {
      name: 'Zapier',
      scopes: ['record_permission:read', 'record_permission:read-write', 'object_configuration:read'],
    });
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.tokenPrefix).toBe(created.token.slice(0, 8));
    // read is folded into read-write
    expect(created.scopes).toEqual(['record_permission:read-write', 'object_configuration:read']);
    expect(created.authorizedByMemberId).toBe(ws.memberId);
    expect(created.tokenLevel).toBe('workspace');

    const identity = await domain.apiTokens.authenticate(created.token);
    expect(identity?.token.id).toBe(created.id);
    expect(identity?.workspace).toMatchObject({ id: ws.workspaceId, slug: ws.slug });
    expect(await domain.apiTokens.authenticate(`${created.token}x`)).toBeNull();

    const listed = await domain.apiTokens.list(ws.ctx);
    expect(listed.map((t) => t.id)).toEqual([created.id]);
    expect(JSON.stringify(listed)).not.toContain(created.token);
  });

  it('edits scopes and revokes', async () => {
    const ws = await createWorkspace();
    const created = await domain.apiTokens.create(ws.sys, {
      name: 'CLI',
      scopes: ['user_management:read'],
      authorizedByMemberId: ws.memberId,
    });
    expect(created.authorizedByMemberId).toBe(ws.memberId);
    const updated = await domain.apiTokens.update(ws.ctx, { tokenId: created.id, scopes: ['note:read-write'] });
    expect(updated.scopes).toEqual(['note:read-write']);
    const revoked = await domain.apiTokens.revoke(ws.ctx, created.id);
    expect(revoked.revokedAt).not.toBeNull();
    expect(await domain.apiTokens.authenticate(created.token)).toBeNull();
    expect(await domain.apiTokens.list(ws.ctx)).toEqual([]);
  });

  it('validates input and is admin-only', async () => {
    const ws = await createWorkspace();
    await expect(domain.apiTokens.create(ws.ctx, { name: 'x', scopes: [] })).rejects.toThrow(/at least one scope/);
    await expect(domain.apiTokens.create(ws.ctx, { name: ' ', scopes: ['note:read'] })).rejects.toThrow(/empty/);
    await expect(
      domain.apiTokens.create(ws.ctx, { name: 'x', scopes: ['records:read' as 'note:read'] }),
    ).rejects.toThrow();

    const other = await createUser('Grace', 'Hopper');
    await domain.invites.create(ws.ctx, { invites: [{ emailAddress: other.emailAddress, accessLevel: 'member' }] });
    const joined = await domain.invites.accept(other, { workspaceId: ws.workspaceId });
    const member = memberContext(ws.workspaceId, joined.membership.id);
    await expectCode(domain.apiTokens.create(member, { name: 'mine', scopes: ['note:read'] }), 'FORBIDDEN', 403);

    const token = await domain.apiTokens.create(ws.ctx, { name: 'api', scopes: ['note:read'] });
    const asToken = { workspaceId: ws.workspaceId, actor: { type: 'api-token' as const, id: token.id } };
    await expectCode(domain.apiTokens.create(asToken, { name: 'nested', scopes: ['note:read'] }), 'FORBIDDEN', 403);
  });
});
