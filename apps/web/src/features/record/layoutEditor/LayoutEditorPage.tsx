// Record page layout editor (BACKLOG 3.10): `/settings/data/objects/{apiSlug}/record-page/{id}`
// inside the Settings shell. A WYSIWYG skeleton of the record page edits a working copy of the layout's element list
// with the store rules of layout/model.ts; any change shows the dirty bar ("Changes will be visible to all" · Cancel ·
// Save changes); "Save changes" sends the full element list (full replace, optimistic concurrency by version).
import type { AttributeDefinition, CustomLayout, EntityDefinition, LayoutElement, Path } from '@agentic-crm/contracts';
import { MAX_LAYOUT_WIDGETS } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  Icon,
  IconButton,
  IconTile,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  Spinner,
  Tooltip,
  toast,
} from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from '@tanstack/react-router';
import { useMemo, useRef, useState } from 'react';
import { errorEnvelopeOf, httpStatusOf } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { usePersistentState } from '../../../lib/storage';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { attributesQuery } from '../../attributes';
import { useAttributes } from '../../attributes/data/queries';
import { attributeIcon } from '../../settings/objects/attributes/typeCatalog';
import { objectAppearance } from '../../shell/objectAppearance';
import { PageHeader } from '../../shell/PageHeader';
import { useWorkspace } from '../../shell/workspaceContext';
import { PathPicker } from '../../views';
import { useVerticalReorder } from '../../views/useVerticalReorder';
import { saveLayout, useLayout, useObjectBySlug } from '../data';
import { listedAttributes } from '../details/attributes';
import { actionItems } from '../details/RecordHeader';
import {
  addElement,
  canRemove,
  childrenOf,
  groupChildren,
  groupElement,
  isDirty,
  LayoutRuleError,
  moveSibling,
  type ResolvedTab,
  removeElement,
  reorderChildren,
  resolveLayout,
  tabKindOf,
  toSaveElements,
  updateElement,
  widgetCount,
} from '../layout/model';
import { emptyWidgetText } from '../overview/Highlights';
import { DEFAULT_PANEL_PERCENT, panelWidthKey, panelWidthPx, readPercent } from '../panel/width';
import { TAB_ICON } from '../tabs/TabBar';
import { FittedActions } from '../ui/FittedActions';
import { EditSectionDialog, EditTabDialog, WidgetLabelDialog } from './EditorDialogs';
import * as s from './editor.css';

export function LayoutEditorPage({ apiSlug }: { apiSlug: string; configurationId: string }) {
  const { href } = useWorkspace();
  const { object, isPending } = useObjectBySlug(apiSlug);
  const layout = useLayout(object?.id);
  useDocumentTitle('Edit page layout');
  if (isPending) return <Centered />;
  if (!object) return <Navigate to={href('settings/data/objects')} replace />;
  if (layout.isError) {
    return (
      <div className={s.page}>
        <div style={{ padding: 24 }}>There was an error loading configuration data.</div>
      </div>
    );
  }
  if (!layout.data) return <Centered />;
  return <Editor key={`${layout.data.id}:${layout.data.version}`} object={object} layout={layout.data} />;
}

function Centered() {
  return (
    <div className={s.page} style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Spinner size={16} />
    </div>
  );
}

type Dialog =
  | { kind: 'section'; sectionId: string | null }
  | { kind: 'tab'; elementId: string }
  | { kind: 'widget-label'; elementId: string }
  | null;

