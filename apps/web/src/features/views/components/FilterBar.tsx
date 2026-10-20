// Filter bar, simple mode (C1 filters-sorts-calcs §1; evidence C1/19–21, 24): "≡ Filter" when empty; otherwise one
// pill per top-level condition `[icon attribute | operator | value | ⋮]` plus a "+" chip, and the advanced group as
// one "Advanced filter {n}" pill (placed first). Incomplete conditions stay as pills (red ring once their editor
// closes) but never change the results. Edits are view drafts (useViewDraft).
import type { AttributeDefinition } from '@agentic-crm/contracts';
import { AlertDialog, Icon, Menu, MenuItem, MenuTrigger, PopoverPanel } from '@agentic-crm/ui';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button as AriaButton, Dialog } from 'react-aria-components';
import { viewDrafts } from '../draftStore';
import {
  addCondition,
  appendToGroup,
  type ConditionNode,
  countConditions,
  isConditionComplete,
  isPillLayout,
  moveToAdvanced,
  newCondition,
  pillLayout,
  removeNode,
  updateCondition,
} from '../filterModel';
import { operatorLabel, valueKindFor } from '../operators';
import type { PickerSelection } from '../pickerModel';
import type { SchemaIndex } from '../schemaIndex';
import type { ViewDraft } from '../useViewDraft';
import * as s from '../views.css';
import { AdvancedFilterEditor } from './AdvancedFilterEditor';
import {
  AttributeLabel,
  type ConditionPart,
  type ConditionPatch,
  ConditionPopovers,
  useModelEditor,
} from './ConditionPopovers';
import { PathPicker, PICKER_MAX_HEIGHT } from './PathPicker';
import { ValueLabel, valuePlaceholder } from './valueEditors';

export interface FilterBarProps {
  draft: ViewDraft;
}

export function FilterBar({ draft }: FilterBarProps) {
  const model = draft.filterModel;
  const schema = draft.schema;
  const edit = useModelEditor(draft);
  const addRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<{ id: string; part: ConditionPart } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Hand-off from other entry points (header menu "Filter"): open that condition's operator menu.
  const focusId = useSyncExternalStore(
    (cb) => viewDrafts.subscribe(draft.view.id, cb),
    () => viewDrafts.get(draft.view.id).focusConditionId,
  );
  useEffect(() => {
    if (!focusId) return;
    setOpen({ id: focusId, part: 'operator' });
    viewDrafts.setFocus(draft.view.id, undefined);
  }, [focusId, draft.view.id]);

  if (!model || !schema) {
    return (
      <span className={s.placeholderChip} aria-disabled>
        <Icon icon="filter" size={16} />
        Filter
      </span>
    );
  }

  const layout = pillLayout(model);
  const isEmpty = !layout.advanced && layout.pills.length === 0;

  const onPick = (sel: PickerSelection) => {
    setAdding(false);
    const cond = newCondition(sel.path, sel.field);
    if (isPillLayout(model)) {
      edit((m) => addCondition(m, cond));
      setOpen({ id: cond.id, part: 'operator' });
    } else {
      // The whole tree is one advanced filter: add there.
      edit((m) => appendToGroup(m, m.id, cond));
      setAdvancedOpen(true);
    }
  };

  return (
    <div className={s.barScroll} data-testid="filter-bar">
      {layout.advanced && (
        <AdvancedFilterPill
          draft={draft}
          groupId={layout.advanced.id}
          count={countConditions(layout.advanced)}
          isOpen={advancedOpen}
          onOpenChange={setAdvancedOpen}
          onDelete={() =>
            edit((m) =>
              m.id === layout.advanced?.id ? { ...m, children: [] } : removeNode(m, layout.advanced?.id ?? ''),
            )
          }
        />
      )}
      {layout.pills.map((cond) => (
        <FilterPill
          key={cond.id}
          condition={cond}
          rootDefinitionId={draft.view.entityDefinitionId}
          schema={schema}
          open={open?.id === cond.id ? open.part : null}
          setOpen={(part) => setOpen(part ? { id: cond.id, part } : null)}
          onPatch={(patch) => edit((m) => updateCondition(m, cond.id, patch))}
          onRemove={() => edit((m) => removeNode(m, cond.id))}
          hasAdvanced={Boolean(layout.advanced)}
          onToAdvanced={() => {
            edit((m) => moveToAdvanced(m, cond.id).model);
            setAdvancedOpen(true);
          }}
        />
      ))}
      <AriaButton
        ref={addRef}
        className={isEmpty ? s.placeholderChip : `${s.placeholderChip} ${s.placeholderChipIconOnly}`}
        aria-label={isEmpty ? undefined : 'Add filter'}
        aria-expanded={adding}
        onPress={() => setAdding(true)}
      >
        <Icon icon={isEmpty ? 'filter' : 'add'} size={16} />
        {isEmpty && 'Filter'}
      </AriaButton>
      {adding && (
        <PopoverPanel
          triggerRef={addRef}
          isOpen
          onOpenChange={(o) => !o && setAdding(false)}
          width={274}
          maxHeight={PICKER_MAX_HEIGHT}
        >
          <Dialog aria-label="Filter by attribute" className={s.panelColumn}>
            <PathPicker
              rootDefinitionId={draft.view.entityDefinitionId}
              purpose="filter"
              placeholder="Search attributes..."
              onSelect={onPick}
            />
          </Dialog>
        </PopoverPanel>
      )}
    </div>
  );
}

