// Workflow access (README §3.7, internal-api §6; permissions B.12 with resourceKind 'workflow'): the level menu (Full
// access / Read and write / Read only / No access with their descriptions), the workspace row, member rows and the
// member search + Add — shared by the Share popover and the admin Permissions tab.
import type { AccessScope } from '@agentic-crm/contracts';
import { Avatar, Button, Icon, Menu, MenuItem, MenuSeparator, MenuTrigger } from '@agentic-crm/ui';
import { useState } from 'react';
import { useMembers } from '../../attributes/data/queries';
import { memberName } from '../../attributes/format/formatValue';
import { MemberAvatar } from '../../attributes/ui/primitives';
import { useWorkspace } from '../../shell/workspaceContext';
import { putPermission, removePermission, useWs } from '../data';
import type { PermissionGrant } from '../types';
import * as s from './share.css';

export const LEVELS: { id: AccessScope; label: string; description: string }[] = [
  { id: 'full-access', label: 'Full access', description: 'Can manage workflow permissions' },
  { id: 'read-write', label: 'Read and write', description: 'Can update the workflow' },
  { id: 'read-only', label: 'Read only', description: 'Can only view the workflow' },
  { id: 'no-access', label: 'No access', description: 'Has no access to the workflow' },
];

export const levelLabel = (level: AccessScope) => LEVELS.find((l) => l.id === level)?.label ?? level;

export function LevelMenu({
  level,
  onChange,
  onRemove,
  disabled,
  bordered,
  testId,
}: {
  level: AccessScope;
  onChange: (level: AccessScope) => void;
  onRemove?: () => void;
  disabled?: boolean;
  bordered?: boolean;
  testId?: string;
}) {
  return (
    <MenuTrigger>
      <Button variant={bordered ? 'secondary' : 'ghost'} size={28} chevron isDisabled={disabled} data-testid={testId}>
        {levelLabel(level)}
      </Button>
      <Menu
        aria-label="Access level"
        placement="bottom end"
        width={260}
        selectionMode="single"
        selectedKeys={[level]}
        onAction={(k) => {
          if (k === 'remove') onRemove?.();
          else onChange(k as AccessScope);
        }}
      >
        {LEVELS.map((l) => (
          <MenuItem key={l.id} id={l.id} description={l.description}>
            {l.label}
          </MenuItem>
        ))}
        {onRemove && <MenuSeparator />}
        {onRemove && (
          <MenuItem id="remove" icon="delete" variant="danger">
            Remove access
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );
}

export function WorkspaceRow({
  workflowId,
  grant,
  canManage,
  subtitle,
}: {
  workflowId: string;
  grant: PermissionGrant | undefined;
  canManage: boolean;
  subtitle?: string;
}) {
  const ws = useWs();
  const { workspace } = useWorkspace();
  return (
    <div className={s.workspaceRow} data-testid="workspace-access">
      <Avatar name={workspace.name} src={workspace.logoUrl} kind="workspace" size={subtitle ? 40 : 32} />
      <span className={s.rowText}>
        <span className={s.rowTitle}>Workspace access</span>
        {subtitle && <span className={s.rowSub}>{subtitle}</span>}
      </span>
      <LevelMenu
        level={grant?.level ?? 'full-access'}
        disabled={!canManage}
        bordered={Boolean(subtitle)}
        testId="workspace-level"
        onChange={(level) => void putPermission(ws, { resourceId: workflowId, target: { type: 'workspace' }, level })}
      />
    </div>
  );
}

export function MemberRows({
  workflowId,
  grants,
  canManage,
}: {
  workflowId: string;
  grants: PermissionGrant[];
  canManage: boolean;
}) {
  const ws = useWs();
  const members = useMembers();
  return (
    <>
      {grants.map((g) => {
        const m = members.find((x) => x.id === g.target.id);
        return (
          <div key={`${g.target.type}:${g.target.id}`} className={s.memberRow} data-testid="member-access">
            {g.target.type === 'member' ? <MemberAvatar member={m} size={20} /> : <Icon icon="people" size={16} />}
            <span className={s.memberName}>{g.targetName ?? memberName(m) ?? 'Unknown'}</span>
            {g.targetDetail && <span className={s.memberEmail}>{g.targetDetail}</span>}
            <span style={{ flex: 1 }} />
            <LevelMenu
              level={g.level}
              disabled={!canManage}
              onChange={(level) =>
                void putPermission(ws, {
                  resourceId: workflowId,
                  target: { type: g.target.type as 'member', id: g.target.id },
                  level,
                })
              }
              onRemove={() =>
                void removePermission(ws, {
                  resourceId: workflowId,
                  target: { type: g.target.type as 'member', id: g.target.id },
                })
              }
            />
          </div>
        );
      })}
    </>
  );
}

/** Search a member + level + Add (disabled until a member is chosen). */
export function AddMember({
  workflowId,
  granted,
  canManage,
}: {
  workflowId: string;
  granted: string[];
  canManage: boolean;
}) {
  const ws = useWs();
  const members = useMembers();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [level, setLevel] = useState<AccessScope>('full-access');
  const q = query.trim().toLowerCase();
  const matches = q
    ? members
        .filter((m) => !granted.includes(m.id))
        .filter((m) => `${memberName(m)} ${m.emailAddress}`.toLowerCase().includes(q))
        .slice(0, 6)
    : [];
  return (
    <div className={s.addBlock}>
      <div className={s.addRow}>
        <div className={s.search}>
          <input
            className={s.searchInput}
            placeholder="Search..."
            aria-label="Search members"
            value={query}
            disabled={!canManage}
            onChange={(e) => {
              setQuery(e.target.value);
              setChosen(null);
            }}
          />
          <LevelMenu level={level} onChange={setLevel} disabled={!canManage} />
        </div>
        <Button
          variant="primary"
          size={28}
          isDisabled={!chosen}
          onPress={() => {
            if (!chosen) return;
            void putPermission(ws, { resourceId: workflowId, target: { type: 'member', id: chosen }, level });
            setChosen(null);
            setQuery('');
          }}
        >
          Add
        </Button>
      </div>
      {matches.length > 0 && !chosen && (
        <div className={s.suggestions}>
          {matches.map((m) => (
            <button
              key={m.id}
              type="button"
              className={s.suggestion}
              onClick={() => {
                setChosen(m.id);
                setQuery(memberName(m));
              }}
            >
              <MemberAvatar member={m} size={16} />
              {memberName(m)}
              <span className={s.memberEmail}>{m.emailAddress}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
