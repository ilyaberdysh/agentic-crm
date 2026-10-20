// "Add rule" / "Edit rule" dialog (J objects-lists §3.2, raw s40–s48): Name · Condition ("If", the filter editor of
// views) · Requirement ("Then <attribute> is required / must be empty / must be … <value>", several joined by "And") ·
// "Applies to (optional)" (All members; specific actors are an Enterprise feature). "Incomplete condition" and
// "Incomplete requirement" block saving; leaving with edits asks "Discard changes?".
import type {
  AttributeDefinition,
  EntityDefinition,
  Predicate,
  RequirementOperator,
  Rule,
} from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  DialogFooter,
  DialogHeader,
  FilterableMenu,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  Popover,
  PopoverPanel,
  Skeleton,
  TextInput,
} from '@agentic-crm/ui';
import { useMemo, useRef, useState } from 'react';
import { Button as AriaButton, Dialog } from 'react-aria-components';
import { errorEnvelopeOf } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { useWorkspace } from '../../shell/workspaceContext';
import { editorWidth, FilterValueEditor, ValueLabel, valuePlaceholder } from '../../views/components/valueEditors';
import { useSchemaIndex } from '../../views/data';
import { buildFilter, emptyFilterModel, type FilterModel, filterPaths, parseFilter } from '../../views/filterModel';
import { attributeIcon } from '../../views/operators';
import { definitionsOfPaths, type SchemaIndex } from '../../views/schemaIndex';
import { InfoTip, submitOnModEnter } from '../objects/parts';
import { ConditionEditor } from './ConditionEditor';
import {
  createRule,
  needsValue,
  requirementLabel,
  requirementOperatorsFor,
  requirementValueKind,
  toEditorValue,
  toStoredValue,
  updateRule,
} from './data';
import * as r from './rules.css';

interface ReqDraft {
  key: string;
  /** Server id of an existing requirement (kept so edits keep their ids). */
  id?: string;
  attributeId: string | null;
  operator: RequirementOperator;
  value: unknown;
}

const blankRequirement = (): ReqDraft => ({ key: newId(), attributeId: null, operator: 'required', value: undefined });

export function RuleDialog({
  object,
  rule,
  onClose,
}: {
  object: EntityDefinition;
  rule: Rule | null;
  onClose: () => void;
}) {
  const extra = useMemo(() => definitionsOfPaths(filterPaths((rule?.condition ?? null) as Predicate | null)), [rule]);
  const schema = useSchemaIndex(object.id, extra);
  return schema ? (
    <Editor object={object} rule={rule} schema={schema} onClose={onClose} />
  ) : (
    <Modal isOpen onOpenChange={(o) => !o && onClose()} size={608} aria-label={rule ? 'Edit rule' : 'Add rule'} overlay>
      <DialogHeader title={rule ? 'Edit rule' : 'Add rule'} onClose={onClose} />
      <div className={r.dialogBody}>
        <Skeleton shape="block" height={32} width="100%" />
        <Skeleton shape="block" height={72} width="100%" />
      </div>
    </Modal>
  );
}

