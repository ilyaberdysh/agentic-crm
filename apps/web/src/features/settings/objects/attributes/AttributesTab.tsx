// Attributes tab:
// "Attributes / Modify and add object attributes" + "+ Create attribute"; search + Filter (one checkbox per data
// type present, Hide archived, Hide system, Reset filters); table ⋮⋮ · Name (type icon, ⓘ, related object) · Data
// type · Constraints · Properties ("System") · ⋮; system attributes first; collapsible "Archived" band. Rows reorder
// by drag (rank of the moved row only). Row menu: Edit · Duplicate · Copy ID · Copy slug · Change slug · Archive
// (Restore when archived); system rows: Copy ID · Copy slug. Archive asks, then toasts "<title> attribute archived"
// with Undo.
import { type AttributeDefinition, type EntityDefinition, rankBetween } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Badge,
  Banner,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  SearchField,
  Skeleton,
  toast,
} from '@agentic-crm/ui';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { outputLabel as formulaOutputLabel } from '../../../formulas';
import { useWorkspace } from '../../../shell/workspaceContext';
import { ChangeSlugDialog } from '../ChangeSlugDialog';
import {
  archiveAttribute,
  duplicateAttribute,
  limitMessage,
  restoreAttribute,
  updateAttribute,
  useAttributes,
  useCapabilities,
  useSettingsObjects,
  writeErrorOf,
} from '../data';
import { useDragReorder } from '../dragReorder';
import * as os from '../objects.css';
import { copyToClipboard, InfoTip, SectionHeader } from '../parts';
import { AttributeDialog, type AttributeDialogMode } from './AttributeDialog';
import * as s from './attributes.css';
import { attributeIcon, dataTypeLabel } from './typeCatalog';

export interface AttributeFilter {
  query: string;
  /** Data type labels to show (empty = all). */
  types: ReadonlySet<string>;
  hideArchived: boolean;
  hideSystem: boolean;
}

export const EMPTY_FILTER: AttributeFilter = { query: '', types: new Set(), hideArchived: false, hideSystem: false };

export function isFiltered(f: AttributeFilter): boolean {
  return Boolean(f.query.trim()) || f.types.size > 0 || f.hideArchived || f.hideSystem;
}

/** Sorted by rank; split into active and archived after the filter. */
export function partitionAttributes(attributes: readonly AttributeDefinition[], f: AttributeFilter) {
  const q = f.query.trim().toLowerCase();
  const visible = [...attributes]
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0))
    .filter((a) => {
      if (f.hideSystem && a.isSystem) return false;
      if (f.types.size > 0 && !f.types.has(dataTypeLabel(a))) return false;
      return !q || a.title.toLowerCase().includes(q) || a.apiSlug.includes(q);
    });
  return {
    active: visible.filter((a) => !a.isArchived),
    archived: f.hideArchived ? [] : visible.filter((a) => a.isArchived),
  };
}

/** "Unique", "Required", "Unique, Required"; system attributes show only Unique (their required flag is managed). */
export function constraintsText(attr: Pick<AttributeDefinition, 'isUnique' | 'isRequired' | 'isSystem'>): string {
  return [attr.isUnique && 'Unique', attr.isRequired && !attr.isSystem && 'Required'].filter(Boolean).join(', ');
}

