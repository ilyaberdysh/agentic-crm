// View settings (C1 README §3.2, evidence C1/12, 13): "View settings" button (hotkey `y`) → 270 px popover, max 60vh:
// the view's columns in order (drag handle, type icon, title or "A › B" path, "⋮" view attribute menu with Edit
// attribute / Change attribute label / Formatting › / Remove column) and "+ Add attribute to view ›". Tables have no
// density/row-height/wrap settings (bundle 108318).
import type { AttributeDefinition, ViewColumn } from '@agentic-crm/contracts';
import { Button, Icon, IconButton, MenuTrigger, PopoverPanel } from '@agentic-crm/ui';
import { Fragment, useRef, useState } from 'react';
import { Dialog } from 'react-aria-components';
import { useShortcut } from '../../../lib/shortcuts';
import { attributeIcon } from '../operators';
import { useVerticalReorder } from '../useVerticalReorder';
import type { ViewDraft } from '../useViewDraft';
import * as s from '../views.css';
import { AddColumnPopover } from './AddColumnPicker';
import { ColumnSettingsMenuItems } from './ColumnMenus';
import { ColumnLabelDialog } from './dialogs';

export interface ViewSettingsPopoverProps {
  draft: ViewDraft;
  onEditAttribute?: (attribute: AttributeDefinition) => void;
  onCreateAttribute?: () => void;
  /** Binds `y` (default true). */
  shortcut?: boolean;
}

export function ViewSettingsPopover({
  draft,
  onEditAttribute,
  onCreateAttribute,
  shortcut = true,
}: ViewSettingsPopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [labelFor, setLabelFor] = useState<ViewColumn | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useShortcut(shortcut ? 'y' : null, () => setOpen(true));

  const reorder = useVerticalReorder(listRef, (from, to) => {
    const column = draft.columns[from];
    if (column) void draft.moveColumn(column.id, { index: to });
  });
  const dropTop = reorder.dropLineTop();

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
      <PopoverPanel triggerRef={triggerRef} isOpen={open} onOpenChange={setOpen} className={s.settingsPanel}>
        <Dialog aria-label="View settings" className={s.panelColumn}>
          <div
            ref={listRef}
            className={s.list}
            style={{ position: 'relative', paddingBottom: 8 }}
            role="list"
            aria-label="Columns"
          >
            {draft.columns.map((column, i) => {
              const attribute = draft.schema?.leaf(column.path);
              const parts = draft.schema?.pathParts(column.path, column.field) ?? [];
              return (
                <div
                  key={column.id}
                  role="listitem"
                  data-reorder-index={i}
                  data-active={hover === column.id || undefined}
                  className={`${s.row} ${reorder.dragging === i ? s.sortRowDragging : ''}`}
                  onMouseEnter={() => setHover(column.id)}
                  onMouseLeave={() => setHover((h) => (h === column.id ? null : h))}
                  style={{ paddingLeft: 4 }}
                >
                  <span
                    className={s.dragHandle}
                    style={{ height: 20 }}
                    onPointerDown={(e) => reorder.onPointerDown(i, e)}
                    aria-hidden
                  >
                    <Icon icon="drag" size={14} />
                  </span>
                  {attribute && <Icon icon={attributeIcon(attribute)} size={16} className={s.rowIcon} />}
                  <span className={s.rowLabel}>{column.title ?? <PathLabel parts={parts} />}</span>
                  <MenuTrigger>
                    <IconButton icon="moreVertical" size={20} aria-label="View attribute menu" />
                    <PopoverPanel placement="bottom start" offset={4} width={190}>
                      <ColumnSettingsMenuItems
                        draft={draft}
                        column={column}
                        onEditAttribute={onEditAttribute}
                        onLabel={() => setLabelFor(column)}
                      />
                    </PopoverPanel>
                  </MenuTrigger>
                </div>
              );
            })}
            {dropTop !== null && <div className={s.dropLine} style={{ top: dropTop }} />}
          </div>
          {draft.columns.length > 0 && <hr className={s.separator} />}
          <div
            ref={addRef}
            role="button"
            tabIndex={0}
            className={s.row}
            data-active={adding || hover === 'add' || undefined}
            onMouseEnter={() => setHover('add')}
            onMouseLeave={() => setHover(null)}
            onClick={() => setAdding(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'ArrowRight') setAdding(true);
            }}
          >
            <Icon icon="add" size={16} className={s.rowIcon} />
            <span className={s.rowLabel}>Add attribute to view</span>
            <Icon icon="chevronRight" size={16} className={s.chevron} />
          </div>
        </Dialog>
      </PopoverPanel>
      {adding && (
        <AddColumnPopover
          draft={draft}
          triggerRef={addRef}
          isOpen
          onOpenChange={(o) => !o && setAdding(false)}
          placement="end top"
          onCreateAttribute={onCreateAttribute}
        />
      )}
      <ColumnLabelDialog
        isOpen={labelFor !== null}
        onOpenChange={(o) => !o && setLabelFor(null)}
        viewTitle={draft.view.title}
        attributeTitle={labelFor ? (draft.schema?.pathLabel(labelFor.path, labelFor.field) ?? '') : ''}
        currentLabel={labelFor?.title ?? null}
        onSave={(title) => labelFor && void draft.updateColumn(labelFor.id, { title })}
      />
    </>
  );
}

/** "Next due task › Due date": parts joined by a small chevron, on one line. */
export function PathLabel({ parts }: { parts: string[] }) {
  return (
    <span className={s.pathLabel}>
      {parts.map((part, j) => (
        <Fragment key={`${j}:${part}`}>
          {j > 0 && <Icon icon="chevronRight" size={12} className={s.pathSep} />}
          <span className={s.pathPart}>{part}</span>
        </Fragment>
      ))}
    </span>
  );
}
