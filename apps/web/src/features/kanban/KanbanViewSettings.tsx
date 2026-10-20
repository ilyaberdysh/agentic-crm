// Kanban "View settings" (C2 kanban.md K4; evidence kanban-view-settings.png, kanban-grouped-by.png,
// kanban-visible-columns.png): a 270 px popover with nested pages replaced in place —
//   Grouped by <attribute> ›  (status / single-select attributes: the object's, or on lists the parent object's
//                              through parent_record and the list's own; current one checked; Create new attribute)
//   Visible columns <n> ›     ("No status" switch, then one switch per stage with its colour dot)
//   Show attribute labels     (shared, on the view)          Hide empty attributes (this browser)
//   card rows (⋮⋮ reorder, type icon, label, ⋮ Edit attribute / Change attribute label / Formatting › / Remove card row)
//   + Add attribute to view › (attribute picker; stays open to add several)
import type { AttributeDefinition, Path, ViewColumn } from '@agentic-crm/contracts';
import {
  Button,
  Icon,
  IconButton,
  MenuItem,
  MenuList,
  MenuSeparator,
  MenuTrigger,
  PopoverPanel,
  StatusDot,
  Switch,
} from '@agentic-crm/ui';
import { Fragment, useMemo, useRef, useState } from 'react';
import { Button as AriaButton, Dialog } from 'react-aria-components';
import { useShortcut } from '../../lib/shortcuts';
import {
  attributeIcon,
  ColumnLabelDialog,
  FormattingSubmenu,
  PathPicker,
  useAttributes,
  useDefinitions,
} from '../views';
import { PathLabel } from '../views/components/ViewSettingsPopover';
import { useVerticalReorder } from '../views/useVerticalReorder';
import * as v from '../views/views.css';
import { type Kanban, useKanbanContext } from './context';
import * as s from './kanban.css';
import { isGroupable, NO_STAGE } from './model';
import type { BoardPrefs } from './prefs';
import type { Board } from './useBoard';

export interface KanbanViewSettingsProps {
  /** Default: the board of the surrounding <KanbanProvider>. */
  kanban?: Kanban;
  onEditAttribute?: (attribute: AttributeDefinition) => void;
  onCreateAttribute?: () => void;
}

type Page = 'main' | 'group' | 'columns' | 'add';

export function KanbanViewSettings({ kanban: given, onEditAttribute, onCreateAttribute }: KanbanViewSettingsProps) {
  const provided = useKanbanContext();
  const kanban = given ?? provided;
  if (!kanban) throw new Error('KanbanViewSettings needs a <KanbanProvider> or the `kanban` prop');
  const { board } = kanban;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page>('main');
  useShortcut('y', () => setOpen(true));
  const close = () => {
    setOpen(false);
    setPage('main');
  };
  return (
    <>
      <Button
        ref={triggerRef}
        variant="secondary"
        size={28}
        icon="viewSettings"
        chevron
        isActive={open}
        onPress={() => setOpen(true)}
        data-testid="view-settings"
      >
        View settings
      </Button>
      <PopoverPanel
        triggerRef={triggerRef}
        isOpen={open}
        onOpenChange={(o) => (o ? setOpen(true) : close())}
        className={page === 'add' ? undefined : s.settingsPanel}
        width={page === 'add' ? 274 : undefined}
      >
        <Dialog aria-label="View settings" className={v.panelColumn} data-testid="kanban-view-settings">
          {page === 'main' && (
            <MainPage board={board} prefs={kanban.prefs} onPage={setPage} onEditAttribute={onEditAttribute} />
          )}
          {page === 'group' && (
            <GroupByPage
              board={board}
              onBack={() => setPage('main')}
              onCreateAttribute={
                onCreateAttribute
                  ? () => {
                      close();
                      onCreateAttribute();
                    }
                  : undefined
              }
            />
          )}
          {page === 'columns' && <VisibleColumnsPage board={board} onBack={() => setPage('main')} />}
          {page === 'add' && <AddAttributePage board={board} onBack={() => setPage('main')} />}
        </Dialog>
      </PopoverPanel>
    </>
  );
}

