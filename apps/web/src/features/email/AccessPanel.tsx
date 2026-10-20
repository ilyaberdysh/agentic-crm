// Email sharing popovers (F README §2.2 "Manage access", §2.3 "Share"): a "Workspace Access" row with a level select,
// "Search and add users" + "Grant access", and the people who have access. The record Emails tab shares *the viewer's*
// emails on a record ("Person email access"); the email modal shares one thread ("Email Access", plus the thread link).
import type { EmailAccess, GrantResource, VisibilityLevel } from '@agentic-crm/contracts';
import { Avatar, Button, Icon, IconButton, Select, SelectItem, toast } from '@agentic-crm/ui';
import { useMemo, useState } from 'react';
import { errorEnvelopeOf } from '../../data/trpc';
import { useMembers } from '../attributes';
import { memberName } from '../attributes/format/formatValue';
import { copyToClipboard } from '../notes';
import { useWorkspace } from '../shell/workspaceContext';
import { useEmailGrants, usePutGrant, useRemoveGrant } from './data';
import * as s from './emails.css';
import { ACCESS_LEVEL_LABEL, ACCESS_SELECT_LEVELS, type AccessSelectLevel } from './model';

const LEVEL_ITEMS = ACCESS_SELECT_LEVELS.map((id) => ({ id, label: ACCESS_LEVEL_LABEL[id] }));

