// Advanced filter editor (C1 filters-sorts-calcs §2; evidence C1/22, 23): ≥ 680 px popover under the "Advanced
// filter" pill. Rows: prefix column ("Where", then an "And ⟲ / Or ⟲" toggle for the group, then static And/Or),
// attribute / operator / value dropdowns and a "⋮" (Convert to group, Delete condition; only Delete inside a nested
// group — one sub-group level). Nested groups are grey boxes with their own "+ Add filter" and "Delete group".
// Footer: "+ Add filter" (disabled while a condition is incomplete) and "Clear all filters".
import type { AttributeDefinition } from '@agentic-crm/contracts';
import { Button, IconButton, Menu, MenuItem, MenuTrigger, PopoverPanel, Tooltip } from '@agentic-crm/ui';
import { useRef, useState } from 'react';
import { Dialog } from 'react-aria-components';
import {
  appendToGroup,
  type ConditionNode,
  clearGroup,
  type FilterNode,
  findNode,
  firstIncomplete,
  type GroupNode,
  isConditionComplete,
  newCondition,
  removeNode,
  setGroupMode,
  updateCondition,
  wrapInGroup,
} from '../filterModel';
import { firstOperatorOf, operatorLabel, valueKindFor } from '../operators';
import type { PickerSelection } from '../pickerModel';
import type { SchemaIndex } from '../schemaIndex';
import type { ViewDraft } from '../useViewDraft';
import * as s from '../views.css';
import { AttributeLabel, type ConditionPart, ConditionPopovers, useModelEditor } from './ConditionPopovers';
import { PathPicker, PICKER_MAX_HEIGHT } from './PathPicker';
import { ValueLabel, valuePlaceholder } from './valueEditors';

export interface AdvancedFilterEditorProps {
  draft: ViewDraft;
  /** The group being edited (the root's advanced child group, or the root itself). */
  groupId: string;
  /** Called when the group disappears (all conditions removed). */
  onEmpty?: () => void;
}

type OpenState = { id: string; part: ConditionPart } | null;

export function AdvancedFilterEditor({ draft, groupId, onEmpty }: AdvancedFilterEditorProps) {
  const edit = useModelEditor(draft);
  const [open, setOpen] = useState<OpenState>(null);
  const model = draft.filterModel;
  const schema = draft.schema;
  const node = model ? findNode(model, groupId) : undefined;
  if (!model || !schema || !node || node.kind !== 'group') {
    return <div className={s.advanced}>Empty - Add a condition</div>;
  }
  const group = node;
  const incomplete = firstIncomplete(model, schema.resolve);

  const add = (target: GroupNode, sel: PickerSelection) => {
    const operator = firstOperatorOf(sel.attribute, sel.field);
    const cond: ConditionNode = { ...newCondition(sel.path, sel.field, operator) };
    edit((m) => appendToGroup(m, target.id, cond));
    const kind = operator ? valueKindFor(sel.attribute, sel.field, operator) : 'none';
    setOpen(kind === 'none' ? null : { id: cond.id, part: 'value' });
  };

  const remove = (id: string) => {
    let emptied = false;
    edit((m) => {
      const next = removeNode(m, id);
      emptied = !findNode(next, groupId) || (findNode(next, groupId) as GroupNode).children.length === 0;
      return next;
    });
    if (emptied) onEmpty?.();
  };

  return (
    <div className={s.advanced} data-testid="advanced-filter-editor">
      <Rows
        group={group}
        depth={0}
        draft={draft}
        schema={schema}
        open={open}
        setOpen={setOpen}
        onToggleMode={(g) => edit((m) => setGroupMode(m, g.id, g.mode === 'and' ? 'or' : 'and'))}
        onPatch={(id, patch) => edit((m) => updateCondition(m, id, patch))}
        onRemove={remove}
        onWrap={(id) => edit((m) => wrapInGroup(m, id))}
        onAdd={add}
      />
      <div className={s.advancedFooter}>
        <AddFilterButton draft={draft} disabled={Boolean(incomplete)} onSelect={(sel) => add(group, sel)} />
        <Button
          variant="ghost"
          size={28}
          onPress={() => {
            edit((m) => clearGroup(m, group.id));
            onEmpty?.();
          }}
        >
          Clear all filters
        </Button>
      </div>
    </div>
  );
}

interface RowsProps {
  group: GroupNode;
  depth: number;
  draft: ViewDraft;
  schema: SchemaIndex;
  open: OpenState;
  setOpen: (o: OpenState) => void;
  onToggleMode: (group: GroupNode) => void;
  onPatch: (id: string, patch: Parameters<typeof updateCondition>[2]) => void;
  onRemove: (id: string) => void;
  onWrap: (id: string) => void;
  onAdd: (group: GroupNode, sel: PickerSelection) => void;
}

function Rows(props: RowsProps) {
  const { group } = props;
  return (
    <div className={s.advancedRows}>
      {group.children.map((child, i) => (
        <div key={child.id} className={s.advancedRow}>
          <div className={s.prefix}>
            {i === 0 ? (
              <span className={s.prefixStatic}>Where</span>
            ) : i === 1 ? (
              <Button variant="secondary" size={28} iconRight="repeat" onPress={() => props.onToggleMode(group)}>
                {group.mode === 'and' ? 'And' : 'Or'}
              </Button>
            ) : (
              <span className={s.prefixText}>{group.mode === 'and' ? 'And' : 'Or'}</span>
            )}
          </div>
          <Row node={child} {...props} />
        </div>
      ))}
    </div>
  );
}