function PageHeader({ title, onBack }: { title: string; onBack(): void }) {
  return (
    <div className={`${v.searchRow} ${v.searchRowWithBack}`}>
      <AriaButton className={v.backButton} aria-label="Back" onPress={onBack}>
        <Icon icon="chevronLeft" size={16} />
      </AriaButton>
      <span className={v.sectionLabel} style={{ padding: 0 }}>
        {title}
      </span>
    </div>
  );
}

function MainPage({
  board,
  prefs,
  onPage,
  onEditAttribute,
}: {
  board: Board;
  prefs: BoardPrefs;
  onPage(page: Page): void;
  onEditAttribute?: (attribute: AttributeDefinition) => void;
}) {
  const visible = board.stages.filter((st) => !board.config.hiddenStageIds.includes(st.key)).length;
  const groupTitle = board.groupAttribute?.title ?? 'Select attribute';
  return (
    <div className={v.list}>
      <AriaButton
        className={`${v.row} ${s.rowButton}`}
        onPress={() => onPage('group')}
        data-testid="kanban-settings-group"
      >
        <Icon icon="kanban" size={16} className={v.rowIcon} />
        <span className={v.rowLabel}>
          Grouped by <span className={s.settingsMuted}>{groupTitle}</span>
        </span>
        <Icon icon="chevronRight" size={16} className={v.chevron} />
      </AriaButton>
      <AriaButton
        className={`${v.row} ${s.rowButton}`}
        onPress={() => onPage('columns')}
        data-testid="kanban-settings-columns"
      >
        <Icon icon="columns" size={16} className={v.rowIcon} />
        <span className={v.rowLabel}>Visible columns</span>
        <span className={s.settingsTrailing}>{visible}</span>
        <Icon icon="chevronRight" size={16} className={v.chevron} />
      </AriaButton>
      <SwitchRow
        icon="attrMultiSelect"
        label="Show attribute labels"
        isSelected={board.config.showLabels}
        onChange={(on) => void board.saveConfig({ showLabels: on })}
      />
      <HideEmptyRow prefs={prefs} />
      <hr className={v.separator} />
      {board.draft.columns.length > 0 && <CardRows board={board} onEditAttribute={onEditAttribute} />}
      <AriaButton className={`${v.row} ${s.rowButton}`} onPress={() => onPage('add')} data-testid="kanban-settings-add">
        <Icon icon="add" size={16} className={v.rowIcon} />
        <span className={v.rowLabel}>Add attribute to view</span>
        <Icon icon="chevronRight" size={16} className={v.chevron} />
      </AriaButton>
    </div>
  );
}

function SwitchRow({
  icon,
  label,
  isSelected,
  onChange,
}: {
  icon: 'attrMultiSelect' | 'show';
  label: string;
  isSelected: boolean;
  onChange(on: boolean): void;
}) {
  return (
    // The whole row toggles; the switch itself is the accessible control.
    <div
      className={`${v.row} ${s.rowButton}`}
      onClick={(e) => !(e.target as HTMLElement).closest('label') && onChange(!isSelected)}
    >
      <Icon icon={icon} size={16} className={v.rowIcon} />
      <span className={v.rowLabel}>{label}</span>
      <Switch aria-label={label} isSelected={isSelected} onChange={onChange} />
    </div>
  );
}

/** "Hide empty attributes" is per browser (K4): the board's prefs. */
function HideEmptyRow({ prefs }: { prefs: BoardPrefs }) {
  return (
    <SwitchRow icon="show" label="Hide empty attributes" isSelected={prefs.hideEmpty} onChange={prefs.setHideEmpty} />
  );
}