export function AccessPanel({
  title,
  resource,
  showYou = false,
  link,
  canShare = true,
}: {
  title: string;
  resource: GrantResource;
  /** Lists the viewer first as "(You)" — the email modal. */
  showYou?: boolean;
  /** A read-only link with "Copy link" — the email modal. */
  link?: string;
  /** false: the viewer owns no copy of what is shared (only an owner can grant access). */
  canShare?: boolean;
}) {
  const { workspace, me } = useWorkspace();
  const members = useMembers();
  const grants = useEmailGrants(resource, canShare);
  const put = usePutGrant();
  const remove = useRemoveGrant();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  const list = grants.data ?? [];
  const workspaceGrant = list.find((g) => g.target.type === 'workspace');
  const memberGrants = list.flatMap((g) =>
    g.target.type === 'member' ? [{ grant: g, memberId: g.target.memberId }] : [],
  );
  const level: AccessSelectLevel = workspaceGrant ? workspaceGrant.level : 'none';
  const granted = new Set(memberGrants.map((g) => g.memberId));
  const meId = workspace.membership.id;
  const pickedMember = members.find((m) => m.id === picked);
  const myName = memberName(members.find((m) => m.id === meId)) || me.user.name || me.user.email;

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => m.id !== meId && !granted.has(m.id))
      .filter((m) => !q || `${memberName(m)} ${m.emailAddress}`.toLowerCase().includes(q))
      .slice(0, 20);
  }, [members, query, meId, granted]);

  const fail = (error: unknown, what: string) =>
    toast.error({ title: what, description: errorEnvelopeOf(error).message });

  const setLevel = (next: AccessSelectLevel) => {
    if (next === 'none') {
      if (workspaceGrant) remove.mutate(workspaceGrant.id, { onError: (e) => fail(e, 'Failed to update access') });
      return;
    }
    put.mutate(
      { resource, target: { type: 'workspace' }, level: next as VisibilityLevel },
      { onError: (e) => fail(e, 'Failed to update access') },
    );
  };

  const grant = () => {
    if (!picked) return;
    put.mutate(
      { resource, target: { type: 'member', memberId: picked } },
      {
        onSuccess: () => {
          setPicked(null);
          setQuery('');
        },
        onError: (e) => fail(e, 'Failed to grant access'),
      },
    );
  };

  return (
    <div className={s.accessPanel} data-testid="access-panel">
      <div className={s.accessTitle}>{title}</div>
      {!canShare && <div className={s.accessHint}>Only the owner of an email can share it.</div>}
      <div className={s.accessRow}>
        <Avatar name={workspace.name} kind="workspace" size={20} seed={workspace.id} />
        <span className={s.accessName}>Workspace Access</span>
        <Select<{ id: AccessSelectLevel; label: string }>
          aria-label="Workspace access level"
          data-testid="access-workspace-level"
          items={LEVEL_ITEMS}
          selectedKey={level}
          onSelectionChange={(k) => setLevel(k as AccessSelectLevel)}
          size={28}
          menuWidth={170}
          isDisabled={!canShare}
          style={{ width: 150 }}
        >
          {(item) => <SelectItem id={item.id}>{item.label}</SelectItem>}
        </Select>
      </div>

      {canShare && (
        <>
          {pickedMember ? (
            <div className={s.userSearch} data-testid="access-picked">
              <span className={s.pickedChip}>
                <Avatar name={memberName(pickedMember)} kind="member" size={16} seed={pickedMember.id} />
                {memberName(pickedMember)}
                <IconButton icon="close" size={20} aria-label="Remove selection" onPress={() => setPicked(null)} />
              </span>
            </div>
          ) : (
            <>
              <label className={s.userSearch}>
                <Icon icon="search" size={16} />
                <input
                  className={s.userSearchInput}
                  placeholder="Search and add users"
                  aria-label="Search and add users"
                  data-testid="access-user-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                />
              </label>
              {(query.trim() !== '' || candidates.length > 0) && (
                <div className={s.userList} role="listbox" aria-label="Users" data-testid="access-user-list">
                  {candidates.length === 0 && (
                    <div className={s.accessHint} style={{ padding: 8 }}>
                      No results
                    </div>
                  )}
                  {candidates.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected="false"
                      className={s.userOption}
                      data-testid="access-user-option"
                      onClick={() => setPicked(m.id)}
                    >
                      <Avatar name={memberName(m)} kind="member" size={20} seed={m.id} />
                      <span className={s.accessName}>{memberName(m)}</span>
                      <span className={s.userOptionEmail}>{m.emailAddress}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <Button
            variant="primary"
            size={28}
            isDisabled={!picked}
            isPending={put.isPending && put.variables?.target.type === 'member'}
            onPress={grant}
            data-testid="access-grant-button"
          >
            Grant access
          </Button>
        </>
      )}

      {(showYou || memberGrants.length > 0) && (
        <>
          <div className={s.accessSection}>People with access</div>
          {showYou && (
            <div className={s.accessRow} data-testid="access-person">
              <Avatar name={myName} kind="member" size={20} seed={meId} />
              <span className={s.accessName}>{myName} (You)</span>
              <span className={s.accessLevel}>Owner</span>
            </div>
          )}
          {memberGrants.map(({ grant: g, memberId }) => {
            const member = members.find((m) => m.id === memberId);
            return (
              <div key={g.id} className={s.accessRow} data-testid="access-person">
                <Avatar name={member ? memberName(member) : 'Member'} kind="member" size={20} seed={memberId} />
                <span className={s.accessName}>{member ? memberName(member) : 'Workspace member'}</span>
                <span className={s.accessLevel}>{ACCESS_LEVEL_LABEL[g.level as EmailAccess]}</span>
                <IconButton
                  icon="close"
                  size={20}
                  aria-label={`Remove access for ${member ? memberName(member) : 'member'}`}
                  onPress={() => remove.mutate(g.id, { onError: (e) => fail(e, 'Failed to remove access') })}
                />
              </div>
            );
          })}
        </>
      )}

      {link && (
        <>
          <div className={s.accessSection}>Access</div>
          <div className={s.linkField}>
            <input
              className={s.linkInput}
              readOnly
              value={link}
              aria-label="Email link"
              data-testid="email-share-link"
            />
            <Button
              variant="secondary"
              size={28}
              icon="link"
              onPress={() => void copyToClipboard(link, 'Link copied to clipboard')}
            >
              Copy link
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
