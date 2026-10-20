// Record page Lists section (C2 README §2.5 B; D README §2.3, §3.6; raw C2 s47-record-after, s48-entry-options,
// s48-lists-more; evidence/C2/entry-remove-confirm.png): header "Lists <n> ⌄" with a gear (View mode Standard /
// Compact, Show attribute name) and "+" (Choose list); one card per entry — list emoji + name + "added" time (hover:
// Comment, ⋮ Manage attributes / Remove from list), its first three list attributes edited in place and "Show more";
// empty: "This record has not been added to any lists".
import type { RecordRef } from '@agentic-crm/contracts';
import {
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Switch,
  Tooltip,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { usePersistentState } from '../../lib/storage';
import { timeAgo } from '../comments/timeAgo';
import { AttributeRow } from '../record/details/AttributeRow';
import * as d from '../record/details/details.css';
import { useWorkspace } from '../shell/workspaceContext';
import {
  type List,
  type Membership,
  useListAttributes,
  useLists,
  useRecordMemberships,
  writableListAttributes,
} from './data';
import { listPath, RemoveEntriesDialog } from './flows';
import { ListIcon } from './icon';
import * as s from './recordLists.css';

const PREVIEW_ATTRIBUTES = 3;

export interface RecordListsSectionProps {
  recordRef: RecordRef;
  /** Opens "Choose list" (the record page's `choose-list` dialog). */
  onAdd: () => void;
  /** Entry comments: the record page opens the list's comments for the entry. */
  onComment?: (membership: Membership) => void;
}

export function RecordListsSection({ recordRef, onAdd, onComment }: RecordListsSectionProps) {
  const { workspace } = useWorkspace();
  const memberships = useRecordMemberships(workspace, recordRef);
  const lists = useLists(workspace);
  const [collapsed, setCollapsed] = useState(false);
  const [compact, setCompact] = usePersistentState<boolean>('record-list-section:compact-cards', false);
  const [showNames, setShowNames] = usePersistentState<boolean>('record-list-section:show-attribute-name', true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const byId = useMemo(() => new Map((lists.data ?? []).map((l) => [l.id, l])), [lists.data]);
  const rows = (memberships.data ?? [])
    .map((m) => ({ m, list: byId.get(m.listId) }))
    .filter((r): r is { m: Membership; list: List } => Boolean(r.list));
  return (
    <section className={d.section} aria-label="Lists" data-testid="lists-section">
      <div className={d.sectionHeader}>
        <button
          type="button"
          className={d.sectionToggle}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          Lists
          {rows.length > 0 && <span className={s.count}>{rows.length}</span>}
          <Icon icon="chevronDown" size={12} className={d.chevron} data-collapsed={collapsed || undefined} />
        </button>
        <span className={s.headerActions} data-open={settingsOpen || undefined}>
          <MenuTrigger onOpenChange={setSettingsOpen}>
            <IconButton icon="settings" aria-label="Lists section settings" variant="ghost" size={20} />
            <Menu
              aria-label="Lists section settings"
              placement="bottom end"
              width={240}
              selectionMode="single"
              selectedKeys={[compact ? 'compact' : 'standard']}
              onSelectionChange={(keys) => {
                const next = [...(keys as Set<string>)][0];
                if (next === 'standard' || next === 'compact') setCompact(next === 'compact');
              }}
            >
              <MenuSection title="View mode">
                <MenuItem id="standard">Standard</MenuItem>
                <MenuItem id="compact">Compact</MenuItem>
              </MenuSection>
              <MenuSeparator />
              <MenuItem id="names" onAction={() => setShowNames(!showNames)} textValue="Show attribute name">
                <span className={s.switchRow}>
                  Show attribute name
                  <Switch isSelected={showNames} aria-label="Show attribute name" onChange={setShowNames} />
                </span>
              </MenuItem>
            </Menu>
          </MenuTrigger>
          <Tooltip content="Add to list">
            <IconButton icon="add" aria-label="Add to list" variant="ghost" size={20} onPress={onAdd} />
          </Tooltip>
        </span>
      </div>
      {!collapsed &&
        (rows.length === 0 ? (
          <div className={d.listsEmpty}>
            {memberships.isPending ? '' : 'This record has not been added to any lists'}
          </div>
        ) : (
          <div className={s.cards}>
            {rows.map(({ m, list }) => (
              <EntryCard
                key={m.entryId}
                list={list}
                membership={m}
                parent={recordRef}
                compact={compact}
                showNames={showNames}
                onComment={onComment}
              />
            ))}
          </div>
        ))}
    </section>
  );
}

function EntryCard({
  list,
  membership,
  parent,
  compact,
  showNames,
  onComment,
}: {
  list: List;
  membership: Membership;
  parent: RecordRef;
  compact: boolean;
  showNames: boolean;
  onComment?: (membership: Membership) => void;
}) {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const attributes = useListAttributes(workspace, list.id);
  const fields = useMemo(() => writableListAttributes(attributes.data ?? []), [attributes.data]);
  const [expanded, setExpanded] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const entryRef = useMemo(
    () => ({ entityDefinitionId: list.id, entityInstanceId: membership.entryId }),
    [list.id, membership.entryId],
  );
  const shown = expanded ? fields : fields.slice(0, PREVIEW_ATTRIBUTES);
  return (
    <div className={s.card} data-testid="list-entry-card" data-list-id={list.id}>
      <div className={s.cardHeader}>
        <a
          className={s.cardTitle}
          href={href(listPath(list))}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) return;
            e.preventDefault();
            void navigate({ href: href(listPath(list)) });
          }}
        >
          <ListIcon icon={list.icon} size={18} />
          <span className={s.cardTitleText}>{list.name}</span>
        </a>
        <span className={s.cardTime} data-hidden={menuOpen || undefined}>
          {membership.addedAt ? timeAgo(membership.addedAt) : ''}
        </span>
        <span className={s.cardActions} data-open={menuOpen || undefined}>
          <IconButton
            icon="comment"
            aria-label="Comment"
            tooltip="Comment"
            variant="ghost"
            size={20}
            onPress={() => onComment?.(membership)}
          />
          <MenuTrigger onOpenChange={setMenuOpen}>
            <IconButton icon="moreVertical" aria-label="Options" variant="ghost" size={20} />
            <Menu
              aria-label="Entry options"
              placement="bottom end"
              width={180}
              onAction={(key) => {
                if (key === 'attributes') void navigate({ href: href(`settings/data/lists/${list.id}/attributes`) });
                if (key === 'remove') setRemoving(true);
              }}
            >
              <MenuItem id="attributes" icon="apps">
                Manage attributes
              </MenuItem>
              <MenuItem id="remove" icon="delete" variant="danger">
                Remove from list
              </MenuItem>
            </Menu>
          </MenuTrigger>
        </span>
      </div>
      {!compact && shown.length > 0 && (
        <div className={s.cardBody} data-hide-names={showNames ? undefined : ''}>
          {shown.map((a) => (
            <AttributeRow key={a.id} attribute={a} recordRef={entryRef} />
          ))}
          {fields.length > PREVIEW_ATTRIBUTES && (
            <button type="button" className={`${d.viewAll} ${s.showMore}`} onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
      {removing && (
        <RemoveEntriesDialog
          list={list}
          entryIds={[membership.entryId]}
          parents={[parent]}
          onClose={() => setRemoving(false)}
        />
      )}
    </div>
  );
}
