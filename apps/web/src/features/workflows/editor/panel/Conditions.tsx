// Conditions of Filter / If / Switch: "+ Add condition" opens the
// variable picker for the subject; a condition shows the subject chip, the operator menu ("Select condition ⌄" until
// chosen; operators by subject type via conditionOperatorsFor), the value (static or {x} variable) and ⋮ "Convert to
// advanced condition" / "Delete condition". Several conditions combine with and / or; advanced conditions are nested
// groups. Stored as `binary-predicate` or `predicate-group` (contracts ConfigExpr). Switch = cases (label +
// conditions) with "+ Add case"; outcomes are the cases plus Default.
import {
  type ConditionOperator,
  type ConfigExpr,
  conditionOperators,
  conditionOperatorsFor,
  UNARY_CONDITION_OPERATORS,
  type VariableExpr,
  type WfType,
} from '@agentic-crm/contracts';
import { Button, Icon, IconButton, Menu, MenuItem, MenuList, MenuTrigger, PopoverPanel } from '@agentic-crm/ui';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { Dialog } from 'react-aria-components';
import { newId } from '../../../../lib/ids';
import { useVariables } from '../../data';
import { stringOf } from '../../model/config';
import { type PickerData, variableTypeOf } from '../../model/variables';
import { useEditorUi } from '../EditorContext';
import * as cs from './conditions.css';
import type { InputProps } from './Field';
import * as s from './panel.css';
import { VarButton, VariableChip } from './VariableChip';
import { VariablePicker } from './VariablePicker';

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is: 'is',
  'is-not': 'is not',
  'greater-than': 'greater than',
  'greater-than-or-equal-to': 'greater or equal to',
  'less-than': 'less than',
  'less-than-or-equal-to': 'less or equal to',
  'is-empty': 'empty',
  'is-not-empty': 'not empty',
  contains: 'contains',
  'does-not-contain': 'does not contain',
  'starts-with': 'starts with',
  'ends-with': 'ends with',
  'is-after': 'is after',
  'is-on-or-after': 'is on or after',
  'is-before': 'is before',
  'is-on-or-before': 'is on or before',
};

interface Leaf {
  kind: 'leaf';
  id: string;
  left: VariableExpr | null;
  operator: ConditionOperator | null;
  right: ConfigExpr | null;
}
interface Group {
  kind: 'group';
  id: string;
  logic: 'and' | 'or';
  items: (Leaf | Group)[];
}

function parse(expr: ConfigExpr | undefined): Group {
  const toNode = (e: ConfigExpr): Leaf | Group | null => {
    if (e.type === 'binary-predicate') {
      return {
        kind: 'leaf',
        id: newId(),
        left: e.left.type === 'variable' ? e.left : null,
        operator: e.operator,
        right: e.right ?? null,
      };
    }
    if (e.type === 'predicate-group') {
      return {
        kind: 'group',
        id: newId(),
        logic: e.logic,
        items: e.predicates.map(toNode).filter((n): n is Leaf | Group => n !== null),
      };
    }
    return null;
  };
  if (!expr) return { kind: 'group', id: 'root', logic: 'and', items: [] };
  const node = toNode(expr);
  if (!node) return { kind: 'group', id: 'root', logic: 'and', items: [] };
  return node.kind === 'group' ? { ...node, id: 'root' } : { kind: 'group', id: 'root', logic: 'and', items: [node] };
}

function serialize(root: Group): ConfigExpr | undefined {
  const toExpr = (n: Leaf | Group): ConfigExpr | null => {
    if (n.kind === 'leaf') {
      if (!n.left || !n.operator) return null;
      return {
        type: 'binary-predicate',
        left: n.left,
        operator: n.operator,
        ...(n.right && !UNARY_CONDITION_OPERATORS.has(n.operator) ? { right: n.right } : {}),
      };
    }
    const predicates = n.items.map(toExpr).filter((e): e is ConfigExpr => e !== null);
    if (predicates.length === 0) return null;
    return { type: 'predicate-group', logic: n.logic, predicates };
  };
  const complete = root.items.map(toExpr).filter((e): e is ConfigExpr => e !== null);
  if (complete.length === 0) return undefined;
  if (complete.length === 1 && root.items.length === 1 && root.items[0]?.kind === 'leaf') return complete[0];
  return { type: 'predicate-group', logic: root.logic, predicates: complete };
}

const hasIncomplete = (g: Group): boolean =>
  g.items.some((n) => (n.kind === 'leaf' ? !n.left || !n.operator : hasIncomplete(n)));

