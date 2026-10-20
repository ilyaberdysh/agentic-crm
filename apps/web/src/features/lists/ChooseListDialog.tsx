// "Choose list" (C2 README §2.5 B.1 / C.1; D README §3.6; raw C2 s46-record-addtolist, s52-bulk-choose): "Search
// lists...", section **Lists** — only lists whose parent object matches, each with its emoji and, from a record page,
// the number of this record's entries in it — then "Create new list"; footer "↑ ↓ Navigate" · "Select list ↵".
import type { RecordRef } from '@agentic-crm/contracts';
import { Icon } from '@agentic-crm/ui';
import { useMemo, useState } from 'react';
import { useWorkspace } from '../shell/workspaceContext';
import { type List, sortLists, useLists, useRecordMemberships } from './data';
import { ListIcon } from './icon';
import * as s from './lists.css';
import { PickerDialog, type PickerItem } from './PickerDialog';

export function ChooseListDialog({
  objectId,
  record,
  onPick,
  onCreate,
  onClose,
}: {
  /** The records' object: only lists that accept it are offered. */
  objectId: string;
  /** Record page: counts of its existing entries per list. */
  record?: RecordRef;
  onPick: (list: List) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const lists = useLists(workspace);
  const memberships = useRecordMemberships(workspace, record ?? null);
  const [query, setQuery] = useState('');
  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const m of memberships.data ?? []) out.set(m.listId, (out.get(m.listId) ?? 0) + 1);
    return out;
  }, [memberships.data]);
  const q = query.trim().toLowerCase();
  const matching = sortLists(lists.data ?? [], 'custom').filter(
    (l) =>
      (l.parentEntityDefinitionIds.length === 0 || l.parentEntityDefinitionIds.includes(objectId)) &&
      (!q || l.name.toLowerCase().includes(q)),
  );
  const items: PickerItem[] = matching.map((l) => {
    const n = counts.get(l.id) ?? 0;
    return {
      key: l.id,
      icon: (
        <span className={s.rowTile}>
          <ListIcon icon={l.icon} size={16} />
        </span>
      ),
      label: l.name,
      trailing: n > 0 ? <span className={s.countBadge}>{n}</span> : undefined,
      onSelect: () => onPick(l),
      testId: 'choose-list-option',
    };
  });
  const create: PickerItem = {
    key: 'create',
    icon: (
      <span className={s.rowTile}>
        <Icon icon="listAdd" size={14} />
      </span>
    ),
    label: 'Create new list',
    onSelect: onCreate,
    testId: 'choose-list-create',
  };
  return (
    <PickerDialog
      label="Choose list"
      title="Choose list"
      onClose={onClose}
      search={{ value: query, onChange: setQuery, placeholder: 'Search lists...' }}
      primaryLabel="Select list"
      testId="choose-list-dialog"
      sections={[{ key: 'lists', label: 'Lists', items: [...items, create] }]}
    />
  );
}