/** "Budget" → "Budget (2)", or the next free number. */
export function duplicateTitle(title: string, taken: readonly string[]): string {
  const base = title.replace(/ \(\d+\)$/, '');
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export function AttributesTab({ object, canEdit }: { object: EntityDefinition; canEdit: boolean }) {
  const { workspace } = useWorkspace();
  const attributes = useAttributes(workspace, object.id);
  const objects = useSettingsObjects(workspace);
  const capabilities = useCapabilities(workspace);
  const [filter, setFilter] = useState<AttributeFilter>(EMPTY_FILTER);
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<AttributeDialogMode | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [slugTarget, setSlugTarget] = useState<AttributeDefinition | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<AttributeDefinition | null>(null);

  const all = attributes.data ?? [];
  const { active, archived } = useMemo(() => partitionAttributes(all, filter), [all, filter]);
  const typesPresent = useMemo(() => [...new Set(all.map(dataTypeLabel))], [all]);
  const activeObjects = (objects.data ?? []).filter((o) => !o.isArchived);
  const objectById = new Map((objects.data ?? []).map((o) => [o.id, o]));
  const filtered = isFiltered(filter);
  // Archived attributes count towards the per-object limit (409 OVER_USAGE_LIMIT on create / duplicate).
  const attributeLimit = capabilities.data?.quotas.attributes_per_object_hard ?? null;
  const attributeLimitReached = attributeLimit !== null && all.length >= attributeLimit;

  const drag = useDragReorder(
    active,
    (next, movedId) => {
      const i = next.findIndex((a) => a.id === movedId);
      const before = next[i - 1]?.sortOrder ?? null;
      const after = next[i + 1]?.sortOrder ?? null;
      const moved = next[i];
      if (!moved || (before !== null && after !== null && before >= after)) return;
      void updateAttribute(workspace, {
        entityDefinitionId: object.id,
        attributeDefinitionId: movedId,
        sortOrder: rankBetween(before, after),
      }).catch((error) => toast.error({ title: 'Failed to move attribute', description: writeErrorOf(error).message }));
    },
    canEdit && !filtered,
  );

  const openCreate = () => {
    setDialog({ kind: 'create' });
    setDialogOpen(true);
  };
  const openEdit = (attribute: AttributeDefinition) => {
    setDialog({ kind: 'edit', attribute });
    setDialogOpen(true);
  };

  async function archive(attr: AttributeDefinition) {
    try {
      await archiveAttribute(workspace, attr);
      toast.neutral({
        title: (
          <>
            <strong>{attr.title}</strong>{' '}
            <span style={{ color: 'var(--ar-color-content-secondary)' }}>attribute archived</span>
          </>
        ),
        icon: 'delete',
        action: { label: 'Undo', style: 'button', onAction: () => void restore(attr) },
        durationMs: 6000,
      });
    } catch (error) {
      const e = writeErrorOf(error);
      toast.error({
        title:
          e.code === 'ATTRIBUTE_HAS_DEPENDENCIES'
            ? "Unable to archive attribute as it's still in use"
            : 'Failed to archive attribute',
        description: e.code === 'ATTRIBUTE_HAS_DEPENDENCIES' ? undefined : e.message,
      });
    }
  }

  async function restore(attr: AttributeDefinition) {
    try {
      await restoreAttribute(workspace, attr);
    } catch (error) {
      const e = writeErrorOf(error);
      toast.error({ title: 'Cannot restore attribute', description: limitMessage(e) ?? e.message });
    }
  }

  async function duplicate(attr: AttributeDefinition) {
    const sorted = [...all].sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));
    const next = sorted[sorted.findIndex((a) => a.id === attr.id) + 1];
    try {
      await duplicateAttribute(workspace, attr, {
        title: duplicateTitle(
          attr.title,
          all.map((a) => a.title),
        ),
        sortOrder: rankBetween(attr.sortOrder, next && next.sortOrder > attr.sortOrder ? next.sortOrder : null),
      });
    } catch (error) {
      const e = writeErrorOf(error);
      toast.error({ title: 'Failed to duplicate attribute', description: limitMessage(e) ?? e.message });
    }
  }

  const rowHandlers: RowHandlers = {
    onEdit: openEdit,
    onDuplicate: (a) => void duplicate(a),
    onCopy: (text) => void copyToClipboard(text, (t) => toast(t, { icon: 'copy' })),
    onChangeSlug: setSlugTarget,
    onArchive: setArchiveTarget,
    onRestore: (a) => void restore(a),
  };

  return (
    <div className={os.section}>
      <SectionHeader
        title="Attributes"
        description="Modify and add object attributes"
        action={
          canEdit && (
            <Button size={28} icon="add" onPress={openCreate} isDisabled={attributeLimitReached}>
              Create attribute
            </Button>
          )
        }
      />
      {canEdit && attributeLimitReached && (
        <Banner variant="warning" title={`This object has reached the limit of ${attributeLimit} attributes`}>
          Archived attributes count towards the limit. New attributes cannot be created or duplicated.
        </Banner>
      )}
      <div className={`${os.toolbar} ${s.stickyToolbar}`}>
        <SearchField
          aria-label="Search attributes"
          placeholder="Search attributes"
          size={32}
          value={filter.query}
          onChange={(query) => setFilter((f) => ({ ...f, query }))}
          className={os.toolbarSearch}
        />
        <AttributeFilterButton filter={filter} onChange={setFilter} types={typesPresent} />
      </div>
      <div className={`${os.table} ${s.stickyTable}`} role="table" aria-label="Attributes">
        <div className={`${os.tableHeader} ${s.grid} ${s.headerRow} ${s.stickyHeader}`} role="row">
          <div role="columnheader" aria-label="Order" />
          <HeaderCell icon="apps" label="Name" />
          <HeaderCell icon="database" label="Data type" />
          <HeaderCell icon="lock" label="Constraints" />
          <HeaderCell icon="attrMultiSelect" label="Properties" />
          <div role="columnheader" aria-label="Actions" />
        </div>
        {attributes.isPending &&
          [0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={`${os.row} ${s.grid}`} data-static role="row">
              <span />
              <span className={s.indent}>
                <Skeleton shape="text" width={140} />
              </span>
              <span className={s.indent}>
                <Skeleton shape="text" width={60} />
              </span>
            </div>
          ))}
        {attributes.isError && (
          <ErrorState
            message="Something went wrong."
            iconSize={16}
            style={{ padding: 24 }}
            actions={
              <Button variant="secondary" size={28} onPress={() => void attributes.refetch()}>
                Retry
              </Button>
            }
          />
        )}
        {active.map((attr) => (
          <AttributeRow
            key={attr.id}
            attr={attr}
            canEdit={canEdit}
            related={attr.relationship ? objectById.get(attr.relationship.relatedEntityDefinitionId) : undefined}
            handlers={rowHandlers}
            dragProps={drag.rowProps(attr.id)}
            handleProps={drag.handleProps(attr.id)}
            dragEnabled={canEdit && !filtered}
            dropPosition={drag.dropTarget?.id === attr.id ? drag.dropTarget.position : undefined}
            isDragging={drag.dragId === attr.id}
          />
        ))}
        {attributes.data && active.length === 0 && (
          <EmptyState
            icon="apps"
            title={
              filtered
                ? 'No attributes match that filter'
                : archived.length > 0
                  ? 'No active attributes'
                  : 'No attributes created'
            }
            description={
              filtered
                ? undefined
                : archived.length > 0
                  ? 'There are currently no active attributes. Create a new attribute or restore archived attributes'
                  : 'There are currently no attributes created yet'
            }
            style={{ padding: '32px 16px' }}
          />
        )}
        {archived.length > 0 && (
          <>
            <div
              className={s.archivedBand}
              role="button"
              tabIndex={0}
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setShowArchived((v) => !v);
                }
              }}
            >
              <span className={s.bandChevron}>
                <Icon icon={showArchived ? 'chevronUp' : 'chevronDown'} size={12} />
              </span>
              Archived
            </div>
            {showArchived &&
              archived.map((attr) => (
                <AttributeRow
                  key={attr.id}
                  attr={attr}
                  canEdit={canEdit}
                  related={attr.relationship ? objectById.get(attr.relationship.relatedEntityDefinitionId) : undefined}
                  handlers={rowHandlers}
                  archived
                />
              ))}
          </>
        )}
      </div>

      {dialog && (
        <AttributeDialog
          key={dialog.kind === 'edit' ? dialog.attribute.id : 'create'}
          workspace={workspace}
          object={object}
          objects={activeObjects}
          mode={dialog}
          isOpen={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
      <ChangeSlugDialog
        kind="attribute"
        currentSlug={slugTarget?.apiSlug ?? ''}
        isOpen={slugTarget !== null}
        onOpenChange={(open) => !open && setSlugTarget(null)}
        onSave={async (slug) => {
          if (!slugTarget) return;
          try {
            await updateAttribute(workspace, {
              entityDefinitionId: slugTarget.entityDefinitionId,
              attributeDefinitionId: slugTarget.id,
              apiSlug: slug,
            });
          } catch (error) {
            throw writeErrorOf(error);
          }
        }}
      />
      <AlertDialog
        isOpen={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="Are you sure?"
        description="This archives the attribute for all workspace users."
        confirmLabel="Archive attribute"
        onConfirm={() => {
          if (archiveTarget) void archive(archiveTarget);
          setArchiveTarget(null);
        }}
      />
    </div>
  );
}

function HeaderCell({ icon, label }: { icon: Parameters<typeof Icon>[0]['icon']; label: string }) {
  return (
    <div className={`${os.headerCell} ${s.indent}`} role="columnheader">
      <Icon icon={icon} size={14} className={os.headerIcon} />
      {label}
    </div>
  );
}

interface RowHandlers {
  onEdit: (a: AttributeDefinition) => void;
  onDuplicate: (a: AttributeDefinition) => void;
  onCopy: (text: string) => void;
  onChangeSlug: (a: AttributeDefinition) => void;
  onArchive: (a: AttributeDefinition) => void;
  onRestore: (a: AttributeDefinition) => void;
}

function AttributeRow({
  attr,
  canEdit,
  related,
  handlers,
  archived,
  dragProps,
  handleProps,
  dragEnabled,
  dropPosition,
  isDragging,
}: {
  attr: AttributeDefinition;
  canEdit: boolean;
  related?: EntityDefinition;
  handlers: RowHandlers;
  archived?: boolean;
  dragProps?: ReturnType<ReturnType<typeof useDragReorder>['rowProps']>;
  handleProps?: ReturnType<ReturnType<typeof useDragReorder>['handleProps']>;
  dragEnabled?: boolean;
  dropPosition?: 'before' | 'after';
  isDragging?: boolean;
}) {
  const editable = canEdit && !attr.isSystem && !archived;
  const open = () => editable && handlers.onEdit(attr);
  const classes = [
    os.row,
    s.grid,
    dropPosition === 'before' ? s.dropBefore : dropPosition === 'after' ? s.dropAfter : '',
    isDragging ? s.dragging : '',
  ].join(' ');
  return (
    <div
      className={classes}
      role="row"
      tabIndex={0}
      data-muted={archived || undefined}
      data-static={!editable || undefined}
      onClick={open}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          open();
        }
      }}
      {...dragProps}
    >
      <div className={os.cell} role="cell">
        {!archived && (
          <span
            className={`${s.dragHandle} ${dragEnabled ? '' : s.dragHandleDisabled}`}
            aria-hidden="true"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            {...handleProps}
          >
            <Icon icon="drag" size={14} />
          </span>
        )}
      </div>
      <div className={`${os.cell} ${s.indent}`} role="cell">
        <Icon icon={attributeIcon(attr)} size={16} className={archived ? os.muted : s.typeIcon} />
        <span className={os.cellText}>{attr.title}</span>
        {!attr.isSystem && (
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <InfoTip content={attr.description || `Slug: ${attr.apiSlug}`} label={`About ${attr.title}`} />
          </span>
        )}
        {related && (
          <span className={s.relationChip}>
            <Icon icon="link" size={12} className={s.relationIcon} />
            <span className={os.cellText}>{related.pluralNoun}</span>
          </span>
        )}
      </div>
      <div className={`${os.cell} ${s.indent}`} role="cell">
        <span className={os.cellText}>
          {dataTypeLabel(attr)}
          {attr.formulaConfiguration && (
            <span className={os.muted} style={{ marginLeft: 4 }}>
              {formulaOutputLabel(attr.type)}
            </span>
          )}
        </span>
      </div>
      <div className={`${os.cell} ${s.indent}`} role="cell">
        <span className={os.cellText}>{constraintsText(attr)}</span>
      </div>
      <div className={`${os.cell} ${s.indent}`} role="cell">
        {attr.isSystem && (
          <Badge variant="tertiary" size={16}>
            System
          </Badge>
        )}
        {attr.aiAutofillConfiguration?.isEnabled && (
          <Badge variant="tertiary" size={16}>
            AI Autofill
          </Badge>
        )}
      </div>
      <div
        className={os.rowActions}
        role="cell"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="options" variant="ghost" size={28} />
          <Menu aria-label="options" placement="bottom end" width={200}>
            {editable && (
              <MenuItem icon="edit" onAction={() => handlers.onEdit(attr)}>
                Edit attribute
              </MenuItem>
            )}
            {editable && !attr.relationship && (
              <MenuItem icon="copy" onAction={() => handlers.onDuplicate(attr)}>
                Duplicate attribute
              </MenuItem>
            )}
            <MenuItem icon="copy" onAction={() => handlers.onCopy(attr.id)}>
              Copy ID
            </MenuItem>
            <MenuItem icon="link" onAction={() => handlers.onCopy(attr.apiSlug)}>
              Copy slug
            </MenuItem>
            {editable && (
              <MenuItem icon="edit" onAction={() => handlers.onChangeSlug(attr)}>
                Change slug
              </MenuItem>
            )}
            {canEdit && !attr.isSystem && <MenuSeparator />}
            {canEdit && !attr.isSystem && !archived && (
              <MenuItem icon="delete" variant="danger" onAction={() => handlers.onArchive(attr)}>
                Archive attribute
              </MenuItem>
            )}
            {canEdit && !attr.isSystem && archived && (
              <MenuItem icon="undo" onAction={() => handlers.onRestore(attr)}>
                Restore attribute
              </MenuItem>
            )}
          </Menu>
        </MenuTrigger>
      </div>
    </div>
  );
}

