// List settings `/settings/data/lists/$listId/<tab>` (J objects-lists §4.2; evidence/J/list-configuration-parent-
// object.png): crumb "Lists / <emoji> <name>", "‹ Back", 56 px emoji tile + name + "Manage attributes, permissions and
// other relevant settings" + "↗ Go to list"; tabs Configuration · Permissions · Attributes <n> · Templates ·
// Notifications <n> · Imports.
//   Configuration  General (emoji button + List name, saved on blur; Parent object select → "Change parent object"
//                  confirmation) and Danger zone (Delete list)
//   Permissions    workspace access level (Full access / Read and write / Read only / No access)
//   Attributes     the object attribute admin (features/settings) on the list's entry definition
import type { EntityDefinition } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  EmptyState,
  Icon,
  Select,
  SelectItem,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextInput,
  toast,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton, Link } from 'react-aria-components';
import { sortObjects, useObjects } from '../../../data/objects';
import { errorEnvelopeOf, httpStatusOf } from '../../../data/trpc';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { useEntityAccess } from '../../access/useEntityAccess';
import { EmojiPickerPopover } from '../../comments/emoji/EmojiPicker';
import { AttributesTab } from '../../settings/objects/attributes/AttributesTab';
import * as os from '../../settings/objects/objects.css';
import { SectionHeader } from '../../settings/objects/parts';
import { PermissionsTab } from '../../settings/permissions/PermissionsTab';
import { ContentSpinner } from '../../shell/AppShell';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import * as shell from '../../shell/shell.css';
import { useWorkspace } from '../../shell/workspaceContext';
import {
  type List,
  setListAccess,
  updateList,
  useList,
  useListAttributes,
  useListDefinition,
  type WorkspaceAccess,
} from '../data';
import { listPath } from '../flows';
import { iconOfEmoji, ListIcon } from '../icon';
import { ListDialogs } from '../ListPage';
import * as s from '../lists.css';
import { ObjectIconTile } from '../parts';

export type ListTabId = 'general' | 'permissions' | 'attributes' | 'templates' | 'app' | 'imports';

const TABS: { id: ListTabId; label: string; icon: Parameters<typeof Tab>[0]['icon'] }[] = [
  { id: 'general', label: 'Configuration', icon: 'settings' },
  { id: 'permissions', label: 'Permissions', icon: 'lock' },
  { id: 'attributes', label: 'Attributes', icon: 'apps' },
  { id: 'templates', label: 'Templates', icon: 'template' },
  { id: 'app', label: 'Notifications', icon: 'notifications' },
  { id: 'imports', label: 'Imports', icon: 'import' },
];

export const LIST_TAB_IDS = TABS.map((t) => t.id);