function mapNode(g: Group, id: string, fn: (n: Leaf | Group) => Leaf | Group | null): Group {
  const items: (Leaf | Group)[] = [];
  for (const n of g.items) {
    if (n.id === id) {
      const next = fn(n);
      if (next) items.push(next);
    } else if (n.kind === 'group') {
      const next = mapNode(n, id, fn);
      if (next.items.length > 0) items.push(next);
    } else items.push(n);
  }
  return { ...g, items };
}

/** A condition tree editor bound to one config expression. */
export function ConditionsEditor({
  blockId,
  value,
  readOnly,
  onChange,
  testId,
}: {
  blockId: string;
  value: ConfigExpr | undefined;
  readOnly: boolean;
  onChange: (expr: ConfigExpr | undefined) => void;
  testId?: string;
}) {
  const [root, setRoot] = useState<Group>(() => parse(value));
  const [openOperator, setOpenOperator] = useState<string | null>(null);
  const serialized = JSON.stringify(value ?? null);
  const lastSent = useRef(serialized);
  useEffect(() => {
    if (serialized !== lastSent.current && !hasIncomplete(root)) {
      lastSent.current = serialized;
      setRoot(parse(value));
    }
  }, [serialized]);

  const update = (next: Group) => {
    setRoot(next);
    const expr = serialize(next);
    const text = JSON.stringify(expr ?? null);
    if (text !== lastSent.current) {
      lastSent.current = text;
      onChange(expr);
    }
  };

  const addLeaf = (group: Group, left: VariableExpr) => {
    const leaf: Leaf = { kind: 'leaf', id: newId(), left, operator: null, right: null };
    update(
      group.id === 'root'
        ? { ...root, items: [...root.items, leaf] }
        : mapNode(root, group.id, (g) => ({ ...(g as Group), items: [...(g as Group).items, leaf] })),
    );
    setOpenOperator(leaf.id);
  };

  return (
    <div className={cs.conditions} data-testid={testId ?? 'conditions'}>
      <GroupView
        group={root}
        root={root}
        depth={0}
        blockId={blockId}
        readOnly={readOnly}
        openOperator={openOperator}
        setOpenOperator={setOpenOperator}
        update={update}
        addLeaf={addLeaf}
      />
    </div>
  );
}