function Row({ node, ...props }: RowsProps & { node: FilterNode }) {
  if (node.kind === 'group') {
    return (
      <div className={s.nestedGroup}>
        <Rows {...props} group={node} depth={props.depth + 1} />
        <div className={s.advancedFooter}>
          <AddFilterButton draft={props.draft} disabled={false} onSelect={(sel) => props.onAdd(node, sel)} />
          <Button variant="ghost" size={28} onPress={() => props.onRemove(node.id)}>
            Delete group
          </Button>
        </div>
      </div>
    );
  }
  return <ConditionRow condition={node} {...props} />;
}

function ConditionRow({ condition, ...props }: RowsProps & { condition: ConditionNode }) {
  const { schema, draft, depth } = props;
  const attributeRef = useRef<HTMLButtonElement>(null);
  const operatorRef = useRef<HTMLButtonElement>(null);
  const valueRef = useRef<HTMLButtonElement>(null);
  const attribute: AttributeDefinition | undefined = schema.leaf(condition.path);
  const open = props.open?.id === condition.id ? props.open.part : null;
  const setOpen = (part: ConditionPart | null) => props.setOpen(part ? { id: condition.id, part } : null);
  const complete = isConditionComplete(condition, schema.resolve);
  const kind = attribute && condition.operator ? valueKindFor(attribute, condition.field, condition.operator) : null;
  return (
    <div className={s.advancedFields}>
      <Button
        ref={attributeRef}
        variant="secondary"
        size={28}
        chevron
        isActive={open === 'attribute'}
        onPress={() => setOpen('attribute')}
      >
        <span className={s.dropdownValue}>
          <AttributeLabel schema={schema} condition={condition} />
        </span>
      </Button>
      {condition.raw ? (
        <span className={s.prefixText}>This condition cannot be displayed</span>
      ) : (
        <Button
          ref={operatorRef}
          variant="secondary"
          size={28}
          chevron
          isActive={open === 'operator'}
          isDisabled={!attribute}
          onPress={() => setOpen('operator')}
        >
          {condition.operator && attribute
            ? operatorLabel(attribute, condition.field, condition.operator)
            : 'Select condition'}
        </Button>
      )}
      {!condition.raw && kind && kind !== 'none' && attribute && (
        <Button
          ref={valueRef}
          variant="secondary"
          size={28}
          chevron
          isActive={open === 'value'}
          onPress={() => setOpen('value')}
        >
          <span
            className={s.dropdownValue}
            style={complete ? undefined : { color: 'var(--ar-color-content-tertiary)' }}
          >
            {complete && condition.value !== undefined ? (
              <ValueLabel attribute={attribute} kind={kind} value={condition.value} />
            ) : (
              valuePlaceholder(kind)
            )}
          </span>
        </Button>
      )}
      <span className={s.advancedRowMenu}>
        <MenuTrigger>
          <IconButton icon="moreVertical" size={20} aria-label="Filter options" />
          <Menu
            aria-label="Filter options"
            onAction={(key) => {
              if (key === 'group') props.onWrap(condition.id);
              if (key === 'delete') props.onRemove(condition.id);
            }}
          >
            {depth === 0 && (
              <MenuItem id="group" icon="columns">
                Convert to group
              </MenuItem>
            )}
            <MenuItem id="delete" icon="delete">
              Delete condition
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </span>
      <ConditionPopovers
        condition={condition}
        rootDefinitionId={draft.view.entityDefinitionId}
        schema={schema}
        refs={{ attribute: attributeRef, operator: operatorRef, value: valueRef }}
        open={open}
        setOpen={setOpen}
        onPatch={(patch) => props.onPatch(condition.id, patch)}
      />
    </div>
  );
}

function AddFilterButton({
  draft,
  disabled,
  onSelect,
}: {
  draft: ViewDraft;
  disabled: boolean;
  onSelect: (sel: PickerSelection) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const button = (
    <Button
      ref={ref}
      variant="secondary"
      size={28}
      icon="add"
      isDisabled={disabled}
      isActive={open}
      onPress={() => setOpen(true)}
    >
      Add filter
    </Button>
  );
  return (
    <>
      {disabled ? (
        <Tooltip content="You have an incomplete condition">
          <span style={{ display: 'inline-flex' }}>{button}</span>
        </Tooltip>
      ) : (
        button
      )}
      {open && (
        <PopoverPanel triggerRef={ref} isOpen onOpenChange={setOpen} width={274} maxHeight={PICKER_MAX_HEIGHT}>
          <Dialog aria-label="Add filter" className={s.panelColumn}>
            <PathPicker
              rootDefinitionId={draft.view.entityDefinitionId}
              purpose="filter"
              placeholder="Search attributes..."
              onSelect={(sel) => {
                setOpen(false);
                onSelect(sel);
              }}
            />
          </Dialog>
        </PopoverPanel>
      )}
    </>
  );
}
