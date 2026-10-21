// "Add participant" of the New meeting dialog: workspace members, people records (by their email
// address) and a typed address ("Add jane@example.com"), in the shared picker list.
import { Avatar, Icon } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, inWorkspace } from '../../data/trpc';
import { useMembers } from '../attributes';
import { type PickerItem, PickerPanel } from '../attributes/editors/shell';
import { memberName } from '../attributes/format/formatValue';
import { useWsRef } from './data';
import { parseTypedParticipant } from './model';

export interface PickedParticipant {
  /** Unique within a meeting: `m:<memberId>` or the lower-cased address. */
  key: string;
  memberId: string | null;
  emailAddress: string | null;
  name: string | null;
  personId: string | null;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const Row = ({ avatar, title, subtitle }: { avatar: React.ReactNode; title: string; subtitle?: string | null }) => (
  <>
    {avatar}
    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      {subtitle && (
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 12,
            lineHeight: '16px',
            opacity: 0.6,
          }}
        >
          {subtitle}
        </span>
      )}
    </span>
  </>
);

export function ParticipantPicker({
  taken,
  onPick,
}: {
  taken: ReadonlySet<string>;
  onPick: (participant: PickedParticipant) => void;
}) {
  const ws = useWsRef();
  const members = useMembers();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 120);
  const people = useQuery({
    queryKey: ['ws', ws.id, 'record-search', 'meeting-participants', debounced],
    queryFn: () =>
      api.search.records.query({ query: debounced, entityDefinitionIds: ['people'], limit: 8 }, inWorkspace(ws)),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: PickerItem[] = [];
    for (const m of members) {
      const key = `m:${m.id}`;
      if (taken.has(key)) continue;
      if (q && !`${memberName(m)} ${m.emailAddress}`.toLowerCase().includes(q)) continue;
      out.push({
        key,
        padded: true,
        labelBefore: out.length === 0 ? 'Workspace members' : undefined,
        textValue: memberName(m),
        content: (
          <Row
            avatar={<Avatar name={memberName(m)} kind="member" size={20} seed={m.id} />}
            title={memberName(m)}
            subtitle={m.emailAddress}
          />
        ),
        onSelect: () =>
          onPick({ key, memberId: m.id, emailAddress: m.emailAddress, name: memberName(m), personId: null }),
      });
    }
    let firstPerson = true;
    for (const hit of people.data?.hits ?? []) {
      const address = hit.emailAddresses[0];
      if (!address) continue;
      const key = address.toLowerCase();
      if (taken.has(key) || members.some((m) => m.emailAddress.toLowerCase() === key)) continue;
      out.push({
        key: `p:${hit.entityInstanceId}`,
        padded: true,
        labelBefore: firstPerson ? 'People' : undefined,
        separatorBefore: firstPerson && out.length > 0,
        textValue: hit.title ?? address,
        content: (
          <Row
            avatar={<Avatar name={hit.title ?? address} kind="person" size={20} seed={hit.entityInstanceId} />}
            title={hit.title ?? address}
            subtitle={address}
          />
        ),
        onSelect: () =>
          onPick({ key, memberId: null, emailAddress: address, name: hit.title, personId: hit.entityInstanceId }),
      });
      firstPerson = false;
    }
    const typed = parseTypedParticipant(query);
    if (typed && !taken.has(typed.emailAddress) && !out.some((i) => i.key === typed.emailAddress)) {
      out.push({
        key: `e:${typed.emailAddress}`,
        padded: true,
        separatorBefore: out.length > 0,
        textValue: typed.emailAddress,
        content: (
          <>
            <Icon icon="add" size={16} />
            <span>Add {typed.emailAddress}</span>
          </>
        ),
        onSelect: () =>
          onPick({
            key: typed.emailAddress,
            memberId: null,
            emailAddress: typed.emailAddress,
            name: typed.name,
            personId: null,
          }),
      });
    }
    return out;
  }, [members, people.data, query, taken, onPick]);

  return (
    <PickerPanel
      placeholder="Search people or type an email..."
      query={query}
      onQueryChange={setQuery}
      items={items}
      isLoading={people.isPending}
      emptyText={people.isPending ? 'Searching...' : 'No results'}
      label="Participants"
    />
  );
}
