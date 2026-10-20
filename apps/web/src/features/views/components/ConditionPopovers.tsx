// The three editing popovers of one filter condition — attribute picker, operator menu ("Select condition"), value
// editor — anchored to whatever renders the condition (a pill's segments or the advanced editor's dropdowns).
// C1 filters-sorts-calcs §1: picking the attribute opens the operator menu; picking an operator opens the value editor.
import type { AttributeDefinition } from '@agentic-crm/contracts';
import { Icon, MenuItem, MenuList, PopoverPanel } from '@agentic-crm/ui';
import { type RefObject, useRef } from 'react';
import { Dialog } from 'react-aria-components';
import { viewDrafts } from '../draftStore';
import type { ConditionNode, FilterModel } from '../filterModel';
import { attributeIcon, type OperatorId, operatorsFor, valueKindFor } from '../operators';
import type { PickerSelection } from '../pickerModel';
import type { SchemaIndex } from '../schemaIndex';
import type { ViewDraft } from '../useViewDraft';
import * as s from '../views.css';
import { PathPicker, PICKER_MAX_HEIGHT } from './PathPicker';
import { editorWidth, FilterValueEditor } from './valueEditors';

export type ConditionPart = 'attribute' | 'operator' | 'value';

export interface ConditionPatch {
  path?: ConditionNode['path'];
  field?: string | null;
  operator?: OperatorId | null;
  value?: unknown;
}

export interface ConditionPopoversProps {
  condition: ConditionNode;
  rootDefinitionId: string;
  schema: SchemaIndex;
  refs: { attribute: RefObject<Element | null>; operator: RefObject<Element | null>; value: RefObject<Element | null> };
  open: ConditionPart | null;
  setOpen: (part: ConditionPart | null) => void;
  onPatch: (patch: ConditionPatch) => void;
}

export function ConditionPopovers({
  condition,
  rootDefinitionId,
  schema,
  refs,
  open,
  setOpen,
  onPatch,
}: ConditionPopoversProps) {
  const attribute = schema.leaf(condition.path);
  const close = (o: boolean) => !o && setOpen(null);

  const pickAttribute = (sel: PickerSelection) => {
    onPatch({ path: sel.path, field: sel.field, operator: null, value: undefined });
    setOpen('operator');
  };

  const pickOperator = (id: OperatorId) => {
    if (!attribute) return;
    const kind = valueKindFor(attribute, condition.field, id);
    const prevKind = condition.operator ? valueKindFor(attribute, condition.field, condition.operator) : null;
    // Keep the value when the operator changes but the value kind does not (is → is not).
    const keep = prevKind === kind && condition.value !== undefined;
    onPatch({ operator: id, value: keep ? condition.value : undefined });
    setOpen(kind === 'none' || keep ? null : 'value');
  };

  const kind = attribute && condition.operator ? valueKindFor(attribute, condition.field, condition.operator) : 'none';

  return (
    <>
      {open === 'attribute' && (
        <PopoverPanel triggerRef={refs.attribute} isOpen onOpenChange={close} width={274} maxHeight={PICKER_MAX_HEIGHT}>
          <Dialog aria-label="Select attribute" className={s.panelColumn}>
            <PathPicker
              rootDefinitionId={rootDefinitionId}
              purpose="filter"
              placeholder="Search attributes..."
              onSelect={pickAttribute}
            />
          </Dialog>
        </PopoverPanel>
      )}
      {open === 'operator' && attribute && (
        <PopoverPanel triggerRef={refs.operator} isOpen onOpenChange={close}>
          <MenuList
            aria-label="Select condition"
            autoFocus="first"
            onAction={(key) => pickOperator(key as OperatorId)}
            selectionMode="none"
          >
            {operatorsFor(attribute, condition.field).map((op) => (
              <MenuItem key={op.id} id={op.id}>
                {op.label}
              </MenuItem>
            ))}
          </MenuList>
        </PopoverPanel>
      )}
      {open === 'value' && attribute && condition.operator && kind !== 'none' && (
        <PopoverPanel triggerRef={refs.value} isOpen onOpenChange={close} width={editorWidth(kind)}>
          <Dialog aria-label="Value" className={s.panelColumn}>
            <FilterValueEditor
              attribute={attribute}
              kind={kind}
              operator={condition.operator}
              value={condition.value}
              onCommit={(value) => {
                onPatch({ value });
                setOpen(null);
              }}
              onCancel={() => setOpen(null)}
            />
          </Dialog>
        </PopoverPanel>
      )}
    </>
  );
}

// ---- shared by the bar and the advanced editor -------------------------------------------------------------------

/** Applies a model edit to the newest draft model (editors may commit after a re-render). */
export function useModelEditor(draft: ViewDraft) {
  const ref = useRef(draft);
  ref.current = draft;
  return (edit: (model: FilterModel) => FilterModel) => {
    const current = ref.current;
    const latest = viewDrafts.get(current.view.id).filter;
    const model = latest?.kind === 'model' ? latest.model : current.filterModel;
    if (!model) return;
    current.setFilterModel(edit(model));
  };
}

export function AttributeLabel({ schema, condition }: { schema: SchemaIndex; condition: ConditionNode }) {
  const attribute = schema.leaf(condition.path);
  if (!attribute) {
    return (
      <>
        <Icon icon="warning" size={16} />
        <span className={s.segmentText}>Deleted attribute</span>
      </>
    );
  }
  return (
    <>
      <Icon icon={attributeIcon(attribute)} size={16} />
      <span className={s.segmentText}>{schema.pathLabel(condition.path, condition.field, 'filter')}</span>
    </>
  );
}
