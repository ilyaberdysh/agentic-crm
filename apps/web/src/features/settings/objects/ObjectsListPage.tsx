// Settings → Objects (J objects-lists §1; evidence/J/objects-list.png): header with "+ New custom object", search and
// Filter (Only show standard / Only show custom), and the objects table — Object (usage badge) · Type · Records ·
// Attributes · ⋮ (Edit, Copy ID). Standard objects that are not activated yet show "Activate". Custom objects first,
// then standard ones alphabetically.
import type { EntityDefinition } from '@agentic-crm/contracts';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  SearchField,
  Skeleton,
  toast,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, useMemo, useState } from 'react';
import type { WorkspaceRef } from '../../../data/trpc';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import * as shell from '../../shell/shell.css';
import { useWorkspace } from '../../shell/workspaceContext';
import { CreateObjectDialog } from './CreateObjectDialog';
import {
  activateObject,
  useAttributes,
  useCapabilities,
  useRecordCount,
  useSettingsObjects,
  writeErrorOf,
} from './data';
import * as s from './objects.css';
import { copyToClipboard, ObjectTile, ObjectTypePill } from './parts';

type TypeFilter = 'standard' | 'custom';

/**
 * Custom objects first (by rank), then standard objects alphabetically (observed order). Deleted custom objects
 * (archived) are gone; standard objects that are not activated stay listed with "Activate".
 */
export function sortSettingsObjects(objects: readonly EntityDefinition[]): EntityDefinition[] {
  const custom = objects
    .filter((o) => o.entityType === 'custom-record' && !o.isArchived)
    .sort((a, b) => (a.sortOrder ?? '~').localeCompare(b.sortOrder ?? '~') || a.createdAt.localeCompare(b.createdAt));
  const standard = objects
    .filter((o) => o.entityType !== 'custom-record')
    .sort((a, b) => a.pluralNoun.localeCompare(b.pluralNoun));
  return [...custom, ...standard];
}

export function filterSettingsObjects(
  objects: readonly EntityDefinition[],
  query: string,
  types: ReadonlySet<TypeFilter>,
): EntityDefinition[] {
  const q = query.trim().toLowerCase();
  return objects.filter((o) => {
    const custom = o.entityType === 'custom-record';
    if (types.has('standard') && !types.has('custom') && custom) return false;
    if (types.has('custom') && !types.has('standard') && !custom) return false;
    return !q || o.pluralNoun.toLowerCase().includes(q) || o.apiSlug.includes(q);
  });
}