// ---- one pill ----------------------------------------------------------------------------------------------------

interface FilterPillProps {
  condition: ConditionNode;
  rootDefinitionId: string;
  schema: SchemaIndex;
  open: ConditionPart | null;
  setOpen: (part: ConditionPart | null) => void;
  onPatch: (patch: ConditionPatch) => void;
  onRemove: () => void;
  hasAdvanced: boolean;
  onToAdvanced: () => void;
}

function FilterPill({
  condition,
  rootDefinitionId,
  schema,
  open,
  setOpen,
  onPatch,
  onRemove,
  hasAdvanced,
  onToAdvanced,
}: FilterPillProps) {
  const attributeRef = useRef<HTMLButtonElement>(null);
  const operatorRef = useRef<HTMLButtonElement>(null);
  const valueRef = useRef<HTMLButtonElement>(null);
  const attribute: AttributeDefinition | undefined = schema.leaf(condition.path);
  const complete = isConditionComplete(condition, schema.resolve);
  const kind = attribute && condition.operator ? valueKindFor(attribute, condition.field, condition.operator) : null;
  const undisplayable = Boolean(condition.raw);

  return (
    <div className={s.group} data-invalid={(!complete && open === null) || undefined} data-testid="filter-pill">
      <AriaButton
        ref={attributeRef}
        className={s.segment}
        aria-expanded={open === 'attribute'}
        onPress={() => setOpen('attribute')}
      >
        <AttributeLabel schema={schema} condition={condition} />
      </AriaButton>
      {undisplayable ? (
        <span className={`${s.segment} ${s.segmentMuted}`}>This condition cannot be displayed</span>
      ) : (
        <AriaButton
          ref={operatorRef}
          className={condition.operator ? s.segment : `${s.segment} ${s.segmentPlaceholder}`}
          aria-expanded={open === 'operator'}
          onPress={() => setOpen('operator')}
          isDisabled={!attribute}
        >
          <span className={s.segmentText}>
            {condition.operator && attribute
              ? operatorLabel(attribute, condition.field, condition.operator)
              : 'Select condition'}
          </span>
        </AriaButton>
      )}
      {!undisplayable && kind && kind !== 'none' && attribute && (
        <AriaButton
          ref={valueRef}
          className={
            condition.value !== undefined && complete
              ? s.segment
              : `${s.segment} ${s.segmentPlaceholder} ${s.segmentValuePlaceholder}`
          }
          aria-expanded={open === 'value'}
          onPress={() => setOpen('value')}
        >
          <span className={s.segmentText}>
            {condition.value !== undefined && complete ? (
              <ValueLabel attribute={attribute} kind={kind} value={condition.value} />
            ) : (
              valuePlaceholder(kind)
            )}
          </span>
        </AriaButton>
      )}
      <MenuTrigger>
        <AriaButton className={`${s.segment} ${s.segmentIcon}`} aria-label="Filter options">
          <Icon icon="moreVertical" size={16} />
        </AriaButton>
        <Menu
          aria-label="Filter options"
          onAction={(key) => {
            if (key === 'delete') onRemove();
            if (key === 'advanced') onToAdvanced();
          }}
        >
          {complete && (
            <MenuItem id="advanced" icon="filter">
              {hasAdvanced ? 'Add to advanced filter' : 'Convert to advanced filter'}
            </MenuItem>
          )}
          <MenuItem id="delete" icon="delete">
            Delete filter
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <ConditionPopovers
        condition={condition}
        rootDefinitionId={rootDefinitionId}
        schema={schema}
        refs={{ attribute: attributeRef, operator: operatorRef, value: valueRef }}
        open={open}
        setOpen={setOpen}
        onPatch={onPatch}
      />
    </div>
  );
}

// ---- advanced pill -------------------------------------------------------------------------------------------------

function AdvancedFilterPill({
  draft,
  groupId,
  count,
  isOpen,
  onOpenChange,
  onDelete,
}: {
  draft: ViewDraft;
  groupId: string;
  count: number;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState(false);
  return (
    <div ref={ref} className={s.group} data-testid="advanced-filter-pill">
      <AriaButton className={s.segment} aria-expanded={isOpen} onPress={() => onOpenChange(true)}>
        <span className={s.segmentText}>Advanced filter</span>
        <span className={s.badge}>{count}</span>
      </AriaButton>
      <MenuTrigger>
        <AriaButton className={`${s.segment} ${s.segmentIcon}`} aria-label="Advanced filter options">
          <Icon icon="moreVertical" size={16} />
        </AriaButton>
        <Menu aria-label="Advanced filter options" onAction={(key) => key === 'delete' && setConfirm(true)}>
          <MenuItem id="delete" icon="delete">
            Delete filter
          </MenuItem>
        </Menu>
      </MenuTrigger>
      {isOpen && (
        <PopoverPanel triggerRef={ref} isOpen onOpenChange={onOpenChange} padding={0}>
          <Dialog aria-label="Advanced filter" className={s.panelColumn}>
            <AdvancedFilterEditor draft={draft} groupId={groupId} onEmpty={() => onOpenChange(false)} />
          </Dialog>
        </PopoverPanel>
      )}
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Delete advanced filter"
        description="All conditions of this advanced filter will be removed."
        confirmLabel="Delete filter"
        onConfirm={onDelete}
      />
    </div>
  );
}