function Editor({
  object,
  rule,
  schema,
  onClose,
}: {
  object: EntityDefinition;
  rule: Rule | null;
  schema: SchemaIndex;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const [name, setName] = useState(rule?.name ?? '');
  const [model, setModel] = useState<FilterModel>(() =>
    rule?.condition ? parseFilter(rule.condition as Predicate, schema.resolve) : emptyFilterModel(),
  );
  const [requirements, setRequirements] = useState<ReqDraft[]>(() =>
    rule && rule.requirements.length > 0
      ? rule.requirements.map((q) => ({
          key: q.id,
          id: q.id,
          attributeId: q.attributeDefinitionId,
          operator: q.operator,
          value: q.value,
        }))
      : [blankRequirement()],
  );
  const [touched, setTouched] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [ruleId] = useState(() => rule?.id ?? newId());

  const attributes = useMemo(
    () =>
      (schema.attributes(object.id) ?? []).filter(
        (a) => !a.isArchived && !a.isReadOnly && !a.isHidden && a.systemAttributeType !== 'id',
      ),
    [schema, object.id],
  );
  const attributeOf = (id: string | null) => (id ? attributes.find((a) => a.id === id) : undefined);

  const edit = (fn: () => void) => {
    setTouched(true);
    setError(null);
    fn();
  };

  const requirementComplete = (q: ReqDraft) => {
    const attribute = attributeOf(q.attributeId);
    if (!attribute) return false;
    if (!needsValue(q.operator)) return true;
    return q.value !== undefined && q.value !== null && q.value !== '';
  };
  const requirementsIncomplete = requirements.some((q) => !requirementComplete(q));

  const conditionIncomplete =
    model.children.length > 0 && buildFilter(model, schema.resolve) === null
      ? true
      : model.children.some(
          (c) => c.kind === 'condition' && buildFilter({ ...model, children: [c] }, schema.resolve) === null,
        );

  function requestClose() {
    if (touched) setDiscarding(true);
    else onClose();
  }

  async function save() {
    setShowErrors(true);
    setError(null);
    if (!name.trim()) {
      setError('Add a name for the rule');
      return;
    }
    if (requirementsIncomplete || conditionIncomplete) return;
    setPending(true);
    try {
      const condition = buildFilter(model, schema.resolve) as Predicate | null;
      const payload = requirements.map((q) => ({
        ...(q.id ? { id: q.id } : { id: newId() }),
        attributeDefinitionId: q.attributeId as string,
        operator: q.operator,
        ...(needsValue(q.operator) ? { value: q.value } : {}),
      }));
      if (rule) {
        await updateRule(workspace, object.id, {
          ruleId: rule.id,
          name: name.trim(),
          condition,
          requirements: payload,
        });
      } else {
        await createRule(workspace, {
          id: ruleId,
          entityDefinitionId: object.id,
          name: name.trim(),
          condition,
          requirements: payload,
        });
      }
      onClose();
    } catch (e) {
      const { message } = errorEnvelopeOf(e);
      setError(message ?? (rule ? 'Failed to update rule' : 'Failed to create rule'));
    } finally {
      setPending(false);
    }
  }

  const title = rule ? 'Edit rule' : 'Add rule';
  return (
    <>
      <Modal isOpen onOpenChange={(o) => !o && requestClose()} size={608} aria-label={title} overlay>
        <DialogHeader title={title} icon={<Icon icon="workflows" size={16} />} onClose={requestClose} />
        <div className={r.dialogBody} onKeyDown={submitOnModEnter(() => void save())}>
          <TextInput
            label="Name"
            placeholder="Add name"
            size={32}
            autoFocus
            value={name}
            onChange={(v) => edit(() => setName(v))}
            isInvalid={showErrors && !name.trim()}
          />

          <ConditionEditor
            model={model}
            onChange={(fn) => edit(() => setModel(fn))}
            rootDefinitionId={object.id}
            schema={schema}
            showErrors={showErrors}
          />

          <div>
            <div className={r.sectionHead}>
              <span className={r.label}>Requirement</span>
              <IconButton
                icon="add"
                aria-label="Add requirement"
                tooltip="Add requirement"
                variant="ghost"
                size={20}
                isDisabled={requirementsIncomplete}
                onPress={() => edit(() => setRequirements((prev) => [...prev, blankRequirement()]))}
              />
            </div>
            <div className={r.box} data-testid="rule-requirements">
              {requirements.map((q, i) => (
                <RequirementRow
                  key={q.key}
                  index={i}
                  draft={q}
                  attributes={attributes}
                  attribute={attributeOf(q.attributeId)}
                  canRemove={requirements.length > 1}
                  showError={showErrors && !requirementComplete(q)}
                  onChange={(patch) =>
                    edit(() => setRequirements((prev) => prev.map((x) => (x.key === q.key ? { ...x, ...patch } : x))))
                  }
                  onRemove={() => edit(() => setRequirements((prev) => prev.filter((x) => x.key !== q.key)))}
                />
              ))}
            </div>
          </div>

          <div>
            <div className={r.sectionHead}>
              <span className={r.label}>
                Applies to <span className={r.optional}>(optional)</span>
                <InfoTip content="The members and teams this rule applies to. Will affect the entire workspace if not specified" />
              </span>
              <Popover
                aria-label="Add actor"
                placement="bottom end"
                width={300}
                trigger={<IconButton icon="add" aria-label="Add actor" tooltip="Add actor" variant="ghost" size={20} />}
              >
                <div className={r.upsell}>
                  <span className={r.upsellTitle}>Apply rules for specific actors on the Enterprise plan</span>
                  Upgrade to apply rules to specific members, teams or workflows
                </div>
              </Popover>
            </div>
            <div className={r.appliesBox}>
              <Icon icon="user" size={16} />
              All members
            </div>
          </div>
          {error && (
            <p className={r.errorLine} role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" size={28} shortcut={['esc']} onPress={requestClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size={28}
            shortcut={['mod', 'enter']}
            isPending={pending}
            onPress={() => void save()}
          >
            Save
          </Button>
        </DialogFooter>
      </Modal>
      <AlertDialog
        isOpen={discarding}
        onOpenChange={setDiscarding}
        title="Discard changes?"
        description="You have unsaved changes to this rule. Are you sure you want to leave?"
        confirmLabel="Discard"
        onConfirm={() => {
          setDiscarding(false);
          onClose();
        }}
        onCancel={() => setDiscarding(false)}
      />
    </>
  );
}

// ---- one requirement row -------------------------------------------------------------------------------------------

function RequirementRow({
  index,
  draft,
  attributes,
  attribute,
  canRemove,
  showError,
  onChange,
  onRemove,
}: {
  index: number;
  draft: ReqDraft;
  attributes: AttributeDefinition[];
  attribute: AttributeDefinition | undefined;
  canRemove: boolean;
  showError: boolean;
  onChange: (patch: Partial<ReqDraft>) => void;
  onRemove: () => void;
}) {
  const valueRef = useRef<HTMLButtonElement>(null);
  const [editingValue, setEditingValue] = useState(false);
  const operators = requirementOperatorsFor(attribute ?? null);
  const kind = attribute ? requirementValueKind(attribute) : null;
  const hasValue = needsValue(draft.operator);
  const editorValue = kind ? toEditorValue(kind, draft.value) : undefined;

  const pickAttribute = (next: AttributeDefinition) => {
    const allowed = requirementOperatorsFor(next);
    const operator = allowed.includes(draft.operator) ? draft.operator : 'required';
    onChange({ attributeId: next.id, operator, value: undefined });
  };

  return (
    <>
      <div className={r.rowLine}>
        <span className={r.prefix}>{index === 0 ? 'Then' : 'And'}</span>
        <div className={r.segments} data-invalid={showError ? true : undefined}>
          <MenuTrigger>
            <AriaButton className={r.segment} aria-label="Requirement attribute">
              {attribute ? (
                <>
                  <Icon icon={attributeIcon(attribute)} size={16} />
                  <span className={r.segmentText}>{attribute.title}</span>
                </>
              ) : (
                <>
                  <Icon icon="add" size={16} />
                  <span className={r.segmentMuted}>Attribute</span>
                </>
              )}
            </AriaButton>
            <FilterableMenu
              aria-label="Attributes"
              placeholder="Search attributes..."
              placement="bottom start"
              width={274}
              selectionMode="single"
              selectedKeys={draft.attributeId ? [draft.attributeId] : []}
              onAction={(key) => {
                const next = attributes.find((x) => x.id === String(key));
                if (next) pickAttribute(next);
              }}
            >
              {attributes.map((a) => (
                <MenuItem key={a.id} id={a.id} icon={attributeIcon(a)} textValue={a.title}>
                  {a.title}
                </MenuItem>
              ))}
            </FilterableMenu>
          </MenuTrigger>
          <MenuTrigger>
            <AriaButton
              className={`${r.segment} ${hasValue && kind ? '' : r.segmentGrow}`}
              aria-label="Requirement operator"
            >
              {requirementLabel(draft.operator, attribute ?? null)}
            </AriaButton>
            <Menu
              aria-label="Requirement"
              placement="bottom start"
              width={220}
              selectionMode="single"
              selectedKeys={[draft.operator]}
              disallowEmptySelection
              onAction={(key) => {
                const operator = String(key) as RequirementOperator;
                onChange({ operator, ...(needsValue(operator) ? {} : { value: undefined }) });
              }}
            >
              {operators.map((op) => (
                <MenuItem key={op} id={op}>
                  {requirementLabel(op, attribute ?? null)}
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
          {hasValue && kind && attribute && (
            <AriaButton
              ref={valueRef}
              className={`${r.segment} ${r.segmentGrow}`}
              aria-label="Requirement value"
              aria-expanded={editingValue}
              onPress={() => setEditingValue(true)}
            >
              {draft.value !== undefined && draft.value !== null ? (
                <ValueLabel attribute={attribute} kind={kind} value={editorValue} />
              ) : (
                <span className={r.segmentMuted}>{valuePlaceholder(kind)}</span>
              )}
            </AriaButton>
          )}
        </div>
        <MenuTrigger>
          <IconButton icon="moreVertical" size={20} aria-label="Requirement options" />
          <Menu aria-label="Requirement options" onAction={() => onRemove()}>
            <MenuItem id="delete" icon="delete" isDisabled={!canRemove}>
              Delete
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      {showError && <p className={r.incomplete}>Incomplete requirement</p>}
      {editingValue && attribute && kind && (
        <PopoverPanel triggerRef={valueRef} isOpen onOpenChange={setEditingValue} width={editorWidth(kind)}>
          <Dialog aria-label="Value">
            <FilterValueEditor
              attribute={attribute}
              kind={kind}
              operator="equals"
              value={editorValue}
              onCommit={(value) => {
                const stored = toStoredValue(kind, value);
                if (stored === undefined) return;
                onChange({ value: stored });
                setEditingValue(false);
              }}
              onCancel={() => setEditingValue(false)}
            />
          </Dialog>
        </PopoverPanel>
      )}
    </>
  );
}