export function ListSettingsPage({ listId, tab }: { listId: string; tab: ListTabId }) {
  const { workspace, href, isAdmin } = useWorkspace();
  const navigate = useNavigate();
  const listsHref = href('settings/data/lists');
  const list = useList(workspace, listId);
  const definition = useListDefinition(workspace, list.data?.id);
  const attributes = useListAttributes(workspace, list.data?.id);
  const access = useEntityAccess(list.data?.id);
  useDocumentTitle(list.data ? `${list.data.name} · Lists` : 'Lists');

  const crumbs = [
    { label: 'Lists', icon: 'list' as const, href: listsHref },
    ...(list.data ? [{ label: list.data.name, icon: <ListIcon icon={list.data.icon} size={16} /> }] : []),
  ];

  let body: ReactNode;
  if (list.isError && !list.data) {
    body = (
      <EmptyState
        icon="list"
        title={httpStatusOf(list.error) === 403 ? 'No access to this list' : 'List not available'}
        description={
          httpStatusOf(list.error) === 403
            ? 'You don’t have permission to access this collection’s settings'
            : 'This list either doesn’t exist or you don’t have permission to access it'
        }
        style={{ padding: '72px 24px' }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void navigate({ href: listsHref })}>
            Back to lists
          </Button>
        }
      />
    );
  } else if (!list.data) {
    body = <ContentSpinner />;
  } else if (access.known && !access.canAdministrate && !isAdmin) {
    // List settings need administrate_entity_definition_permissions (J permissions §3).
    body = (
      <EmptyState
        icon="lock"
        title="No access"
        description="You don’t have permission to access this collection’s settings"
        style={{ padding: '72px 24px' }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void navigate({ href: listsHref })}>
            Back to lists
          </Button>
        }
      />
    );
  } else {
    const l = list.data;
    const attributeCount = attributes.data?.filter((a) => !a.isArchived).length;
    const go = (id: ListTabId) => void navigate({ href: `${listsHref}/${l.id}/${id}` });
    body = (
      <div className={os.page} data-testid="list-settings">
        <Link href={listsHref} className={os.backLink}>
          <Icon icon="chevronLeft" size={14} />
          Back
        </Link>
        <div className={os.objectHeader}>
          <span className={s.listTile} style={{ width: 56, height: 56 }}>
            <ListIcon icon={l.icon} size={40} />
          </span>
          <div className={os.objectHeaderText} style={{ flex: 1 }}>
            <h1 className={os.objectTitle}>{l.name}</h1>
            <p className={os.pageDescription}>Manage attributes, permissions and other relevant settings</p>
          </div>
          <Button
            variant="secondary"
            size={28}
            icon="arrowUpRight"
            onPress={() => void navigate({ href: href(listPath(l)) })}
          >
            Go to list
          </Button>
        </div>
        <Tabs selectedKey={tab} onSelectionChange={(k) => go(k as ListTabId)} className={os.tabs}>
          <div className={os.tabRow}>
            <TabList aria-label="List settings">
              {TABS.map((t) => (
                <Tab
                  key={t.id}
                  id={t.id}
                  icon={t.icon}
                  count={t.id === 'attributes' ? attributeCount : t.id === 'app' ? 0 : undefined}
                >
                  {t.label}
                </Tab>
              ))}
            </TabList>
          </div>
          <TabPanel id={tab} className={os.tabPanel}>
            <ListTabContent list={l} definition={definition.data} tab={tab} />
          </TabPanel>
        </Tabs>
      </div>
    );
  }
  return (
    <>
      <PageHeader crumbs={crumbs} actions={<HelpButton />} />
      <div className={shell.content}>{body}</div>
    </>
  );
}

function ListTabContent({
  list,
  definition,
  tab,
}: {
  list: List;
  definition: EntityDefinition | undefined;
  tab: ListTabId;
}) {
  const access = useEntityAccess(list.id);
  const canEdit = access.canUpdateDefinition;
  switch (tab) {
    case 'general':
      return <ConfigurationTab list={list} canEdit={canEdit} />;
    case 'permissions':
      return <PermissionsTab kind="list" resourceId={list.id} />;
    case 'attributes':
      return definition ? <AttributesTab object={definition} canEdit={canEdit} /> : <ContentSpinner />;
    case 'templates':
      return (
        <EmptyState
          icon="template"
          title="No templates"
          description="List entry templates arrive in a later slice."
          className={os.placeholder}
        />
      );
    case 'app':
      return (
        <EmptyState
          icon="notifications"
          title="Slack app not installed"
          description="Install the Slack app and connect your workspace to enable notifications"
          className={os.placeholder}
        />
      );
    case 'imports':
      return (
        <EmptyState
          icon="import"
          title="No imports yet"
          description="You haven't imported any entries into this list yet"
          className={os.placeholder}
        />
      );
  }
}

// ---- configuration ------------------------------------------------------------------------------------------------

