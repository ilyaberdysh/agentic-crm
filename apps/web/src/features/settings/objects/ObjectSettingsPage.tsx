// Object settings page `/settings/data/objects/$apiSlug/<tab>` (J objects-lists;
// custom.png, object-attributes-tab.png): crumb "Objects / <tile> <plural>", "← Back", 56 px tile + plural noun + type
// pill + subtitle, tabs Configuration · Permissions · Attributes <n> · Rules <n> · Templates · "+2 more" (Notifications,
// Imports). Unknown slug → "Object Not Found".
import type { EntityDefinition } from '@agentic-crm/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Menu,
  MenuItem,
  MenuTrigger,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { Link } from 'react-aria-components';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { type EntityAccess, useEntityAccess } from '../../access/useEntityAccess';
import { ImportHistoryList } from '../../imports';
import { ContentSpinner } from '../../shell/AppShell';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import * as shell from '../../shell/shell.css';
import { useWorkspace } from '../../shell/workspaceContext';
import { PermissionsTab } from '../permissions/PermissionsTab';
import { useRules } from '../rules/data';
import { RulesTab } from '../rules/RulesTab';
import { AttributesTab } from './attributes/AttributesTab';
import { ConfigurationTab } from './ConfigurationTab';
import { useAttributes, useSettingsObject } from './data';
import * as s from './objects.css';
import { ObjectTile, ObjectTypePill } from './parts';

export type ObjectTabId = 'general' | 'permissions' | 'attributes' | 'rules' | 'templates' | 'app' | 'imports';

interface TabDef {
  id: ObjectTabId;
  label: string;
  icon: Parameters<typeof Tab>[0]['icon'];
  overflow?: boolean;
}

const TABS: TabDef[] = [
  { id: 'general', label: 'Configuration', icon: 'settings' },
  { id: 'permissions', label: 'Permissions', icon: 'lock' },
  { id: 'attributes', label: 'Attributes', icon: 'apps' },
  { id: 'rules', label: 'Rules', icon: 'workflows' },
  { id: 'templates', label: 'Templates', icon: 'template' },
  { id: 'app', label: 'Notifications', icon: 'notifications', overflow: true },
  { id: 'imports', label: 'Imports', icon: 'import', overflow: true },
];

export const OBJECT_TAB_IDS = TABS.map((t) => t.id);

