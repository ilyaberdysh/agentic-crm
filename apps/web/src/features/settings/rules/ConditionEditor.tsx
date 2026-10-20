// The rule condition ("If … ") editor (J objects-lists §3.2): the same filter model and pickers as views — attribute
// path picker, operator menu, value editor — laid out as the rule dialog's rows: "If", then an And / Or toggle on the
// second row, nested groups one level deep, ⋮ "Convert to group" / "Delete condition" (raw s40–s43).
import type { AttributeDefinition } from '@agentic-crm/contracts';
import { Button, Icon, IconButton, Menu, MenuItem, MenuTrigger, PopoverPanel } from '@agentic-crm/ui';
import { useRef, useState } from 'react';
import { Button as AriaButton, Dialog } from 'react-aria-components';
import { type ConditionPart, ConditionPopovers } from '../../views/components/ConditionPopovers';
import { PathPicker, PICKER_MAX_HEIGHT } from '../../views/components/PathPicker';
import { ValueLabel, valuePlaceholder } from '../../views/components/valueEditors';
import {
  appendToGroup,
  type ConditionNode,
  type FilterModel,
  type FilterNode,
  type GroupNode,
  isConditionComplete,
  newCondition,
  removeNode,
  setGroupMode,
  updateCondition,
  wrapInGroup,
} from '../../views/filterModel';
import { attributeIcon, operatorLabel, valueKindFor } from '../../views/operators';
import type { PickerSelection } from '../../views/pickerModel';
import type { SchemaIndex } from '../../views/schemaIndex';
import { InfoTip } from '../objects/parts';
import * as r from './rules.css';

type OpenState = { id: string; part: ConditionPart } | null;

export interface ConditionEditorProps {
  model: FilterModel;
  onChange: (edit: (model: FilterModel) => FilterModel) => void;
  rootDefinitionId: string;
  schema: SchemaIndex;
  /** Set when the user tried to save with an incomplete condition. */
  showErrors?: boolean;
}

export function ConditionEditor(props: ConditionEditorProps) {
  const { model, onChange, rootDefinitionId, schema } = props;
  const [open, setOpen] = useState<OpenState>(null);

  // Picking the attribute opens the operator menu, picking the operator opens the value editor (J objects-lists §3.2).
  const add = (target: GroupNode, sel: PickerSelection) => {
    const cond: ConditionNode = { ...newCondition(sel.path, sel.field, null) };
    onChange((m) => appendToGroup(m, target.id, cond));
    setOpen({ id: cond.id, part: 'operator' });
  };

  const incomplete = model.children.some((c) => c.kind === 'condition' && !isConditionComplete(c, schema.resolve));
  return (
    <div>
      <div className={r.sectionHead}>
        <span className={r.label}>
          Condition
          <InfoTip content="Requirements will be applied on records that match this filter" />
        </span>
        {model.children.length > 0 && (
          <AddConditionIconButton
            rootDefinitionId={rootDefinitionId}
            model={model}
            onAdd={add}
            isDisabled={incomplete}
          />
        )}
      </div>
      <div className={r.box} data-testid="rule-condition">
        {model.children.length === 0 ? (
          <div className={r.rowLine}>
            <span className={r.prefix}>If</span>
            <AddCondition rootDefinitionId={rootDefinitionId} onSelect={(sel) => add(model, sel)} />
          </div>
        ) : (
          <Rows
            group={model}
            depth={0}
            open={open}
            setOpen={setOpen}
            props={props}
            onAdd={add}
            onToggleMode={(g) => onChange((m) => setGroupMode(m, g.id, g.mode === 'and' ? 'or' : 'and'))}
            onPatch={(id, patch) => onChange((m) => updateCondition(m, id, patch))}
            onRemove={(id) => onChange((m) => removeNode(m, id))}
            onWrap={(id) => onChange((m) => wrapInGroup(m, id))}
          />
        )}
        {props.showErrors && incomplete && <p className={r.incomplete}>Incomplete condition</p>}
      </div>
    </div>
  );
}

/** The "+" of the section header: appends a condition to the root group. */
export function AddConditionIconButton({
  rootDefinitionId,
  model,
  onAdd,
  isDisabled,
}: {
  rootDefinitionId: string;
  model: FilterModel;
  onAdd: (target: GroupNode, sel: PickerSelection) => void;
  isDisabled?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        ref={ref}
        icon="add"
        aria-label="Add condition"
        tooltip="Add condition"
        variant="ghost"
        size={20}
        isDisabled={isDisabled}
        onPress={() => setOpen(true)}
      />
      {open && (
        <PopoverPanel
          triggerRef={ref}
          isOpen
          onOpenChange={setOpen}
          width={274}
          maxHeight={PICKER_MAX_HEIGHT}
          placement="bottom end"
        >
          <Dialog aria-label="Add condition">
            <PathPicker
              rootDefinitionId={rootDefinitionId}
              purpose="filter"
              placeholder="Search attributes..."
              onSelect={(sel) => {
                setOpen(false);
                onAdd(model, sel);
              }}
            />
          </Dialog>
        </PopoverPanel>
      )}
    </>
  );
}

