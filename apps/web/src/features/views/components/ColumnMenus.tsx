// Column menus for views:
// - FormattingSubmenu: per-type display overrides saved on the column (date/timestamp/interaction, number, currency);
// - ColumnHeaderMenu: the menu under a column header (sort, move, formatting, label, hide, edit attribute);
// - ColumnSettingsMenu: the "⋮" of a View settings row (edit attribute, change label, formatting, remove).
import type { AttributeDefinition, ViewColumn } from '@agentic-crm/contracts';
import {
  CheckCircleFilled,
  MenuItem,
  MenuList,
  MenuSection,
  MenuSeparator,
  PopoverPanel,
  Submenu,
} from '@agentic-crm/ui';
import { type ReactNode, type RefObject, useState } from 'react';
import {
  type ColumnFormat,
  type CurrencyDecimals,
  type CurrencyDisplay,
  type Grouping,
  patchColumnFormat,
  readColumnFormat,
} from '../columns';
import { defaultSortField, formattingKind, isSortable } from '../operators';
import { applyColumnSort, sortDirectionOf } from '../sortModel';
import type { ColumnPosition } from '../types';
import type { ViewDraft } from '../useViewDraft';
import { requestFilterOn } from '../useViewDraft';
import { AddColumnPopover } from './AddColumnPicker';
import { ColumnLabelDialog } from './dialogs';

const check = <CheckCircleFilled size={16} style={{ color: 'var(--ar-color-content-accent)' }} />;

function Preview({ children }: { children: ReactNode }) {
  return (
    <span style={{ color: 'var(--ar-color-content-tertiary)', fontSize: 12, lineHeight: '16px', marginLeft: 8 }}>
      {children}
    </span>
  );
}

function currencyPart(code: string, display: 'narrowSymbol' | 'name'): string {
  try {
    const parts = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      currencyDisplay: display,
    }).formatToParts(10);
    return parts.find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

const sample = (options: Intl.NumberFormatOptions, value: number) =>
  new Intl.NumberFormat(undefined, options).format(value);

/** Display overrides of the column's type ("Formatting ›"); renders nothing for types without formatting. */
export function FormattingSubmenu({
  column,
  attribute,
  draft,
}: {
  column: ViewColumn;
  attribute: AttributeDefinition;
  draft: ViewDraft;
}) {
  const kind = formattingKind(attribute);
  if (!kind) return null;
  const format = readColumnFormat(column.displayConfiguration);
  const save = <K extends keyof ColumnFormat>(section: K, patch: Partial<NonNullable<ColumnFormat[K]>>) =>
    void draft.updateColumn(column.id, {
      displayConfiguration: patchColumnFormat(column.displayConfiguration, section, patch),
    });

  if (kind === 'datetime') {
    const current = format.datetime?.displayType ?? 'absolute';
    return (
      <Submenu label="Formatting" icon="settings" menuWidth={180}>
        <MenuSection title="Display">
          <MenuItem
            id="dt-absolute"
            onAction={() => save('datetime', { displayType: 'absolute' })}
            trailing={current === 'absolute' ? check : null}
          >
            Absolute
          </MenuItem>
          <MenuItem
            id="dt-relative"
            onAction={() => save('datetime', { displayType: 'relative' })}
            trailing={current === 'relative' ? check : null}
          >
            Relative
          </MenuItem>
        </MenuSection>
      </Submenu>
    );
  }

  if (kind === 'currency') {
    const code = attribute.config.currencyConfiguration?.defaultCurrencyCode ?? 'USD';
    const cur = format.currency ?? {};
    const displays: [CurrencyDisplay, string, string][] = [
      ['symbol', 'Symbol', currencyPart(code, 'narrowSymbol')],
      ['code', 'Code', code],
      ['name', 'Name', currencyPart(code, 'name')],
    ];
    const groups: [Grouping, string][] = [
      ['default', 'Default'],
      ['no-groups', 'No groups'],
    ];
    const decimals: [CurrencyDecimals, string, string][] = [
      ['two-decimals', '2 Decimals', sample({ minimumFractionDigits: 2, maximumFractionDigits: 2 }, 10)],
      ['no-decimals', 'No Decimals', sample({ maximumFractionDigits: 0 }, 10)],
    ];
    return (
      <Submenu label="Formatting" icon="settings" menuWidth={180}>
        <MenuSection title="Display">
          {displays.map(([id, label, preview]) => (
            <MenuItem
              key={id}
              id={`cur-${id}`}
              textValue={label}
              onAction={() => save('currency', { displayType: id })}
              trailing={cur.displayType === id ? check : null}
            >
              {label}
              <Preview>{preview}</Preview>
            </MenuItem>
          ))}
        </MenuSection>
        <MenuSeparator />
        <MenuSection title="Grouping">
          {groups.map(([id, label]) => (
            <MenuItem
              key={id}
              id={`grp-${id}`}
              onAction={() => save('currency', { groups: id })}
              trailing={cur.groups === id ? check : null}
            >
              {label}
            </MenuItem>
          ))}
        </MenuSection>
        <MenuSeparator />
        <MenuSection title="Decimal places">
          {decimals.map(([id, label, preview]) => (
            <MenuItem
              key={id}
              id={`dec-${id}`}
              textValue={label}
              onAction={() => save('currency', { decimalPlaces: id })}
              trailing={cur.decimalPlaces === id ? check : null}
            >
              {label}
              <Preview>{preview}</Preview>
            </MenuItem>
          ))}
        </MenuSection>
      </Submenu>
    );
  }

  const num = format.number ?? {};
  const places = [0, 1, 2, 3, 4] as const;
  return (
    <Submenu label="Formatting" icon="settings" menuWidth={200}>
      <MenuSection title="Grouping">
        <MenuItem
          id="num-grp-default"
          textValue="Default"
          onAction={() => save('number', { groups: 'default' })}
          trailing={num.groups === 'default' ? check : null}
        >
          Default
          <Preview>{sample({ useGrouping: true, maximumFractionDigits: 1 }, 1200.5)}</Preview>
        </MenuItem>
        <MenuItem
          id="num-grp-none"
          textValue="No groups"
          onAction={() => save('number', { groups: 'no-groups' })}
          trailing={num.groups === 'no-groups' ? check : null}
        >
          No groups
          <Preview>{sample({ useGrouping: false, maximumFractionDigits: 1 }, 1200.5)}</Preview>
        </MenuItem>
      </MenuSection>
      <MenuSeparator />
      <MenuSection title="Decimal places">
        {places.map((n) => {
          const label = n === 0 ? 'No Decimals' : n === 1 ? '1 Decimal' : `${n} Decimals`;
          return (
            <MenuItem
              key={n}
              id={`num-dec-${n}`}
              textValue={label}
              onAction={() => save('number', { decimalPlaces: n })}
              trailing={num.decimalPlaces === n ? check : null}
            >
              {label}
              <Preview>{sample({ minimumFractionDigits: n, maximumFractionDigits: n }, 10)}</Preview>
            </MenuItem>
          );
        })}
      </MenuSection>
    </Submenu>
  );
}