function GroupView({
  group,
  root,
  depth,
  blockId,
  readOnly,
  openOperator,
  setOpenOperator,
  update,
  addLeaf,
}: {
  group: Group;
  root: Group;
  depth: number;
  blockId: string;
  readOnly: boolean;
  openOperator: string | null;
  setOpenOperator: (id: string | null) => void;
  update: (g: Group) => void;
  addLeaf: (group: Group, left: VariableExpr) => void;
}) {
  const addRef = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const setLogic = (logic: 'and' | 'or') =>
    update(group.id === 'root' ? { ...root, logic } : mapNode(root, group.id, (g) => ({ ...(g as Group), logic })));
  return (
    <div className={depth > 0 ? cs.group : cs.rootGroup} data-testid={depth > 0 ? 'condition-group' : undefined}>
      {group.items.map((node, i) => (
        <div key={node.id} className={cs.item}>
          {i > 0 && (
            <div className={cs.logicRow}>
              {i === 1 && !readOnly ? (
                <MenuTrigger>
                  <Button variant="ghost" size={20} chevron data-testid="condition-logic">
                    {group.logic}
                  </Button>
                  <Menu aria-label="Combine conditions" onAction={(k) => setLogic(k === 'or' ? 'or' : 'and')}>
                    <MenuItem id="and">and</MenuItem>
                    <MenuItem id="or">or</MenuItem>
                  </Menu>
                </MenuTrigger>
              ) : (
                <span className={cs.logicText}>{group.logic}</span>
              )}
            </div>
          )}
          {node.kind === 'leaf' ? (
            <LeafView
              leaf={node}
              blockId={blockId}
              readOnly={readOnly}
              operatorOpen={openOperator === node.id}
              setOperatorOpen={(o) => setOpenOperator(o ? node.id : null)}
              canConvert={depth === 0}
              onChange={(next) => update(mapNode(root, node.id, () => next))}
              onRemove={() => update(mapNode(root, node.id, () => null))}
              onConvert={() =>
                update(
                  mapNode(root, node.id, (n) => ({ kind: 'group', id: newId(), logic: 'and', items: [n] }) as Group),
                )
              }
            />
          ) : (
            <GroupView
              group={node}
              root={root}
              depth={depth + 1}
              blockId={blockId}
              readOnly={readOnly}
              openOperator={openOperator}
              setOpenOperator={setOpenOperator}
              update={update}
              addLeaf={addLeaf}
            />
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          ref={addRef}
          type="button"
          className={cs.add}
          data-testid="add-condition"
          onClick={() => setPicking(true)}
        >
          <Icon icon="add" size={14} />
          Add condition
        </button>
      )}
      {picking && (
        <PopoverPanel
          triggerRef={addRef}
          isOpen
          onOpenChange={(o) => !o && setPicking(false)}
          placement="bottom start"
          padding={4}
        >
          <Dialog aria-label="Choose a subject" style={{ outline: 'none' }}>
            <VariablePicker
              blockId={blockId}
              onPick={(v) => {
                setPicking(false);
                addLeaf(group, v);
              }}
            />
          </Dialog>
        </PopoverPanel>
      )}
    </div>
  );
}

function rightText(right: ConfigExpr | null): string {
  if (!right) return '';
  if (right.type === 'number') return String(right.value);
  if (right.type === 'boolean') return String(right.value);
  if (right.type === 'timestamp' || right.type === 'date') return right.value.slice(0, 10);
  return stringOf(right) ?? '';
}

function LeafView({
  leaf,
  blockId,
  readOnly,
  operatorOpen,
  setOperatorOpen,
  canConvert,
  onChange,
  onRemove,
  onConvert,
}: {
  leaf: Leaf;
  blockId: string;
  readOnly: boolean;
  operatorOpen: boolean;
  setOperatorOpen: (open: boolean) => void;
  canConvert: boolean;
  onChange: (leaf: Leaf) => void;
  onRemove: () => void;
  onConvert: () => void;
}) {
  const ui = useEditorUi();
  const data = useVariables(ui.page.workflowId, blockId, ui.viewingVersionId).data as PickerData | undefined;
  const subjectType: WfType | null = leaf.left ? variableTypeOf(data, leaf.left) : null;
  const operators = subjectType ? conditionOperatorsFor(subjectType) : [...conditionOperators];
  const unary = leaf.operator ? UNARY_CONDITION_OPERATORS.has(leaf.operator) : false;
  const opRef = useRef<HTMLButtonElement>(null);
  const varRef = useRef<HTMLButtonElement>(null);
  const [pickingRight, setPickingRight] = useState(false);
  const [draft, setDraft] = useState(rightText(leaf.right));
  useEffect(() => setDraft(rightText(leaf.right)), [JSON.stringify(leaf.right)]);
  const compare = subjectType?.kind === 'array' ? subjectType.of : subjectType;

  const commitRight = (text: string) => {
    const t = text.trim();
    if (!t) {
      onChange({ ...leaf, right: null });
      return;
    }
    let right: ConfigExpr = { type: 'string', value: t };
    if ((compare?.kind === 'number' || compare?.kind === 'currency') && !Number.isNaN(Number(t)))
      right = { type: 'number', value: Number(t) };
    else if (compare?.kind === 'boolean') right = { type: 'boolean', value: t === 'true' };
    else if ((compare?.kind === 'timestamp' || compare?.kind === 'date') && /^\d{4}-\d{2}-\d{2}/.test(t)) {
      right =
        compare.kind === 'date'
          ? { type: 'date', value: t.slice(0, 10) }
          : { type: 'timestamp', value: new Date(t).toISOString() };
    }
    onChange({ ...leaf, right });
  };

  return (
    <div className={cs.leaf} data-testid="condition">
      <div className={cs.subject}>
        {leaf.left ? (
          <VariableChip
            blockId={blockId}
            variable={leaf.left}
            readOnly={readOnly}
            onChange={(v) => onChange({ ...leaf, left: v })}
            onRemove={onRemove}
          />
        ) : (
          <span className={s.placeholder}>No subject</span>
        )}
      </div>
      <div className={cs.predicateRow}>
        <button
          ref={opRef}
          type="button"
          className={cs.operator}
          disabled={readOnly}
          aria-expanded={operatorOpen}
          data-testid="condition-operator"
          onClick={() => setOperatorOpen(true)}
        >
          {leaf.operator ? OPERATOR_LABELS[leaf.operator] : 'Select condition'}
          <Icon icon="chevronDown" size={14} />
        </button>
        {leaf.operator && !unary && (
          <div className={cs.valueSlot}>
            {leaf.right?.type === 'variable' ? (
              <VariableChip
                blockId={blockId}
                variable={leaf.right}
                readOnly={readOnly}
                onChange={(v) => onChange({ ...leaf, right: v })}
                onRemove={() => onChange({ ...leaf, right: null })}
              />
            ) : (
              <input
                className={cs.valueInput}
                value={draft}
                readOnly={readOnly}
                placeholder="Value"
                aria-label="Condition value"
                data-testid="condition-value"
                type={compare?.kind === 'timestamp' || compare?.kind === 'date' ? 'date' : 'text'}
                inputMode={compare?.kind === 'number' || compare?.kind === 'currency' ? 'decimal' : undefined}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRight(draft)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            )}
          </div>
        )}
        {leaf.operator && !unary && !readOnly && <VarButton buttonRef={varRef} onPress={() => setPickingRight(true)} />}
        {!readOnly && (
          <MenuTrigger>
            <IconButton icon="moreVertical" size={20} aria-label="Condition options" />
            <Menu
              aria-label="Condition options"
              placement="bottom end"
              width={240}
              onAction={(k) => (k === 'delete' ? onRemove() : onConvert())}
            >
              {canConvert && (
                <MenuItem id="convert" icon="wfSwitch">
                  Convert to advanced condition
                </MenuItem>
              )}
              <MenuItem id="delete" icon="delete" variant="danger">
                Delete condition
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </div>
      <PopoverPanel
        triggerRef={opRef as RefObject<HTMLButtonElement>}
        isOpen={operatorOpen}
        onOpenChange={setOperatorOpen}
        placement="bottom start"
        width={190}
      >
        <MenuList
          aria-label="Condition"
          autoFocus="first"
          onAction={(k) => {
            setOperatorOpen(false);
            onChange({ ...leaf, operator: k as ConditionOperator });
          }}
        >
          {operators.map((op) => (
            <MenuItem key={op} id={op}>
              {OPERATOR_LABELS[op]}
            </MenuItem>
          ))}
        </MenuList>
      </PopoverPanel>
      {pickingRight && (
        <PopoverPanel
          triggerRef={varRef as RefObject<Element>}
          isOpen
          onOpenChange={(o) => !o && setPickingRight(false)}
          placement="bottom end"
          padding={4}
        >
          <Dialog aria-label="Compare with a variable" style={{ outline: 'none' }}>
            <VariablePicker
              blockId={blockId}
              {...(compare ? { expected: compare } : {})}
              onPick={(v) => {
                setPickingRight(false);
                onChange({ ...leaf, right: v });
              }}
            />
          </Dialog>
        </PopoverPanel>
      )}
    </div>
  );
}

/** Filter / If: one condition tree under the "predicate" input. */
export function Conditions({ block, value, readOnly, onChange }: InputProps) {
  return <ConditionsEditor blockId={block.id} value={value} readOnly={readOnly} onChange={onChange} />;
}

/** Switch: cases (label + conditions), "+ Add case"; the Default outcome is implicit. */
export function SwitchCases({ block, value, readOnly, onChange }: InputProps) {
  const cases =
    value?.type === 'array'
      ? value.items.filter((i): i is Extract<ConfigExpr, { type: 'object' }> => i.type === 'object')
      : [];
  const set = (next: typeof cases) => onChange(next.length ? { type: 'array', items: next } : undefined);
  return (
    <div className={cs.cases} data-testid="switch-cases">
      {cases.map((c, i) => {
        const id = stringOf(c.entries.id) ?? `case-${i + 1}`;
        return (
          <div key={id} className={cs.caseBox} data-testid="switch-case">
            <div className={s.row}>
              <input
                className={s.input}
                style={{ height: 32 }}
                aria-label={`Case ${i + 1} label`}
                placeholder={`Case ${i + 1}`}
                defaultValue={stringOf(c.entries.label) ?? ''}
                readOnly={readOnly}
                onBlur={(e) =>
                  set(
                    cases.map((x, k) =>
                      k === i
                        ? { ...x, entries: { ...x.entries, label: { type: 'string', value: e.target.value } } }
                        : x,
                    ),
                  )
                }
              />
              {!readOnly && (
                <IconButton
                  icon="delete"
                  size={28}
                  aria-label="Remove case"
                  onPress={() => set(cases.filter((_, k) => k !== i))}
                />
              )}
            </div>
            <ConditionsEditor
              blockId={block.id}
              value={c.entries.predicate}
              readOnly={readOnly}
              testId="case-conditions"
              onChange={(expr) =>
                set(
                  cases.map((x, k) => {
                    if (k !== i) return x;
                    const entries = { ...x.entries };
                    if (expr) entries.predicate = expr;
                    else delete entries.predicate;
                    return { ...x, entries };
                  }),
                )
              }
            />
          </div>
        );
      })}
      {!readOnly && (
        <button
          type="button"
          className={cs.add}
          data-testid="add-case"
          onClick={() =>
            set([
              ...cases,
              {
                type: 'object',
                entries: {
                  id: { type: 'string', value: `case-${newId().slice(-8)}` },
                  label: { type: 'string', value: '' },
                },
              },
            ])
          }
        >
          <Icon icon="add" size={14} />
          Add case
        </button>
      )}
    </div>
  );
}