function CardRows({
  board,
  onEditAttribute,
}: {
  board: Board;
  onEditAttribute?: (attribute: AttributeDefinition) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [labelFor, setLabelFor] = useState<ViewColumn | null>(null);
  const draft = board.draft;
  const reorder = useVerticalReorder(listRef, (from, to) => {
    const column = draft.columns[from];
    if (column) void draft.moveColumn(column.id, { index: to });
  });
  const dropTop = reorder.dropLineTop();
  return (
    <>
      <div ref={listRef} style={{ position: 'relative' }} role="list" aria-label="Card attributes">
        {draft.columns.map((column, i) => {
          const attribute = board.schema?.leaf(column.path);
          const parts = board.schema?.pathParts(column.path, column.field) ?? [];
          return (
            <div
              key={column.id}
              role="listitem"
              data-reorder-index={i}
              className={`${v.row} ${reorder.dragging === i ? v.sortRowDragging : ''}`}
              style={{ paddingLeft: 4 }}
              data-testid="kanban-card-row"
            >
              <span
                className={v.dragHandle}
                style={{ height: 20 }}
                onPointerDown={(e) => reorder.onPointerDown(i, e)}
                aria-hidden
              >
                <Icon icon="drag" size={14} />
              </span>
              {attribute && <Icon icon={attributeIcon(attribute)} size={16} className={v.rowIcon} />}
              <span className={v.rowLabel}>{column.title ?? <PathLabel parts={parts} />}</span>
              <MenuTrigger>
                <IconButton icon="moreVertical" size={20} aria-label="View attribute menu" />
                <PopoverPanel placement="bottom start" offset={4} width={200}>
                  <MenuList
                    aria-label="View attribute menu"
                    onAction={(key) => {
                      if (key === 'edit' && attribute) onEditAttribute?.(attribute);
                      if (key === 'label') setLabelFor(column);
                      if (key === 'remove') void draft.removeColumn(column.id);
                    }}
                  >
                    {attribute && onEditAttribute && column.path.length === 1 && !attribute.isSystem && (
                      <MenuItem id="edit" icon="edit">
                        Edit attribute
                      </MenuItem>
                    )}
                    <MenuItem id="label" icon="attrMultiSelect">
                      Change attribute label
                    </MenuItem>
                    {attribute && <FormattingSubmenu column={column} attribute={attribute} draft={draft} />}
                    <MenuSeparator />
                    <MenuItem id="remove" icon="close">
                      Remove card row
                    </MenuItem>
                  </MenuList>
                </PopoverPanel>
              </MenuTrigger>
            </div>
          );
        })}
        {dropTop !== null && <div className={v.dropLine} style={{ top: dropTop }} />}
      </div>
      <hr className={v.separator} />
      <ColumnLabelDialog
        isOpen={labelFor !== null}
        onOpenChange={(o) => !o && setLabelFor(null)}
        viewTitle={draft.view.title}
        attributeTitle={labelFor ? (board.schema?.pathLabel(labelFor.path, labelFor.field) ?? '') : ''}
        currentLabel={labelFor?.title ?? null}
        onSave={(title) => labelFor && void draft.updateColumn(labelFor.id, { title })}
      />
    </>
  );
}

const pathKey = (p: Path | null | undefined) => (p ? p.map((h) => h.attributeDefinitionId).join('>') : '');

function GroupByPage({
  board,
  onBack,
  onCreateAttribute,
}: {
  board: Board;
  onBack(): void;
  onCreateAttribute?: () => void;
}) {
  const rootId = board.view.entityDefinitionId;
  const rootAttrs = useAttributes(rootId);
  const definitions = useDefinitions();
  const parentAttr = board.parentAttribute;
  const parentTarget = parentAttr ? (board.schema?.targetOf(parentAttr) ?? null) : null;
  const parentAttrs = useAttributes(parentTarget);
  const parentDef = definitions?.find((d) => d.id === parentTarget);
  const rootDef = definitions?.find((d) => d.id === rootId);
  const current = pathKey(board.groupBy);

  const groups = useMemo(() => {
    const own = (rootAttrs ?? []).filter(isGroupable).map((a) => ({
      attribute: a,
      path: [{ entityDefinitionId: a.entityDefinitionId, attributeDefinitionId: a.id }] as Path,
    }));
    if (!parentAttr)
      return [{ label: `${rootDef?.singularNoun ?? board.definition.singularNoun} attributes`, items: own }];
    const viaParent = (parentAttrs ?? []).filter(isGroupable).map((a) => ({
      attribute: a,
      path: [
        { entityDefinitionId: parentAttr.entityDefinitionId, attributeDefinitionId: parentAttr.id },
        { entityDefinitionId: a.entityDefinitionId, attributeDefinitionId: a.id },
      ] as Path,
    }));
    return [
      ...(parentDef ? [{ label: `${parentDef.singularNoun} attributes`, items: viaParent }] : []),
      { label: 'List attributes', items: own },
    ];
  }, [rootAttrs, parentAttrs, parentAttr, parentDef, rootDef, board.definition.singularNoun]);

  return (
    <>
      <PageHeader title="Grouped by" onBack={onBack} />
      <div className={v.list} role="menu" aria-label="Grouped by">
        {groups.map((group) => (
          <Fragment key={group.label}>
            <div className={v.sectionLabel}>{group.label}</div>
            {group.items.map(({ attribute, path }) => {
              const selected = pathKey(path) === current;
              return (
                <AriaButton
                  key={pathKey(path)}
                  className={`${v.row} ${s.rowButton}`}
                  aria-label={attribute.title}
                  onPress={() => {
                    if (!selected) void board.saveConfig({ groupBy: path, hiddenStageIds: [] });
                    onBack();
                  }}
                >
                  <Icon icon={attributeIcon(attribute)} size={16} className={v.rowIcon} />
                  <span className={v.rowLabel}>{attribute.title}</span>
                  {selected && <Icon icon="checkCircle" size={16} className={v.rowSelected} />}
                </AriaButton>
              );
            })}
            {group.items.length === 0 && <div className={v.empty}>No status attributes</div>}
          </Fragment>
        ))}
        {onCreateAttribute && (
          <>
            <hr className={v.separator} />
            <AriaButton className={`${v.row} ${s.rowButton}`} onPress={onCreateAttribute}>
              <Icon icon="add" size={16} className={v.rowIcon} />
              <span className={v.rowLabel}>Create new attribute</span>
            </AriaButton>
          </>
        )}
      </div>
    </>
  );
}

function VisibleColumnsPage({ board, onBack }: { board: Board; onBack(): void }) {
  const hidden = new Set(board.config.hiddenStageIds);
  return (
    <>
      <PageHeader title="Visible columns" onBack={onBack} />
      <div className={v.list} role="group" aria-label="Visible columns">
        <ColumnSwitch
          label="No status"
          dot={<span className={s.hollowDot} />}
          isSelected={board.config.noStatusVisible}
          onChange={(on) => void board.saveConfig({ noStatusVisible: on })}
          testId={`visible-${NO_STAGE}`}
        />
        <hr className={v.separator} />
        {board.stages.map((stage) => (
          <ColumnSwitch
            key={stage.key}
            label={stage.title}
            dot={<StatusDot color={stage.color} size={8} />}
            isSelected={!hidden.has(stage.key)}
            testId={`visible-${stage.key}`}
            onChange={(on) =>
              void board.saveConfig({
                hiddenStageIds: on
                  ? board.config.hiddenStageIds.filter((id) => id !== stage.key)
                  : [...board.config.hiddenStageIds, stage.key],
              })
            }
          />
        ))}
      </div>
    </>
  );
}

function ColumnSwitch({
  label,
  dot,
  isSelected,
  onChange,
  testId,
}: {
  label: string;
  dot: React.ReactNode;
  isSelected: boolean;
  onChange(on: boolean): void;
  testId: string;
}) {
  return (
    <div
      className={`${v.row} ${s.rowButton}`}
      data-testid={testId}
      onClick={(e) => !(e.target as HTMLElement).closest('label') && onChange(!isSelected)}
    >
      <span className={s.dotSlot} style={{ width: 10 }}>
        {dot}
      </span>
      <span className={v.rowLabel}>{label}</span>
      <Switch aria-label={label} isSelected={isSelected} onChange={onChange} />
    </div>
  );
}

function AddAttributePage({ board, onBack }: { board: Board; onBack(): void }) {
  const definitions = useDefinitions();
  const object = definitions?.find((d) => d.id === board.view.entityDefinitionId);
  return (
    <>
      <PageHeader title="Add attribute to view" onBack={onBack} />
      <PathPicker
        rootDefinitionId={board.view.entityDefinitionId}
        purpose="column"
        placeholder={object ? `Search ${object.singularNoun.toLowerCase()} attributes...` : 'Search attributes...'}
        // Multi-add: the picker stays open (K4).
        onSelect={(selection) => void board.draft.addColumn({ path: selection.path, field: selection.field })}
      />
    </>
  );
}