function Editor({ object, layout }: { object: EntityDefinition; layout: CustomLayout }) {
  const { workspace, href } = useWorkspace();
  const [working, setWorking] = useState<LayoutElement[]>(layout.elements);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [saving, setSaving] = useState(false);
  const { attributes: all } = useAttributes(object.id);
  const attributes = useMemo(() => all.filter((a) => !a.isArchived), [all]);
  const resolved = useMemo(() => resolveLayout({ elements: working }), [working]);
  const dirty = isDirty(layout.elements, working);
  const look = objectAppearance(object);

  const apply = (fn: (els: LayoutElement[]) => LayoutElement[]) =>
    setWorking((prev) => {
      try {
        return fn(prev);
      } catch (error) {
        toast.error(error instanceof LayoutRuleError ? error.message : 'Something went wrong');
        return prev;
      }
    });

  const save = async () => {
    setSaving(true);
    const id = toast({ title: 'Saving changes...', icon: 'spinner', durationMs: Number.POSITIVE_INFINITY });
    try {
      await saveLayout(workspace, {
        customLayoutId: layout.id,
        elements: toSaveElements(working),
        expectedVersion: layout.version,
      });
      toast.dismiss(id);
      toast.success('Your settings were saved');
    } catch (error) {
      toast.dismiss(id);
      toast.error({
        title: 'There was a problem saving your settings',
        description:
          httpStatusOf(error) === 409
            ? 'The layout was changed by someone else; reload and try again.'
            : errorEnvelopeOf(error).message,
      });
      setSaving(false);
    }
  };

  return (
    <div className={s.page} data-testid="layout-editor">
      <PageHeader
        crumbs={[
          {
            label: object.pluralNoun,
            icon: <IconTile icon={look.icon} color={look.color} size={16} />,
            href: href(`settings/data/objects/${object.apiSlug}/general`),
          },
          { label: 'Edit page layout' },
        ]}
      />
      <SplitBody object={object}>
        {{
          left: (
            <LeftPanel
              object={object}
              working={working}
              attributes={attributes}
              apply={apply}
              onEditSection={(sectionId) => setDialog({ kind: 'section', sectionId })}
            />
          ),
          right: (
            <RightPanel
              object={object}
              working={working}
              tabs={resolved.tabs}
              overview={resolved.overview}
              attributes={attributes}
              apply={apply}
              onEditTab={(elementId) => setDialog({ kind: 'tab', elementId })}
              onEditWidgetLabel={(elementId) => setDialog({ kind: 'widget-label', elementId })}
            />
          ),
        }}
      </SplitBody>
      {dirty && (
        <div className={s.dirtyBar} role="status" data-testid="layout-dirty-bar">
          Changes will be visible to all
          <Tooltip content="Changes will affect all record pages of this object type and will be visible for all users">
            <span tabIndex={-1} style={{ display: 'inline-flex' }}>
              <Icon icon="info" size={16} />
            </span>
          </Tooltip>
          <Button variant="secondary" size={28} onPress={() => setConfirmCancel(true)} isDisabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size={28} onPress={() => void save()} isPending={saving}>
            Save changes
          </Button>
        </div>
      )}
      <AlertDialog
        isOpen={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Are you sure you want to cancel?"
        description="You will lose any unsaved progress"
        confirmLabel="Discard changes"
        variant="danger"
        onConfirm={() => {
          setConfirmCancel(false);
          setWorking(layout.elements);
        }}
      />
      {dialog?.kind === 'section' && (
        <EditSectionDialog
          object={object}
          attributes={attributes}
          working={working}
          sectionId={dialog.sectionId}
          onClose={() => setDialog(null)}
          onSave={(next) => {
            apply(() => next);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'tab' && (
        <EditTabDialog
          object={object}
          working={working}
          elementId={dialog.elementId}
          onClose={() => setDialog(null)}
          onSave={(next) => {
            apply(() => next);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'widget-label' && (
        <WidgetLabelDialog
          working={working}
          elementId={dialog.elementId}
          onClose={() => setDialog(null)}
          onSave={(next) => {
            apply(() => next);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

/** Same split as the record page, using the object's panel width preference. */
function SplitBody({
  object,
  children,
}: {
  object: EntityDefinition;
  children: { left: React.ReactNode; right: React.ReactNode };
}) {
  const [stored] = usePersistentState<number>(panelWidthKey(object.id), DEFAULT_PANEL_PERCENT);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const setRef = (el: HTMLDivElement | null) => {
    ref.current = el;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
  };
  return (
    <div className={s.body} ref={setRef}>
      <div className={s.left} style={{ width: width ? panelWidthPx(readPercent(stored), width) : '30%' }}>
        {children.left}
      </div>
      <div className={s.right}>{children.right}</div>
    </div>
  );
}

type Apply = (fn: (els: LayoutElement[]) => LayoutElement[]) => void;

// ---- left: header, actions, sections -----------------------------------------------------------------------------

function LeftPanel({
  object,
  working,
  attributes,
  apply,
  onEditSection,
}: {
  object: EntityDefinition;
  working: LayoutElement[];
  attributes: AttributeDefinition[];
  apply: Apply;
  onEditSection: (sectionId: string | null) => void;
}) {
  const look = objectAppearance(object);
  const sidebar = groupElement(working, 'details-sidebar');
  const sections = groupChildren(working, 'details-sidebar');
  const hasLists = sections.some((e) => e.type === 'detail-list-entries');
  const detailsCount = sections.filter((e) => e.type === 'details').length;
  return (
    <>
      <div className={s.header}>
        <div className={s.titleRow}>
          <IconTile icon={look.icon} color="grey" size={32} />
          <span className={s.titlePlaceholder}>Record name</span>
        </div>
        <ActionsEditor working={working} apply={apply} />
      </div>
      <div className={s.sections}>
        {sections.map((section) =>
          section.type === 'detail-list-entries' ? (
            <div key={section.elementId} className={s.sectionCard} data-locked="" data-testid="layout-lists-section">
              <span className={s.sectionTitle} style={{ cursor: 'default' }}>
                {section.title || 'Lists'}
              </span>
            </div>
          ) : (
            <SectionCard
              key={section.elementId}
              section={section}
              working={working}
              attributes={attributes}
              canDelete={detailsCount > 1 && canRemove(working, section.elementId)}
              apply={apply}
              onEdit={() => onEditSection(section.elementId)}
            />
          ),
        )}
        {hasLists ? (
          <button type="button" className={s.addSection} onClick={() => onEditSection(null)}>
            <Icon icon="add" size={16} />
            Add section
          </button>
        ) : (
          <MenuTrigger>
            <button type="button" className={s.addSection}>
              <Icon icon="add" size={16} />
              Add section
            </button>
            <Menu
              aria-label="Choose Section Type"
              placement="bottom"
              width={240}
              onAction={(k) => {
                if (k === 'attributes') onEditSection(null);
                if (k === 'lists' && sidebar)
                  apply((els) =>
                    addElement(els, sidebar.elementId, {
                      elementId: newId(),
                      type: 'detail-list-entries',
                      title: 'Lists',
                    }),
                  );
              }}
            >
              <MenuItem id="attributes" icon="attrText">
                Selected Attributes
              </MenuItem>
              <MenuItem id="lists" icon="list">
                Lists
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </div>
      {/* object noun for assistive tech */}
      <span hidden>{object.singularNoun}</span>
    </>
  );
}

function SectionCard({
  section,
  working,
  attributes,
  canDelete,
  apply,
  onEdit,
}: {
  section: LayoutElement;
  working: LayoutElement[];
  attributes: AttributeDefinition[];
  canDelete: boolean;
  apply: Apply;
  onEdit: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(section.title ?? '');
  const configured = childrenOf(working, section.elementId);
  const byId = new Map(attributes.map((a) => [a.id, a]));
  const shown =
    configured.length > 0
      ? configured
          .map((c) => byId.get(c.path?.[0]?.attributeDefinitionId ?? ''))
          .filter((a): a is AttributeDefinition => !!a)
      : listedAttributes(attributes).slice(0, 5);
  const commitTitle = () => {
    setRenaming(false);
    if (title !== (section.title ?? ''))
      apply((els) => updateElement(els, section.elementId, { title: title.trim() || null }));
  };
  return (
    <div
      className={s.sectionCard}
      data-testid="layout-details-section"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input')) return;
        onEdit();
      }}
    >
      <div className={s.sectionTop}>
        {renaming ? (
          <input
            className={s.sectionTitleInput}
            autoFocus
            aria-label="Section title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') {
                setTitle(section.title ?? '');
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button type="button" className={s.sectionTitle} onClick={() => setRenaming(true)}>
            {section.title || 'Unnamed section'}
          </button>
        )}
        <Tooltip content={canDelete ? 'Delete section' : 'You must have at least one record details section'}>
          <IconButton
            className={s.sectionTrash}
            icon="delete"
            variant="ghost"
            size={20}
            aria-label="Delete section"
            isDisabled={!canDelete}
            onPress={() => apply((els) => removeElement(els, section.elementId))}
          />
        </Tooltip>
      </div>
      <div className={s.chips}>
        {shown.map((a) => (
          <span key={a.id} className={s.chip}>
            <Icon icon={attributeIcon(a)} size={12} />
            {a.title}
          </span>
        ))}
      </div>
    </div>
  );
}

function ActionsEditor({ working, apply }: { working: LayoutElement[]; apply: Apply }) {
  const group = groupElement(working, 'actions');
  const actions = groupChildren(working, 'actions');
  const items = actionItems(actions);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const reorder = useVerticalReorder(listRef, (from, to) => {
    if (!group) return;
    const ids = items.map((i) => i.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved as string);
    apply((els) => reorderChildren(els, group.elementId, ids));
  });
  const line = reorder.dropLineTop();
  return (
    <div className={s.actionsWrap} data-open={open || undefined} data-testid="layout-actions">
      <FittedActions actions={items.map(({ id, label, icon }) => ({ id, label, icon }))} />
      <span className={s.editActionsButton}>
        <Popover
          isOpen={open}
          onOpenChange={setOpen}
          aria-label="Edit actions"
          placement="bottom end"
          padding={0}
          trigger={
            <Button variant="secondary" size={28} icon="edit">
              Edit
            </Button>
          }
        >
          <div className={s.actionsPanel} ref={listRef}>
            <div className={s.panelHeading}>Edit actions</div>
            {items.map((item, i) => (
              <div
                key={item.id}
                className={s.actionItem}
                data-reorder-index={i}
                data-dragging={reorder.dragging === i || undefined}
                data-testid="layout-action-item"
              >
                <span
                  className={s.grip}
                  onPointerDown={(e) => reorder.onPointerDown(i, e)}
                  aria-label="Drag to reorder"
                >
                  <Icon icon="drag" size={16} />
                </span>
                <Icon icon={item.icon} size={16} />
                {item.label}
              </div>
            ))}
            {line !== null && <span className={s.dropLine} style={{ top: line }} />}
          </div>
        </Popover>
      </span>
    </div>
  );
}

// ---- right: tabs and highlights -----------------------------------------------------------------------------------

function RightPanel({
  object,
  working,
  tabs,
  overview,
  attributes,
  apply,
  onEditTab,
  onEditWidgetLabel,
}: {
  object: EntityDefinition;
  working: LayoutElement[];
  tabs: ResolvedTab[];
  overview: ResolvedTab | null;
  attributes: AttributeDefinition[];
  apply: Apply;
  onEditTab: (elementId: string) => void;
  onEditWidgetLabel: (elementId: string) => void;
}) {
  return (
    <>
      <div className={s.tabsRow} data-testid="layout-tabs">
        {overview && (
          <span className={s.tabPill} data-static="">
            <Icon icon="overview" size={16} />
            {overview.title}
          </span>
        )}
        <span className={s.tabsDivider} />
        {tabs.map((t, i) => (
          <TabPill
            key={t.element.elementId}
            tab={t}
            first={i === 0}
            last={i === tabs.length - 1}
            apply={apply}
            onEdit={() => onEditTab(t.element.elementId)}
          />
        ))}
        <span className={s.tabsDivider} />
        <AddTabMenu object={object} working={working} attributes={attributes} apply={apply} />
      </div>
      <Highlights
        object={object}
        working={working}
        attributes={attributes}
        apply={apply}
        onEditLabel={onEditWidgetLabel}
      />
    </>
  );
}

function TabPill({
  tab,
  first,
  last,
  apply,
  onEdit,
}: {
  tab: ResolvedTab;
  first: boolean;
  last: boolean;
  apply: Apply;
  onEdit: () => void;
}) {
  const system = tab.element.isSystemElement;
  return (
    <span className={s.tabPill} data-testid="layout-tab" data-tab={tab.slug}>
      <Icon icon={TAB_ICON[tab.kind]} size={16} />
      <span className={s.tabPillText}>{tab.title}</span>
      <MenuTrigger>
        <IconButton icon="moreVertical" variant="ghost" size={20} aria-label="Open menu" />
        <Menu
          aria-label={`${tab.title} tab`}
          placement="bottom start"
          width={220}
          disabledKeys={[...(first ? ['left'] : []), ...(last ? ['right'] : [])]}
          onAction={(k) => {
            if (k === 'edit') onEdit();
            if (k === 'left') apply((els) => moveSibling(els, tab.element.elementId, -1));
            if (k === 'right') apply((els) => moveSibling(els, tab.element.elementId, 1));
            if (k === 'remove') apply((els) => removeElement(els, tab.element.elementId));
          }}
        >
          {!system && (
            <MenuItem id="edit" icon="edit">
              Edit tab
            </MenuItem>
          )}
          <MenuItem id="left" icon="arrowLeft">
            Move left
          </MenuItem>
          <MenuItem id="right" icon="arrowRight">
            Move right
          </MenuItem>
          {!system && (
            <MenuItem id="remove" icon="delete" variant="danger">
              Remove tab
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
    </span>
  );
}

const SINGLE_TABS: { type: LayoutElement['type']; title: string }[] = [
  { type: 'agent-tab', title: 'Agent' },
  { type: 'task-tab', title: 'Tasks' },
  { type: 'note-tab', title: 'Notes' },
  { type: 'file-tab', title: 'Files' },
  { type: 'call-tab', title: 'Calls' },
];

const SLUGS: Partial<Record<LayoutElement['type'], string>> = {
  'task-tab': 'tasks',
  'note-tab': 'notes',
  'file-tab': 'files',
  'call-tab': 'calls',
  'email-tab': 'emails',
};

function AddTabMenu({
  object,
  working,
  attributes,
  apply,
}: {
  object: EntityDefinition;
  working: LayoutElement[];
  attributes: AttributeDefinition[];
  apply: Apply;
}) {
  const group = groupElement(working, 'tabs');
  const present = new Set(groupChildren(working, 'tabs').map((e) => e.type));
  const relTaken = new Set(
    groupChildren(working, 'tabs')
      .filter((e) => e.type === 'relationship-tab')
      .map((e) => e.path?.[0]?.attributeDefinitionId),
  );
  const singles = SINGLE_TABS.filter((t) => !present.has(t.type));
  const relationships = attributes.filter(
    (a) => a.type === 'entity-reference' && a.relationship && !a.isHidden && !relTaken.has(a.id),
  );
  const add = (key: string) => {
    if (!group) return;
    const single = SINGLE_TABS.find((t) => t.type === key);
    if (single) {
      apply((els) =>
        addElement(els, group.elementId, {
          elementId: newId(),
          type: single.type,
          title: single.title,
          slug: SLUGS[single.type] ?? null,
        }),
      );
      return;
    }
    if (key === 'email-tab') {
      apply((els) =>
        addElement(els, group.elementId, { elementId: newId(), type: 'email-tab', title: 'Emails', slug: 'emails' }),
      );
      return;
    }
    const attr = relationships.find((a) => a.id === key);
    if (!attr) return;
    const path: Path = [{ entityDefinitionId: object.id, attributeDefinitionId: attr.id }];
    apply((els) =>
      addElement(els, group.elementId, {
        elementId: newId(),
        type: 'relationship-tab',
        title: attr.title,
        slug: attr.apiSlug.replace(/[^a-z0-9_-]/g, '_'),
        path,
      }),
    );
  };
  return (
    <MenuTrigger>
      <Button variant="secondary" size={28} icon="add">
        Add tab
      </Button>
      <Menu aria-label="Add tab" placement="bottom end" width={260} onAction={(k) => add(String(k))}>
        {singles.map((t) => (
          <MenuItem key={t.type} id={t.type} icon={TAB_ICON[tabKindOf(t.type) ?? 'overview']}>
            {t.title}
          </MenuItem>
        ))}
        <MenuItem id="email-tab" icon="emails">
          Emails
        </MenuItem>
        {relationships.length > 0 && <MenuSeparator />}
        {relationships.map((a) => (
          <MenuItem key={a.id} id={a.id} icon="relationship">
            {a.title}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}

function Highlights({
  object,
  working,
  attributes,
  apply,
  onEditLabel,
}: {
  object: EntityDefinition;
  working: LayoutElement[];
  attributes: AttributeDefinition[];
  apply: Apply;
  onEditLabel: (elementId: string) => void;
}) {
  const group = groupElement(working, 'widgets-v2');
  const widgets = groupChildren(working, 'widgets-v2');
  const count = widgetCount(working);
  const [open, setOpen] = useState(false);
  const atLimit = count >= MAX_LAYOUT_WIDGETS;
  const addButton = (
    <Button variant="primary" size={28} icon="add" isDisabled={atLimit} data-testid="add-widget">
      Add widget ({count}/{MAX_LAYOUT_WIDGETS})
    </Button>
  );
  return (
    <div className={s.highlights}>
      <div className={s.highlightsHeader}>
        Highlights
        {atLimit ? (
          <Tooltip content="You've reached the limit. Remove a widget to add a new one">
            <span tabIndex={-1}>{addButton}</span>
          </Tooltip>
        ) : (
          <Popover
            isOpen={open}
            onOpenChange={setOpen}
            aria-label="Add widget"
            placement="bottom end"
            width={274}
            padding={0}
            trigger={addButton}
          >
            <PathPicker
              rootDefinitionId={object.id}
              purpose="column"
              placeholder="Search widgets..."
              label="Widgets"
              onSelect={(sel) => {
                setOpen(false);
                if (!group) return;
                apply((els) =>
                  addElement(els, group.elementId, {
                    elementId: newId(),
                    type: 'value-widget-v2',
                    path: sel.path,
                    field: sel.field,
                  }),
                );
              }}
            />
          </Popover>
        )}
      </div>
      {widgets.length === 0 ? (
        <div className={s.emptyWidgets}>
          <Button variant="secondary" size={28} icon="add" onPress={() => setOpen(true)}>
            Add first widget
          </Button>
        </div>
      ) : (
        <div className={s.widgetGrid}>
          {widgets.map((w) => (
            <WidgetCard
              key={w.elementId}
              widget={w}
              attributes={attributes}
              apply={apply}
              onEditLabel={() => onEditLabel(w.elementId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WidgetCard({
  widget,
  attributes,
  apply,
  onEditLabel,
}: {
  widget: LayoutElement;
  attributes: AttributeDefinition[];
  apply: Apply;
  onEditLabel: () => void;
}) {
  const { workspace } = useWorkspace();
  const relatedDef = widget.path?.[1]?.entityDefinitionId;
  const related = useQuery({ ...attributesQuery(workspace, relatedDef ?? ''), enabled: Boolean(relatedDef) });
  const attrs = (widget.path ?? []).map((hop, i) =>
    (i === 0 ? attributes : (related.data ?? [])).find((a) => a.id === hop.attributeDefinitionId),
  );
  const first = attrs[0];
  const last = attrs[attrs.length - 1];
  const label =
    widget.title ||
    attrs
      .map((a) => a?.title ?? '')
      .filter(Boolean)
      .join(' › ');
  return (
    <div className={s.widget} data-testid="layout-widget">
      <div className={s.widgetTop}>
        <span className={s.widgetLabel} title={label}>
          {label}
        </span>
        <Icon icon={first ? attributeIcon(first) : 'attrText'} size={16} className={s.widgetIcon} />
      </div>
      <span className={s.widgetEmpty}>{last ? emptyWidgetText(last) : ''}</span>
      <span className={s.widgetMenu}>
        <MenuTrigger>
          <IconButton icon="moreVertical" variant="secondary" size={20} aria-label="Widget actions" />
          <Menu
            aria-label="Widget actions"
            placement="bottom start"
            width={228}
            onAction={(k) => {
              if (k === 'label') onEditLabel();
              if (k === 'remove') apply((els) => removeElement(els, widget.elementId));
            }}
          >
            <MenuItem id="label" icon="edit">
              Edit widget label
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="remove" icon="delete" variant="danger">
              Remove widget
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </span>
    </div>
  );
}
