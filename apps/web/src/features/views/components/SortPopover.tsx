// Sorts (C1 filters-sorts-calcs §7; evidence C1/17, 18): "⇅ Sort" chip when empty (picking an attribute adds an
// ascending sort); "Sorted by {first} +{n−1}" otherwise → 480 px popover with one row per sort (drag handle,
// attribute, Ascending/Descending, ×), "+ Add sort" (max 5) and "Learn about sorting". Sorts are view drafts.
import type { Sort } from '@agentic-crm/contracts';
import { Button, Icon, IconButton, Menu, MenuItem, MenuTrigger, PopoverPanel } from '@agentic-crm/ui';
import { useRef, useState } from 'react';
import { Button as AriaButton, Dialog } from 'react-aria-components';
import { attributeIcon } from '../operators';
import type { PickerSelection } from '../pickerModel';
import { MAX_SORTS, moveItem } from '../sortModel';
import { useVerticalReorder } from '../useVerticalReorder';
import type { ViewDraft } from '../useViewDraft';
import * as s from '../views.css';
import { PathPicker, PICKER_MAX_HEIGHT } from './PathPicker';
import { SelectButton } from './SelectButton';

export interface SortPopoverProps {
  draft: ViewDraft;
}

const toSort = (sel: PickerSelection, direction: Sort['direction'] = 'asc'): Sort => ({
  path: sel.path,
  ...(sel.field ? { field: sel.field } : {}),
  direction,
});

export function SortPopover({ draft }: SortPopoverProps) {
  const chipRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const sorts = draft.sorts;
  const schema = draft.schema;
  const first = sorts[0];

  if (!first || !schema) {
    return (
      <>
        <AriaButton ref={chipRef} className={s.placeholderChip} aria-expanded={open} onPress={() => setOpen(true)}>
          <Icon icon="sortToggle" size={16} />
          Sort
        </AriaButton>
        {open && (
          <PopoverPanel triggerRef={chipRef} isOpen onOpenChange={setOpen} width={274} maxHeight={PICKER_MAX_HEIGHT}>
            <Dialog aria-label="Sort by" className={s.panelColumn}>
              <PathPicker
                rootDefinitionId={draft.view.entityDefinitionId}
                purpose="sort"
                placeholder="Search attributes..."
                onSelect={(sel) => {
                  setOpen(false);
                  draft.setSorts([toSort(sel)]);
                }}
              />
            </Dialog>
          </PopoverPanel>
        )}
      </>
    );
  }

  return (
    <>
      <div className={s.group} data-testid="sort-pill">
        <AriaButton ref={chipRef} className={s.segment} aria-expanded={open} onPress={() => setOpen(true)}>
          <Icon icon="sort" size={16} className={s.segmentMuted} />
          <span className={s.segmentMuted}>Sorted by</span>
          <span className={s.segmentText}>{schema.pathLabel(first.path, first.field, 'sort')}</span>
          {sorts.length > 1 && <span className={s.badge}>+{sorts.length - 1}</span>}
        </AriaButton>
      </div>
      {open && (
        <PopoverPanel triggerRef={chipRef} isOpen onOpenChange={setOpen} padding={0}>
          <Dialog aria-label="Sorts" className={s.panelColumn}>
            <SortEditor draft={draft} />
          </Dialog>
        </PopoverPanel>
      )}
    </>
  );
}

function SortEditor({ draft }: { draft: ViewDraft }) {
  const listRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const sorts = draft.sorts;
  const reorder = useVerticalReorder(listRef, (from, to) => draft.setSorts(moveItem(sorts, from, to)));
  const dropTop = reorder.dropLineTop();
  return (
    <div className={s.sortPanel} data-testid="sort-editor">
      <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
        {sorts.map((sort, i) => (
          <SortRow
            key={`${i}:${sort.path.map((h) => h.attributeDefinitionId).join('/')}:${sort.field ?? ''}`}
            draft={draft}
            index={i}
            sort={sort}
            dragging={reorder.dragging === i}
            onHandleDown={(e) => reorder.onPointerDown(i, e)}
          />
        ))}
        {dropTop !== null && <div className={s.dropLine} style={{ top: dropTop - 4 }} />}
      </div>
      <div>
        <Button
          ref={addRef}
          variant="secondary"
          size={28}
          icon="add"
          isDisabled={sorts.length >= MAX_SORTS}
          isActive={adding}
          onPress={() => setAdding(true)}
        >
          Add sort
        </Button>
      </div>
      {adding && (
        <PopoverPanel triggerRef={addRef} isOpen onOpenChange={setAdding} width={274} maxHeight={PICKER_MAX_HEIGHT}>
          <Dialog aria-label="Add sort" className={s.panelColumn}>
            <PathPicker
              rootDefinitionId={draft.view.entityDefinitionId}
              purpose="sort"
              placeholder="Search attributes..."
              onSelect={(sel) => {
                setAdding(false);
                draft.setSorts([...sorts, toSort(sel)]);
              }}
            />
          </Dialog>
        </PopoverPanel>
      )}
      <div className={s.sortFooter}>
        <Icon icon="help" size={16} />
        Learn about sorting
      </div>
    </div>
  );
}

function SortRow({
  draft,
  index,
  sort,
  dragging,
  onHandleDown,
}: {
  draft: ViewDraft;
  index: number;
  sort: Sort;
  dragging: boolean;
  onHandleDown: (e: React.PointerEvent) => void;
}) {
  const fieldRef = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const attribute = draft.schema?.leaf(sort.path);
  const label = draft.schema?.pathLabel(sort.path, sort.field, 'sort') ?? '';
  const replace = (next: Sort | null) => {
    const list = [...draft.sorts];
    if (next) list[index] = next;
    else list.splice(index, 1);
    draft.setSorts(list);
  };
  return (
    <div className={`${s.sortRow} ${dragging ? s.sortRowDragging : ''}`} data-reorder-index={index}>
      <span className={s.dragHandle} onPointerDown={onHandleDown} aria-hidden>
        <Icon icon="drag" size={14} />
      </span>
      <SelectButton
        ref={fieldRef}
        icon={attribute ? attributeIcon(attribute) : 'warning'}
        isActive={picking}
        className={s.sortField}
        onPress={() => setPicking(true)}
      >
        {label}
      </SelectButton>
      <MenuTrigger>
        <SelectButton icon={sort.direction === 'asc' ? 'arrowUp' : 'arrowDown'} className={s.sortDirection}>
          {sort.direction === 'asc' ? 'Ascending' : 'Descending'}
        </SelectButton>
        <Menu aria-label="Direction" onAction={(key) => replace({ ...sort, direction: key as Sort['direction'] })}>
          <MenuItem id="asc" icon="arrowUp">
            Ascending
          </MenuItem>
          <MenuItem id="desc" icon="arrowDown">
            Descending
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <IconButton icon="close" size={28} aria-label="Remove sort" onPress={() => replace(null)} />
      {picking && (
        <PopoverPanel triggerRef={fieldRef} isOpen onOpenChange={setPicking} width={274} maxHeight={PICKER_MAX_HEIGHT}>
          <Dialog aria-label="Sort by" className={s.panelColumn}>
            <PathPicker
              rootDefinitionId={draft.view.entityDefinitionId}
              purpose="sort"
              placeholder="Search attributes..."
              onSelect={(sel) => {
                setPicking(false);
                replace(toSort(sel, sort.direction));
              }}
            />
          </Dialog>
        </PopoverPanel>
      )}
    </div>
  );
}