export function ObjectsListPage() {
  useDocumentTitle('Objects');
  const { workspace, href, isAdmin } = useWorkspace();
  const objectsHref = href('settings/data/objects');
  const objects = useSettingsObjects(workspace);
  const capabilities = useCapabilities(workspace);
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<Set<TypeFilter>>(new Set());
  const [creating, setCreating] = useState(false);

  const sorted = useMemo(() => sortSettingsObjects(objects.data ?? []), [objects.data]);
  const visible = filterSettingsObjects(sorted, query, types);
  const activeCount = sorted.filter((o) => !o.isArchived).length;
  const limit = capabilities.data?.quotas.objects_per_workspace_hard ?? null;
  const atLimit = limit !== null && activeCount >= limit;

  return (
    <>
      <PageHeader crumbs={[{ label: 'Objects', icon: 'object' }]} actions={<HelpButton />} />
      <div className={shell.content}>
        <div className={s.page}>
          <div className={s.headerRow}>
            <div>
              <h1 className={s.pageTitle}>Objects</h1>
              <p className={s.pageDescription}>Modify and add objects in your workspace</p>
            </div>
            {isAdmin && (
              <Button
                size={28}
                icon="add"
                aria-label="Create custom object"
                isDisabled={atLimit}
                onPress={() => setCreating(true)}
              >
                New custom object
              </Button>
            )}
          </div>
          <div className={s.pageRule} />
          {!isAdmin ? (
            <EmptyState
              icon="object"
              title="No objects"
              description="You do not have access to manage any objects"
              style={{ padding: '48px 24px' }}
            />
          ) : (
            <>
              <div className={s.toolbar}>
                <SearchField
                  aria-label="Search objects"
                  placeholder="Search objects"
                  size={32}
                  value={query}
                  onChange={setQuery}
                  className={s.toolbarSearch}
                />
                <MenuTrigger>
                  <Button variant="secondary" size={32} icon="filter" isActive={types.size > 0}>
                    Filter
                  </Button>
                  <Menu
                    aria-label="Filter objects"
                    placement="bottom end"
                    width={220}
                    selectionMode="multiple"
                    selectedKeys={types}
                    onSelectionChange={(keys) => setTypes(new Set([...(keys as Set<TypeFilter>)]))}
                  >
                    <MenuItem id="standard">Only show standard</MenuItem>
                    <MenuItem id="custom">Only show custom</MenuItem>
                  </Menu>
                </MenuTrigger>
              </div>
              <div className={s.table} role="table" aria-label="Objects">
                <div className={`${s.tableHeader} ${s.objectsGrid}`} role="row">
                  <div className={s.headerCell} role="columnheader">
                    <Icon icon="object" size={14} className={s.headerIcon} />
                    Object
                    {objects.data && (
                      <Badge variant="tertiary" size={16} className={s.usageBadge}>
                        {limit === null ? activeCount : `${activeCount}/${limit}`}
                      </Badge>
                    )}
                  </div>
                  <div className={s.headerCell} role="columnheader">
                    <Icon icon="table" size={14} className={s.headerIcon} />
                    Type
                  </div>
                  <div className={s.headerCell} role="columnheader">
                    <Icon icon="record" size={14} className={s.headerIcon} />
                    Records
                  </div>
                  <div className={s.headerCell} role="columnheader">
                    <Icon icon="apps" size={14} className={s.headerIcon} />
                    Attributes
                  </div>
                  <div role="columnheader" aria-label="Actions" />
                </div>
                {objects.isPending &&
                  [0, 1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className={`${s.row} ${s.objectsGrid}`} data-static role="row">
                      <Skeleton shape="text" width={120} />
                      <Skeleton shape="text" width={60} />
                      <Skeleton shape="text" width={40} />
                      <Skeleton shape="text" width={24} />
                    </div>
                  ))}
                {objects.isError && (
                  <ErrorState
                    message="Failed to load objects"
                    iconSize={16}
                    style={{ padding: 24 }}
                    actions={
                      <Button variant="secondary" size={28} onPress={() => void objects.refetch()}>
                        Retry
                      </Button>
                    }
                  />
                )}
                {visible.map((o) => (
                  <ObjectRow key={o.id} object={o} workspace={workspace} objectsHref={objectsHref} />
                ))}
                {objects.data && visible.length === 0 && (
                  <div className={s.tableEmpty}>No objects match that filter</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <CreateObjectDialog
        workspace={workspace}
        isOpen={creating}
        onOpenChange={setCreating}
        objectsHref={objectsHref}
      />
    </>
  );
}

function ObjectRow({
  object,
  workspace,
  objectsHref,
}: {
  object: EntityDefinition;
  workspace: WorkspaceRef;
  objectsHref: string;
}) {
  const navigate = useNavigate();
  const count = useRecordCount(workspace, object);
  const attributes = useAttributes(workspace, object.isArchived ? null : object.id);
  const [activating, setActivating] = useState(false);
  const open = () => void navigate({ href: `${objectsHref}/${object.apiSlug}/general` });
  const attributeCount = attributes.data?.filter((a) => !a.isArchived).length;

  async function activate() {
    setActivating(true);
    try {
      await activateObject(workspace, object.id);
      toast.success(`${object.pluralNoun} object was activated`);
    } catch (error) {
      toast.error({
        title: `Failed to activate ${object.pluralNoun} object`,
        description: writeErrorOf(error).message,
      });
    } finally {
      setActivating(false);
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open();
    }
  };

  return (
    <div
      className={`${s.row} ${s.objectsGrid}`}
      role="row"
      tabIndex={0}
      data-static={object.isArchived || undefined}
      onClick={object.isArchived ? undefined : open}
      onKeyDown={object.isArchived ? undefined : onKeyDown}
    >
      <div className={s.cell} role="cell">
        <ObjectTile object={object} />
        <span className={s.cellText}>{object.pluralNoun}</span>
      </div>
      <div className={s.cell} role="cell">
        <ObjectTypePill object={object} />
      </div>
      <div className={s.cell} role="cell">
        {object.isArchived ? (
          <span className={s.muted}>Not activated</span>
        ) : count.data === undefined ? (
          <Skeleton shape="text" width={32} />
        ) : count.data === 0 ? (
          <span className={s.muted}>No records</span>
        ) : (
          count.data.toLocaleString()
        )}
      </div>
      <div className={s.cell} role="cell">
        {object.isArchived ? '' : attributeCount === undefined ? <Skeleton shape="text" width={20} /> : attributeCount}
      </div>
      <div
        className={s.rowActions}
        role="cell"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {object.isArchived && (
          <Button variant="secondary" size={28} isPending={activating} onPress={() => void activate()}>
            {activating ? 'Activating' : 'Activate'}
          </Button>
        )}
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="Options" variant="ghost" size={28} />
          <Menu aria-label="Options" placement="bottom end" width={120}>
            {!object.isArchived && (
              <MenuItem icon="edit" onAction={open}>
                Edit
              </MenuItem>
            )}
            <MenuItem icon="copy" onAction={() => void copyToClipboard(object.id, (t) => toast(t, { icon: 'copy' }))}>
              Copy ID
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
    </div>
  );
}