function AddCondition({
  rootDefinitionId,
  onSelect,
  label = 'Condition',
}: {
  rootDefinitionId: string;
  onSelect: (sel: PickerSelection) => void;
  label?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <AriaButton
        ref={ref}
        className={r.addDashed}
        aria-label={`Add ${label.toLowerCase()}`}
        onPress={() => setOpen(true)}
      >
        <Icon icon="add" size={16} />
        {label}
      </AriaButton>
      {open && (
        <PopoverPanel triggerRef={ref} isOpen onOpenChange={setOpen} width={274} maxHeight={PICKER_MAX_HEIGHT}>
          <Dialog aria-label="Add condition">
            <PathPicker
              rootDefinitionId={rootDefinitionId}
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

interface RowsProps {
  group: GroupNode;
  depth: number;
  open: OpenState;
  setOpen: (o: OpenState) => void;
  props: ConditionEditorProps;
  onAdd: (group: GroupNode, sel: PickerSelection) => void;
  onToggleMode: (group: GroupNode) => void;
  onPatch: (id: string, patch: Parameters<typeof updateCondition>[2]) => void;
  onRemove: (id: string) => void;
  onWrap: (id: string) => void;
}

function Rows(rows: RowsProps) {
  const { group, depth } = rows;
  return (
    <>
      {group.children.map((child, i) => (
        <div key={child.id} className={r.rowLine}>
          {depth === 0 ? (
            i === 0 ? (
              <span className={r.prefix}>If</span>
            ) : i === 1 ? (
              <span className={r.prefixToggle}>
                <Button variant="secondary" size={28} iconRight="repeat" onPress={() => rows.onToggleMode(group)}>
                  {group.mode === 'and' ? 'And' : 'Or'}
                </Button>
              </span>
            ) : (
              <span className={r.prefix}>{group.mode === 'and' ? 'And' : 'Or'}</span>
            )
          ) : (
            <span className={r.prefix}>{i === 0 ? '' : group.mode === 'and' ? 'And' : 'Or'}</span>
          )}
          <RowBody node={child} {...rows} />
        </div>
      ))}
    </>
  );
}

function RowBody({ node, ...rows }: RowsProps & { node: FilterNode }) {
  if (node.kind === 'group') {
    return (
      <div className={r.nested}>
        <Rows {...rows} group={node} depth={rows.depth + 1} />
        <div className={r.nestedFooter}>
          <AddCondition
            rootDefinitionId={rows.props.rootDefinitionId}
            label="Condition"
            onSelect={(sel) => rows.onAdd(node, sel)}
          />
          <Button variant="ghost" size={28} onPress={() => rows.onRemove(node.id)}>
            Delete group
          </Button>
        </div>
      </div>
    );
  }
  return <ConditionRow condition={node} {...rows} />;
}

function ConditionRow({ condition, ...rows }: RowsProps & { condition: ConditionNode }) {
  const { schema, rootDefinitionId, showErrors } = rows.props;
  const attributeRef = useRef<HTMLButtonElement>(null);
  const operatorRef = useRef<HTMLButtonElement>(null);
  const valueRef = useRef<HTMLButtonElement>(null);
  const attribute: AttributeDefinition | undefined = schema.leaf(condition.path);
  const open = rows.open?.id === condition.id ? rows.open.part : null;
  const setOpen = (part: ConditionPart | null) => rows.setOpen(part ? { id: condition.id, part } : null);
  const complete = isConditionComplete(condition, schema.resolve);
  const kind = attribute && condition.operator ? valueKindFor(attribute, condition.field, condition.operator) : null;
  return (
    <>
      <div className={r.segments} data-invalid={showErrors && !complete ? true : undefined}>
        <AriaButton
          ref={attributeRef}
          className={r.segment}
          aria-label="Condition attribute"
          aria-expanded={open === 'attribute'}
          onPress={() => setOpen('attribute')}
        >
          {attribute ? (
            <>
              <Icon icon={attributeIcon(attribute)} size={16} />
              <span className={r.segmentText}>{schema.pathLabel(condition.path, condition.field, 'filter')}</span>
            </>
          ) : (
            <span className={r.segmentMuted}>Deleted attribute</span>
          )}
        </AriaButton>
        {!condition.raw && (
          <AriaButton
            ref={operatorRef}
            className={`${r.segment} ${kind && kind !== 'none' ? '' : r.segmentGrow}`}
            aria-label="Condition operator"
            aria-expanded={open === 'operator'}
            isDisabled={!attribute}
            onPress={() => setOpen('operator')}
          >
            {condition.operator && attribute ? (
              operatorLabel(attribute, condition.field, condition.operator)
            ) : (
              <span className={r.segmentMuted}>Select condition</span>
            )}
          </AriaButton>
        )}
        {!condition.raw && kind && kind !== 'none' && attribute && (
          <AriaButton
            ref={valueRef}
            className={`${r.segment} ${r.segmentGrow}`}
            aria-label="Condition value"
            aria-expanded={open === 'value'}
            onPress={() => setOpen('value')}
          >
            {complete && condition.value !== undefined ? (
              <ValueLabel attribute={attribute} kind={kind} value={condition.value} />
            ) : (
              <span className={r.segmentMuted}>{valuePlaceholder(kind)}</span>
            )}
          </AriaButton>
        )}
      </div>
      <MenuTrigger>
        <IconButton icon="moreVertical" size={20} aria-label="Condition options" />
        <Menu
          aria-label="Condition options"
          onAction={(key) => {
            if (key === 'group') rows.onWrap(condition.id);
            if (key === 'delete') rows.onRemove(condition.id);
          }}
        >
          {rows.depth === 0 && (
            <MenuItem id="group" icon="columns">
              Convert to group
            </MenuItem>
          )}
          <MenuItem id="delete" icon="delete">
            Delete condition
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
        onPatch={(patch) => rows.onPatch(condition.id, patch)}
      />
    </>
  );
}