function AttributeFilterButton({
  filter,
  onChange,
  types,
}: {
  filter: AttributeFilter;
  onChange: (f: AttributeFilter) => void;
  types: string[];
}) {
  const toggleType = (label: string, on: boolean) => {
    const next = new Set(filter.types);
    if (on) next.add(label);
    else next.delete(label);
    onChange({ ...filter, types: next });
  };
  const active = filter.types.size > 0 || filter.hideArchived || filter.hideSystem;
  return (
    <Popover
      aria-label="Filter attributes"
      placement="bottom end"
      padding={0}
      trigger={
        <Button variant="secondary" size={32} icon="filter" isActive={active}>
          Filter
        </Button>
      }
    >
      <div className={s.filterPanel}>
        <div className={s.filterHeader}>
          <span>Filter by</span>
          <AriaButton className={s.linkButton} onPress={() => onChange({ ...EMPTY_FILTER, query: filter.query })}>
            Reset filters
          </AriaButton>
        </div>
        <div className={s.filterList}>
          {types.map((label) => (
            <div key={label} className={s.filterItem}>
              <Checkbox isSelected={filter.types.has(label)} onChange={(on) => toggleType(label, on)}>
                {label}
              </Checkbox>
            </div>
          ))}
          <div className={s.filterSeparator} />
          <div className={s.filterItem}>
            <Checkbox
              isSelected={filter.hideArchived}
              onChange={(hideArchived) => onChange({ ...filter, hideArchived })}
            >
              Hide archived
            </Checkbox>
          </div>
          <div className={s.filterItem}>
            <Checkbox isSelected={filter.hideSystem} onChange={(hideSystem) => onChange({ ...filter, hideSystem })}>
              Hide system
            </Checkbox>
          </div>
        </div>
      </div>
    </Popover>
  );
}