function ConfigurationTab({ list, canEdit }: { list: List; canEdit: boolean }) {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  // Settings list the objects in their workspace order (J list-configuration-parent-object.png).
  const sorted = useMemo(() => sortObjects(objects, 'custom'), [objects]);
  const [name, setName] = useState(list.name);
  useEffect(() => setName(list.name), [list.name]);
  const [picking, setPicking] = useState(false);
  const [pendingParent, setPendingParent] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'delete' | null>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const parentId = list.parentEntityDefinitionIds.length === 1 ? list.parentEntityDefinitionIds[0] : null;

  const patch = async (p: Parameters<typeof updateList>[2], label: string) => {
    try {
      await updateList(workspace, list, p);
    } catch (error) {
      toast.error({ title: `Failed to update ${label}`, description: errorEnvelopeOf(error).message });
    }
  };
  const saveName = () => {
    const next = name.trim();
    if (!next) {
      setName(list.name);
      return;
    }
    if (next !== list.name) void patch({ name: next }, 'list name');
  };

  return (
    <div className={os.sections}>
      <section className={os.section} aria-label="General">
        <SectionHeader
          title="General"
          description="Define the name and what type of records can be added to the list"
        />
        <div className={os.fieldGrid}>
          <div className={os.nounRow}>
            <AriaButton
              ref={iconRef}
              className={s.iconButton}
              style={{ width: 32, height: 32 }}
              aria-label="Change list icon"
              isDisabled={!canEdit}
              onPress={() => setPicking(true)}
            >
              <ListIcon icon={list.icon} size={18} />
            </AriaButton>
            <TextInput
              label="List name"
              size={32}
              value={name}
              onChange={setName}
              isDisabled={!canEdit}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setName(list.name);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              style={{ flex: 1 }}
            />
          </div>
          <div className={s.field} style={{ gap: 4 }}>
            <span className={s.fieldLabel} style={{ paddingLeft: 0 }}>
              Parent object
            </span>
            <Select
              aria-label="Parent object"
              size={32}
              searchable
              placeholder="Mixed"
              isDisabled={!canEdit}
              selectedKey={parentId}
              onSelectionChange={(key) => {
                const next = String(key);
                if (next !== parentId) setPendingParent(next);
              }}
              items={sorted}
            >
              {(o) => (
                <SelectItem id={o.id} textValue={o.pluralNoun} icon={<ObjectIconTile object={o} />}>
                  {o.pluralNoun}
                </SelectItem>
              )}
            </Select>
          </div>
        </div>
      </section>

      {canEdit && (
        <section className={os.section} aria-label="Danger zone">
          <h2 className={os.sectionTitle}>Danger zone</h2>
          <div className={os.dangerCard}>
            <div>
              <h3 className={os.subTitle}>Delete list</h3>
              <p className={os.subDescription}>Once deleted, your list cannot be recovered.</p>
            </div>
            <Button variant="destructive" size={28} icon="delete" onPress={() => setDialog('delete')}>
              Delete list
            </Button>
          </div>
        </section>
      )}

      {picking && (
        <EmojiPickerPopover
          placement="bottom start"
          triggerRef={iconRef}
          onPick={(emoji) => void patch({ icon: iconOfEmoji(emoji) }, 'list icon')}
          onClose={() => setPicking(false)}
        />
      )}
      <AlertDialog
        isOpen={pendingParent !== null}
        onOpenChange={(open) => !open && setPendingParent(null)}
        title="Change parent object"
        variant="primary"
        description={
          <>
            Changing the parent object affects the whole list and future records can only be added from that object.
            {list.entryCount ? (
              <>
                <br />
                <br />
                {list.entryCount.toLocaleString()} {list.entryCount === 1 ? 'record' : 'records'} will be affected
              </>
            ) : null}
          </>
        }
        onCancel={() => setPendingParent(null)}
        onConfirm={() => {
          const next = pendingParent;
          setPendingParent(null);
          if (next) void patch({ parentEntityDefinitionIds: [next] }, 'parent object');
        }}
      />
      <ListDialogs list={list} dialog={dialog} onClose={() => setDialog(null)} afterDelete="settings" />
    </div>
  );
}