function isEditableAttribute(attribute: AttributeDefinition, column: ViewColumn): boolean {
  // Not for system attributes (Created at/by, Record ID) or path columns (C1 item 7).
  return column.path.length === 1 && !attribute.isSystem;
}

export interface ColumnHeaderMenuProps {
  draft: ViewDraft;
  column: ViewColumn;
  /** The header element the menu hangs under (left edge). */
  triggerRef: RefObject<Element | null>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Edit attribute" (attribute admin dialog); hidden when absent or not editable. */
  onEditAttribute?: (attribute: AttributeDefinition) => void;
  /** Extra items beyond the set (off by default to match evidence C1/14): "Filter", "Insert left/right". */
  extraItems?: { filter?: boolean; insert?: boolean };
  /** Called after "Filter" so the page can scroll the filter bar into view. */
  onFilter?: () => void;
  /** AI autofill columns: "Run AI autofill" over every record of the view (ai-attributes). */
  onRunAi?: (attribute: AttributeDefinition) => void;
}

/** Column header menu (260 px, evidence C1/14). */
export function ColumnHeaderMenu({
  draft,
  column,
  triggerRef,
  isOpen,
  onOpenChange,
  onEditAttribute,
  extraItems,
  onFilter,
  onRunAi,
}: ColumnHeaderMenuProps) {
  const [labelOpen, setLabelOpen] = useState(false);
  const [insert, setInsert] = useState<ColumnPosition | null>(null);
  const attribute = draft.schema?.leaf(column.path);
  const index = draft.columns.findIndex((c) => c.id === column.id);
  const isFirst = index <= 0;
  const isLast = index === draft.columns.length - 1;
  const direction = sortDirectionOf(draft.sorts, column.path);
  const sortable = attribute ? isSortable(attribute) : false;
  const attrTitle = attribute ? (draft.schema?.pathLabel(column.path, column.field) ?? attribute.title) : 'Attribute';

  const onAction = (key: React.Key) => {
    onOpenChange(false);
    if (!attribute) return;
    switch (key) {
      case 'sort-asc':
      case 'sort-desc':
        draft.setSorts(
          applyColumnSort(
            draft.sorts,
            column.path,
            defaultSortField(attribute, column.field),
            key === 'sort-asc' ? 'asc' : 'desc',
          ),
        );
        break;
      case 'move-left':
        void draft.moveColumn(column.id, { index: index - 1 });
        break;
      case 'move-right':
        void draft.moveColumn(column.id, { index: index + 1 });
        break;
      case 'label':
        setLabelOpen(true);
        break;
      case 'hide':
        void draft.removeColumn(column.id);
        break;
      case 'edit':
      case 'ai-settings':
        onEditAttribute?.(attribute);
        break;
      case 'ai-run':
        onRunAi?.(attribute);
        break;
      case 'filter':
        requestFilterOn(draft, column.path, column.field);
        onFilter?.();
        break;
      case 'insert-left':
        setInsert({ leftOf: column.id });
        break;
      case 'insert-right':
        setInsert({ rightOf: column.id });
        break;
    }
  };

  return (
    <>
      <PopoverPanel
        triggerRef={triggerRef}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        width={260}
        placement="bottom start"
      >
        <MenuList aria-label="Column options" onAction={onAction} onClose={() => onOpenChange(false)}>
          {sortable && (
            <>
              <MenuItem id="sort-asc" icon="arrowUp" trailing={direction === 'asc' ? check : null}>
                Sort ascending
              </MenuItem>
              <MenuItem id="sort-desc" icon="arrowDown" trailing={direction === 'desc' ? check : null}>
                Sort descending
              </MenuItem>
            </>
          )}
          {!isFirst && (
            <MenuItem id="move-left" icon="arrowLeft">
              Move left
            </MenuItem>
          )}
          {!isLast && (
            <MenuItem id="move-right" icon="arrowRight">
              Move right
            </MenuItem>
          )}
          {extraItems?.insert && (
            <>
              <MenuItem id="insert-left" icon="add">
                Insert left
              </MenuItem>
              <MenuItem id="insert-right" icon="add">
                Insert right
              </MenuItem>
            </>
          )}
          {extraItems?.filter && (
            <MenuItem id="filter" icon="filter">
              Filter
            </MenuItem>
          )}
          <MenuSeparator />
          {attribute && <FormattingSubmenu column={column} attribute={attribute} draft={draft} />}
          <MenuItem id="label" icon="attrMultiSelect">
            Edit column label
          </MenuItem>
          <MenuItem id="hide" icon="hide">
            Hide from view
          </MenuItem>
          {attribute && onEditAttribute && isEditableAttribute(attribute, column) && (
            <>
              <MenuSeparator />
              <MenuItem id="edit" icon="edit">
                Edit attribute
              </MenuItem>
            </>
          )}
          {attribute?.aiAutofillConfiguration?.isEnabled && column.path.length === 1 && onRunAi && (
            <>
              <MenuSeparator />
              <MenuItem id="ai-run" icon="aiRun">
                Run AI autofill
              </MenuItem>
              {onEditAttribute && (
                <MenuItem id="ai-settings" icon="askAi">
                  AI autofill settings
                </MenuItem>
              )}
            </>
          )}
        </MenuList>
      </PopoverPanel>
      <ColumnLabelDialog
        isOpen={labelOpen}
        onOpenChange={setLabelOpen}
        viewTitle={draft.view.title}
        attributeTitle={attrTitle}
        currentLabel={column.title}
        onSave={(title) => void draft.updateColumn(column.id, { title })}
      />
      {insert && (
        <AddColumnPopover
          draft={draft}
          triggerRef={triggerRef}
          isOpen
          onOpenChange={(o) => !o && setInsert(null)}
          position={insert}
        />
      )}
    </>
  );
}

export interface ColumnSettingsMenuProps {
  draft: ViewDraft;
  column: ViewColumn;
  trigger: React.ReactElement;
  onEditAttribute?: (attribute: AttributeDefinition) => void;
  onLabel: () => void;
}

/** "View attribute menu" of a View settings row (evidence C1/13). */
export function ColumnSettingsMenuItems({
  draft,
  column,
  onEditAttribute,
  onLabel,
}: Omit<ColumnSettingsMenuProps, 'trigger'>) {
  const attribute = draft.schema?.leaf(column.path);
  return (
    <MenuList
      aria-label="View attribute menu"
      onAction={(key) => {
        if (key === 'edit' && attribute) onEditAttribute?.(attribute);
        if (key === 'label') onLabel();
        if (key === 'remove') void draft.removeColumn(column.id);
      }}
    >
      {attribute && onEditAttribute && isEditableAttribute(attribute, column) && (
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
        Remove column
      </MenuItem>
    </MenuList>
  );
}
