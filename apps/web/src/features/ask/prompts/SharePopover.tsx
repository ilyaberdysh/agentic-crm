// Share popover of a prompt (ask-agentic §11.2): "Workspace access" with its level, a member search with a level and
// Add, and the individual members with their levels. Levels: Full access, Read and write, Read only, No access.
import { type PromptAccessLevel, promptAccessLevels } from '@agentic-crm/contracts';
import { Avatar, Button, Icon, Popover, Select, SelectItem, toast } from '@agentic-crm/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorEnvelopeOf, inWorkspace } from '../../../data/trpc';
import { useMembers } from '../../attributes/data/queries';
import { memberName } from '../../attributes/format/formatValue';
import { useWorkspace } from '../../shell/workspaceContext';
import { sharePrompt, usePromptSharing } from '../data';
import * as s from './prompts.css';

export const ACCESS_LABEL: Record<PromptAccessLevel, string> = {
  'full-access': 'Full access',
  'read-write': 'Read and write',
  'read-only': 'Read only',
  'no-access': 'No access',
};

const PROMPT_ACCESS_HELP: Record<PromptAccessLevel, string> = {
  'full-access': 'Can manage prompt permissions',
  'read-write': 'Can update the prompt',
  'read-only': 'Can only view the prompt',
  'no-access': 'Has no access to the prompt',
};

function LevelSelect({
  value,
  onChange,
  label,
}: {
  value: PromptAccessLevel;
  onChange: (level: PromptAccessLevel) => void;
  label: string;
}) {
  return (
    <Select
      aria-label={label}
      size={28}
      selectedKey={value}
      onSelectionChange={(k) => onChange(String(k) as PromptAccessLevel)}
      items={promptAccessLevels.map((id) => ({ id }))}
      menuWidth={240}
    >
      {(item: { id: PromptAccessLevel }) => (
        <SelectItem id={item.id} description={PROMPT_ACCESS_HELP[item.id]}>
          {ACCESS_LABEL[item.id]}
        </SelectItem>
      )}
    </Select>
  );
}

function SharePanel({ promptId }: { promptId: string }) {
  const { workspace } = useWorkspace();
  const client = useQueryClient();
  const members = useMembers();
  const sharing = usePromptSharing(promptId);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<PromptAccessLevel>('read-only');
  const ws = { id: workspace.id, slug: workspace.slug };
  const found = useQuery({
    queryKey: ['ws', ws.id, 'ask-share-search', query],
    queryFn: () => api.search.members.query({ query, limit: 5 }, inWorkspace(ws)),
    enabled: query.trim().length > 0,
  });
  const data = sharing.data;
  const apply = async (input: {
    workspaceAccess?: PromptAccessLevel;
    members?: { memberId: string; access: PromptAccessLevel }[];
  }) => {
    try {
      await sharePrompt(client, ws, { promptId, ...input });
    } catch (e) {
      toast.error({ title: 'Failed to update access', description: errorEnvelopeOf(e).message });
    }
  };
  if (!data) return <div className={s.share}>Loading…</div>;
  const taken = new Set(data.members.map((m) => m.memberId));
  return (
    <div className={s.share} data-testid="prompt-share">
      <div className={s.shareRow}>
        <Icon icon="workspace" size={16} />
        <span className={s.shareName}>Workspace access</span>
        <LevelSelect
          label="Workspace access"
          value={data.workspaceAccess}
          onChange={(workspaceAccess) => void apply({ workspaceAccess })}
        />
      </div>
      <div>
        <div className={s.shareLabel}>Add members</div>
        <div className={s.sharePicker}>
          <input
            className={s.titleInput}
            placeholder="Search members"
            aria-label="Search members"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <LevelSelect label="Access level" value={level} onChange={setLevel} />
        </div>
        {query.trim() && (
          <div className={s.shareResults}>
            {(found.data?.hits ?? [])
              .filter((m) => !taken.has(m.id))
              .map((m) => {
                const name = memberName(m);
                return (
                  <div key={m.id} className={s.shareRow} style={{ minHeight: 32 }}>
                    <Avatar name={name} seed={m.id} size={20} kind="member" />
                    <span className={s.shareName}>{name}</span>
                    <Button
                      variant="secondary"
                      size={28}
                      onPress={() => {
                        setQuery('');
                        void apply({ members: [{ memberId: m.id, access: level }] });
                      }}
                    >
                      Add
                    </Button>
                  </div>
                );
              })}
          </div>
        )}
      </div>
      {data.members.length > 0 && (
        <div>
          <div className={s.shareLabel}>Individual members</div>
          {data.members.map((entry) => {
            const m = members.find((x) => x.id === entry.memberId);
            const name = (m ? memberName(m) : '') || 'Member';
            return (
              <div key={entry.memberId} className={s.shareRow} style={{ minHeight: 36 }}>
                <Avatar name={name} seed={entry.memberId} size={20} kind="member" />
                <span className={s.shareName}>{name}</span>
                <LevelSelect
                  label={`Access of ${name}`}
                  value={entry.access}
                  onChange={(access) => void apply({ members: [{ memberId: entry.memberId, access }] })}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SharePopover({ promptId }: { promptId: string }) {
  return (
    <Popover
      placement="bottom end"
      padding={0}
      aria-label="Share prompt"
      trigger={
        <Button variant="secondary" size={28} icon="share" data-testid="prompt-share-button">
          Share
        </Button>
      }
    >
      <SharePanel promptId={promptId} />
    </Popover>
  );
}