export function ObjectSettingsPage({ apiSlug, tab }: { apiSlug: string; tab: ObjectTabId }) {
  const { workspace, href, isAdmin } = useWorkspace();
  const navigate = useNavigate();
  const objectsHref = href('settings/data/objects');
  const { object, isPending, isError, refetch } = useSettingsObject(workspace, apiSlug);
  const attributes = useAttributes(workspace, object?.id ?? null);
  const rules = useRules(workspace, object?.id ?? null);
  const access = useEntityAccess(object?.id);
  // Tabs follow the member's resolved policy (J permissions): Configuration needs update_entity_definition,
  // Permissions administrate (admins always, OQ-067), Attributes create_attribute_definition.
  const allowed: ObjectTabId[] = [
    ...(access.canUpdateDefinition ? (['general', 'rules', 'templates', 'app'] as const) : []),
    ...(access.canAdministrate || isAdmin ? (['permissions'] as const) : []),
    ...(access.canCreateAttributes ? (['attributes'] as const) : []),
    ...(access.canCreateRecords ? (['imports'] as const) : []),
  ];
  const visibleTabs = TABS.filter((t) => allowed.includes(t.id));
  useDocumentTitle(object ? `${object.pluralNoun} · Objects` : 'Objects');
  // A tab the member may not open (typed URL, lost access) falls back to the first one they may.
  const fallback = visibleTabs[0]?.id;
  useEffect(() => {
    if (object && access.known && fallback && !allowed.includes(tab))
      void navigate({ href: `${objectsHref}/${object.apiSlug}/${fallback}`, replace: true });
  });

  const crumbs = [
    { label: 'Objects', icon: 'object' as const, href: objectsHref },
    ...(object ? [{ label: object.pluralNoun, icon: <ObjectTile object={object} /> }] : []),
  ];

  let body: ReactNode;
  if (isPending) body = <ContentSpinner />;
  else if (isError)
    body = (
      <ErrorState
        message="Failed to load object settings"
        style={{ padding: 48 }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void refetch()}>
            Retry
          </Button>
        }
      />
    );
  else if (!object || (object.isArchived && object.entityType === 'custom-record'))
    body = (
      <EmptyState
        icon="object"
        title="Object Not Found"
        description="This object does not exist or has been deleted."
        style={{ padding: '72px 24px' }}
        actions={
          <Button variant="secondary" size={28} onPress={() => void navigate({ href: objectsHref })}>
            Back to objects
          </Button>
        }
      />
    );
  else {
    const attributeCount = attributes.data?.filter((a) => !a.isArchived).length;
    const inline = visibleTabs.filter((t) => !t.overflow || t.id === tab);
    const overflow = visibleTabs.filter((t) => t.overflow && t.id !== tab);
    const go = (id: ObjectTabId) => void navigate({ href: `${objectsHref}/${object.apiSlug}/${id}` });
    body = (
      <div className={s.page}>
        <Link href={objectsHref} className={s.backLink}>
          <Icon icon="chevronLeft" size={14} />
          Back
        </Link>
        <ObjectHeader object={object} />
        <Tabs selectedKey={tab} onSelectionChange={(k) => go(k as ObjectTabId)} className={s.tabs}>
          <div className={s.tabRow}>
            <TabList aria-label="Object settings">
              {inline.map((t) => (
                <Tab
                  key={t.id}
                  id={t.id}
                  icon={t.icon}
                  count={t.id === 'attributes' ? attributeCount : t.id === 'rules' ? rules.data?.length : undefined}
                >
                  {t.label}
                </Tab>
              ))}
            </TabList>
            {overflow.length > 0 && (
              <MenuTrigger>
                <Button variant="ghost" size={28} iconRight="chevronDown" className={s.moreTab}>
                  {`+${overflow.length} more`}
                </Button>
                <Menu
                  aria-label="More tabs"
                  width={200}
                  placement="bottom start"
                  onAction={(k) => go(k as ObjectTabId)}
                >
                  {overflow.map((t) => (
                    <MenuItem key={t.id} id={t.id} icon={t.icon}>
                      {t.label}
                    </MenuItem>
                  ))}
                </Menu>
              </MenuTrigger>
            )}
          </div>
          <TabPanel id={tab} className={s.tabPanel}>
            {allowed.includes(tab) ? (
              <ObjectTabContent object={object} tab={tab} access={access} />
            ) : visibleTabs.length === 0 && access.known ? (
              <Placeholder
                icon="lock"
                title="No access"
                description="You don’t have permission to access this object’s settings"
              />
            ) : null}
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

function ObjectHeader({ object }: { object: EntityDefinition }) {
  return (
    <div className={s.objectHeader}>
      <ObjectTile object={object} size={56} />
      <div className={s.objectHeaderText}>
        <div className={s.objectTitleRow}>
          <h1 className={s.objectTitle}>{object.pluralNoun}</h1>
          <ObjectTypePill object={object} size={20} />
        </div>
        <p className={s.pageDescription}>Manage object attributes and other relevant settings</p>
      </div>
    </div>
  );
}

function ObjectTabContent({
  object,
  tab,
  access,
}: {
  object: EntityDefinition;
  tab: ObjectTabId;
  access: EntityAccess;
}) {
  switch (tab) {
    case 'general':
      return <ConfigurationTab object={object} canEdit={access.canUpdateDefinition} />;
    case 'attributes':
      return <AttributesTab object={object} canEdit={access.canCreateAttributes} />;
    case 'permissions':
      return <PermissionsTab kind="object" resourceId={object.id} />;
    case 'rules':
      return <RulesTab object={object} canEdit={access.canUpdateDefinition} />;
    case 'templates':
      return (
        <Placeholder
          icon="template"
          title="No templates"
          description="Organize and manage templates. Templates arrive in a later slice."
        />
      );
    case 'app':
      return (
        <Placeholder
          icon="notifications"
          title="Slack app not installed"
          description="Install the Slack app and connect your workspace to enable notifications"
        />
      );
    case 'imports':
      return (
        <ImportHistoryList
          entityDefinitionId={object.id}
          pluralNoun={object.pluralNoun}
          startBase={`settings/data/objects/${object.apiSlug}/imports`}
        />
      );
  }
}

function Placeholder({
  icon,
  title,
  description,
}: {
  icon: Parameters<typeof EmptyState>[0]['icon'];
  title: string;
  description: string;
}) {
  return <EmptyState icon={icon} title={title} description={description} className={s.placeholder} />;
}
