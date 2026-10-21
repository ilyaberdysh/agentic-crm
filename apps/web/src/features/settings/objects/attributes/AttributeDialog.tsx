// Create / edit attribute dialog (J attribute-dialogs; raw J s11-dialog, s12-dlg-*, s31-edit-*): 808 px modal,
// "Create attribute" (or the object's plural noun when editing), footer "Cancel ESC" + "Create attribute ⌘↵" /
// "Save changes ⌘↵". Field order follows the observed screens per type and mode. The AI autofill card
// (features/ai-attributes) and the Formula field + editor sheet (features/formulas, the sheet replaces this content in
// the same frame) are hook points into their feature folders; Formula submits only once a formula was saved.
import type { AttributeDefinition, EntityDefinition } from '@agentic-crm/contracts';
import { SAVE_ERROR_MESSAGES, type SaveErrorCode } from '@agentic-crm/formula';
import {
  Banner,
  Checkbox,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FilterableMenu,
  Icon,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Modal,
  Popover,
  Switch,
  TextArea,
  TextInput,
  Tooltip,
} from '@agentic-crm/ui';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useMe } from '../../../../data/session';
import type { WorkspaceRef } from '../../../../data/trpc';
import { newId } from '../../../../lib/ids';
import {
  AiAutofillCard,
  type AiCapableType,
  AUTOFILL_TYPES,
  initialAiState,
  isAiCapable,
  PICKER_SHORTCUTS,
} from '../../../ai-attributes';
import { FormulaField, FormulaSheet, formulaDraftOf, useFormulaSnapshot } from '../../../formulas';
import {
  applyOptionDiff,
  applyStageDiff,
  createAttribute,
  limitMessage,
  updateAttribute,
  useAttributes,
  useCapabilities,
  useMembers,
  useOptions,
  useStages,
  writeErrorOf,
} from '../data';
import * as os from '../objects.css';
import { DialogActions, InfoTip, ObjectTile, submitOnModEnter } from '../parts';
import * as s from './attributes.css';
import { ChoiceListField } from './ChoiceListField';
import { CurrencyConfig, NumberConfig } from './ConfigFields';
import { DefaultValueField } from './DefaultValueField';
import {
  type AttributeFormState,
  aiActive,
  canSubmit,
  diffOptions,
  diffStages,
  type FormErrors,
  formStateOf,
  hasErrors,
  initialFormState,
  toCreateInput,
  toUpdateInput,
  validateForm,
  withPickerType,
} from './formModel';
import { RelationshipForm } from './RelationshipForm';
import {
  constraintsFor,
  hasAiAutofillCard,
  type PickerType,
  pickerEntriesFor,
  pickerEntry,
  pickerTypeOf,
} from './typeCatalog';

/** Which part of an edit save failed (options or stages; otherwise the attribute PATCH). */
type WriteContext = 'options' | 'stages';

export type AttributeDialogMode = { kind: 'create' } | { kind: 'edit'; attribute: AttributeDefinition };

export function AttributeDialog({
  workspace,
  object,
  objects,
  mode,
  isOpen,
  onOpenChange,
  initialType,
  initialTitle,
  onCreated,
}: {
  workspace: WorkspaceRef;
  object: EntityDefinition;
  /** Active objects (record / relationship targets). */
  objects: readonly EntityDefinition[];
  mode: AttributeDialogMode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Create mode: preselected type and name (import mapping "Create new attribute ›" type submenu). */
  initialType?: PickerType;
  initialTitle?: string;
  /** Create mode: the created attribute (before the dialog closes). */
  onCreated?: (attribute: AttributeDefinition) => void;
}) {
  // The formula editor sheet replaces the dialog content without dimming the page (live capture).
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="large"
      overlay={!sheetOpen}
      // The sheet guards leaving ("Discard changes?"): Escape and outside clicks go through it.
      isDismissable={!sheetOpen}
      isKeyboardDismissDisabled={sheetOpen}
      aria-label={mode.kind === 'create' ? 'Create attribute' : 'Edit attribute'}
    >
      {mode.kind === 'create' ? (
        <AttributeForm
          workspace={workspace}
          object={object}
          objects={objects}
          initial={{
            ...initialFormState(
              initialType ?? 'text',
              objects.find((o) => o.entityType === 'person-record')?.id ?? objects[0]?.id ?? null,
            ),
            ...(initialTitle ? { title: initialTitle } : {}),
          }}
          onCreated={onCreated}
          onClose={() => onOpenChange(false)}
          onSheetChange={setSheetOpen}
        />
      ) : (
        <EditLoader
          workspace={workspace}
          object={object}
          objects={objects}
          attribute={mode.attribute}
          onClose={() => onOpenChange(false)}
          onSheetChange={setSheetOpen}
        />
      )}
    </Modal>
  );
}

function EditLoader({
  workspace,
  object,
  objects,
  attribute,
  onClose,
  onSheetChange,
}: {
  workspace: WorkspaceRef;
  object: EntityDefinition;
  objects: readonly EntityDefinition[];
  attribute: AttributeDefinition;
  onClose: () => void;
  onSheetChange?: (open: boolean) => void;
}) {
  const options = useOptions(workspace, attribute);
  const stages = useStages(workspace, attribute);
  const related = useAttributes(workspace, attribute.relationship?.relatedEntityDefinitionId ?? null);
  const reverse = related.data?.find((a) => a.id === attribute.relationship?.relatedAttributeDefinitionId) ?? null;
  const snapshot = useFormulaSnapshot(workspace, attribute.formulaConfiguration ? attribute : null);
  const loading =
    (attribute.type === 'select' && options.isPending) ||
    (attribute.type === 'pipeline' && stages.isPending) ||
    (attribute.relationship !== null && related.isPending) ||
    (Boolean(attribute.formulaConfiguration) && snapshot.isPending);
  if (loading) {
    return (
      <>
        <DialogHeader title={object.pluralNoun} onClose={onClose} />
        <DialogBody className={s.dialogBody}>
          <div className={os.centered}>
            <Icon icon="spinner" size={16} />
          </div>
        </DialogBody>
      </>
    );
  }
  return (
    <AttributeForm
      workspace={workspace}
      object={object}
      objects={objects}
      attribute={attribute}
      originalOptions={options.data}
      originalStages={stages.data}
      reverse={reverse}
      initial={formStateOf(attribute, {
        options: options.data,
        stages: stages.data,
        reverse,
        formula: snapshot.data ? formulaDraftOf(attribute, snapshot.data) : null,
      })}
      onClose={onClose}
      onSheetChange={onSheetChange}
    />
  );
}

function AttributeForm({
  workspace,
  object,
  objects,
  attribute,
  originalOptions,
  originalStages,
  reverse,
  initial,
  onCreated,
  onClose,
  onSheetChange,
}: {
  workspace: WorkspaceRef;
  object: EntityDefinition;
  objects: readonly EntityDefinition[];
  attribute?: AttributeDefinition;
  originalOptions?: Parameters<typeof diffOptions>[0];
  originalStages?: Parameters<typeof diffStages>[0];
  reverse?: AttributeDefinition | null;
  initial: AttributeFormState;
  onCreated?: (attribute: AttributeDefinition) => void;
  onClose: () => void;
  onSheetChange?: (open: boolean) => void;
}) {
  const editing = Boolean(attribute);
  const me = useMe();
  const members = useMembers(workspace);
  const [state, setState] = useState<AttributeFormState>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  // Reveal the error banner at the top of a scrolled body.
  useEffect(() => {
    if (submitError) bannerRef.current?.scrollIntoView({ block: 'nearest' });
  }, [submitError]);
  const capabilities = useCapabilities(workspace);
  const optionLimit = capabilities.data?.quotas.select_options_per_attribute_hard ?? null;
  const ids = useRef({ id: newId(), reverseId: newId() });
  const original = useRef(initial);
  const [formulaOpen, setFormulaOpen] = useState(false);
  useEffect(() => onSheetChange?.(formulaOpen), [formulaOpen, onSheetChange]);
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<AttributeFormState>) => setState((st) => ({ ...st, ...patch }));
  const type = state.pickerType;
  const allowed = constraintsFor(type);

  const recordTargets = useMemo(() => objects.filter((o) => !o.isArchived), [objects]);

  async function submit() {
    if (pending || !canSubmit(state)) return;
    const found = validateForm(state);
    setErrors(found);
    if (hasErrors(found)) {
      if (found.title) nameRef.current?.focus();
      return;
    }
    setPending(true);
    setSubmitError(null);
    try {
      if (!attribute) {
        const created = await createAttribute(
          workspace,
          toCreateInput(state, {
            id: ids.current.id,
            entityDefinitionId: object.id,
            reverseId: ids.current.reverseId,
            snapshotId: newId(),
          }),
        );
        onCreated?.(created);
      } else {
        await saveEdit(attribute);
      }
      onClose();
    } catch (error) {
      const failure = error as { context?: WriteContext; cause?: unknown };
      const e = writeErrorOf(failure.context ? failure.cause : error);
      const limit = limitMessage(e);
      if (limit) {
        setSubmitError(limit);
      } else if (e.code && e.code in SAVE_ERROR_MESSAGES) {
        setSubmitError(SAVE_ERROR_MESSAGES[e.code as SaveErrorCode]);
      } else if (e.code === 'TITLE_IN_USE') {
        const title = typeof e.details?.title === 'string' ? e.details.title.trim().toLowerCase() : null;
        const list = type === 'status' ? state.stages : state.options;
        const hit = list.find((o) => o.title.trim().toLowerCase() === title);
        if (hit) {
          setErrors((er) => ({
            ...er,
            [type === 'status' ? 'stages' : 'options']: { [hit.id]: 'This name is already in use' },
          }));
        }
        setSubmitError(
          type === 'status' ? 'This status name is already in use.' : 'This option name is already in use.',
        );
      } else if (e.code === 'SLUG_IN_USE') {
        setSubmitError('This slug is already in use by another attribute.');
      } else if (failure.context === 'options') {
        setSubmitError('Failed to save select options.');
      } else if (failure.context === 'stages') {
        setSubmitError('Failed to create Pipeline stage; please try again.');
      } else {
        setSubmitError(attribute ? 'Failed to update attribute.' : 'Failed to create attribute.');
      }
      setPending(false);
    }
  }

  async function saveEdit(attr: AttributeDefinition) {
    const step = async (context: WriteContext, run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (cause) {
        throw { context, cause };
      }
    };
    if (type === 'select' || type === 'multi-select') {
      const diff = diffOptions(originalOptions ?? [], state.options);
      if (diff.archive.length + diff.create.length + diff.update.length > 0)
        await step('options', () => applyOptionDiff(workspace, attr, diff));
    }
    if (type === 'status') {
      const diff = diffStages(originalStages ?? [], state.stages);
      if (diff.archive.length + diff.create.length + diff.update.length > 0)
        await step('stages', () => applyStageDiff(workspace, attr, diff));
    }
    const patch = toUpdateInput(attr, state, original.current, newId());
    if (patch) await updateAttribute(workspace, patch);
    if (type === 'relationship' && reverse && state.relationship.otherTitle.trim() !== reverse.title) {
      await updateAttribute(workspace, {
        entityDefinitionId: reverse.entityDefinitionId,
        attributeDefinitionId: reverse.id,
        title: state.relationship.otherTitle.trim(),
      });
    }
  }

  const typeField = (
    <TypePicker
      label={editing ? 'Type' : 'Attribute Type'}
      value={type}
      isDisabled={editing}
      target={object.entityType === 'collection-entry' ? 'list' : 'object'}
      onChange={(next) => {
        setErrors({});
        setState((st) => withPickerType(st, next));
      }}
      onAiShortcut={(aiType, base) => {
        setErrors({});
        setState((st) => ({
          ...withPickerType(st, base),
          aiAutofill: { ...initialAiState(base), enabled: true, type: aiType },
        }));
      }}
    />
  );

  const nameField = (
    <TextInput
      ref={nameRef}
      label="Name"
      size={34}
      autoFocus={!editing}
      value={state.title}
      onChange={(title) => {
        set({ title });
        if (errors.title) setErrors((e) => ({ ...e, title: undefined }));
      }}
      isInvalid={Boolean(errors.title)}
    />
  );

  const descriptionField = (
    <TextArea
      label="Description (optional)"
      placeholder="Add a description for this attribute"
      rows={2}
      textAreaClassName={s.description}
      value={state.description}
      onChange={(description) => set({ description })}
    />
  );

  const defaultField = (
    <DefaultValueField
      type={type}
      value={state.defaultValue}
      onChange={(defaultValue) => set({ defaultValue })}
      context={{
        options: state.options,
        stages: state.stages,
        members: members.data ?? [],
        currentUserId: me?.user.id ?? null,
        allowedObjectIds: state.allowedObjectIds,
      }}
    />
  );

  const constraintsField =
    !aiActive(state) && (allowed.required || allowed.unique || allowed.multiple) ? (
      <div className={s.field}>
        <span className={s.fieldLabel}>Constraints</span>
        <div className={s.constraints}>
          {allowed.required && (
            <ConstraintRow
              label="Required"
              help="Required attributes are mandatory to fill out when adding a record of this object"
              isSelected={state.isRequired}
              onChange={(isRequired) => set({ isRequired })}
            />
          )}
          {allowed.unique && (
            <ConstraintRow
              label="Unique"
              help="When unique is enabled the content of this attribute can appear only once"
              isSelected={state.isUnique}
              onChange={(isUnique) => set({ isUnique })}
            />
          )}
          {allowed.multiple && (
            <ConstraintRow
              label="Multiple values"
              help="Multiple values can be added for this attribute"
              isSelected={state.isMultiselect}
              isDisabled={editing}
              onChange={(isMultiselect) => set({ isMultiselect })}
            />
          )}
        </div>
      </div>
    ) : null;

  const optionsField =
    type === 'select' || type === 'multi-select' ? (
      <ChoiceListField
        mode="option"
        label="Options"
        items={state.options}
        onChange={(options) => set({ options })}
        errors={errors.options}
        limit={optionLimit}
      />
    ) : type === 'status' ? (
      <ChoiceListField
        mode="stage"
        label="Statuses"
        items={state.stages}
        onChange={(stages) => set({ stages })}
        errors={errors.stages}
        limit={optionLimit}
      />
    ) : null;

  const allowedObjectsField =
    type === 'record' && !editing ? (
      <AllowedObjectsField
        objects={recordTargets}
        value={state.allowedObjectIds}
        onChange={(allowedObjectIds) => set({ allowedObjectIds, defaultValue: null })}
      />
    ) : null;

  // Formula attributes show the display settings of their output type.
  const numericType = type === 'formula' ? (state.formula?.outputType ?? null) : type;
  const configField =
    numericType === 'number' ? (
      <NumberConfig state={state} set={set} error={errors.decimalPlaces} />
    ) : numericType === 'currency' ? (
      <CurrencyConfig state={state} set={set} />
    ) : null;

  const aiField =
    hasAiAutofillCard(type) && isAiCapable(type) ? (
      <AiAutofillCard
        workspace={workspace}
        entityDefinitionId={object.id}
        attributeId={attribute?.id ?? null}
        type={type as AiCapableType}
        value={state.aiAutofill}
        onChange={(aiAutofill) => {
          set({ aiAutofill });
          if (errors.aiAutofill) setErrors((er) => ({ ...er, aiAutofill: undefined }));
        }}
        showErrors={Boolean(errors.aiAutofill)}
        labelClassName={s.fieldLabel}
        fieldClassName={s.field}
      />
    ) : null;

  if (formulaOpen) {
    return (
      <FormulaSheet
        workspace={workspace}
        object={object}
        attributeId={attribute?.id ?? null}
        initial={state.formula}
        currentType={attribute && original.current.formula ? attribute.type : null}
        onSave={(formula) => {
          set({ formula });
          setFormulaOpen(false);
        }}
        onBack={() => setFormulaOpen(false)}
        onClose={onClose}
      />
    );
  }

  let body: ReactNode;
  if (type === 'relationship') {
    body = (
      <>
        {typeField}
        <RelationshipForm
          object={object}
          objects={recordTargets}
          value={state.relationship}
          onChange={(relationship) => set({ relationship })}
          mode={editing ? 'edit' : 'create'}
          errors={errors}
          cardinalityLocked={editing}
        />
      </>
    );
  } else if (type === 'formula') {
    body = (
      <>
        {typeField}
        {nameField}
        <div className={s.separator} />
        <FormulaField
          workspace={workspace}
          draft={state.formula}
          labelClassName={s.fieldLabel}
          fieldClassName={s.field}
          onOpen={() => setFormulaOpen(true)}
        />
        {descriptionField}
        {configField && (
          <>
            <div className={s.separator} />
            {configField}
          </>
        )}
      </>
    );
  } else if (!editing) {
    body = (
      <>
        {typeField}
        {nameField}
        {descriptionField}
        {optionsField}
        {allowedObjectsField}
        {defaultField}
        {constraintsField}
        {configField && (
          <>
            <div className={s.separator} />
            {configField}
          </>
        )}
        {aiField && (
          <>
            <div className={s.separator} />
            {aiField}
          </>
        )}
      </>
    );
  } else if (type === 'select' || type === 'multi-select') {
    body = (
      <>
        {typeField}
        {nameField}
        {descriptionField}
        {constraintsField}
        {optionsField}
        {defaultField}
        {aiField && (
          <>
            <div className={s.separator} />
            {aiField}
          </>
        )}
      </>
    );
  } else if (type === 'status') {
    body = (
      <>
        {typeField}
        {nameField}
        {descriptionField}
        {defaultField}
        {constraintsField}
        {optionsField}
      </>
    );
  } else {
    body = (
      <>
        {typeField}
        {nameField}
        {descriptionField}
        {defaultField}
        {constraintsField}
        {configField && (
          <>
            <div className={s.separator} />
            {configField}
          </>
        )}
        {aiField && (
          <>
            <div className={s.separator} />
            {aiField}
          </>
        )}
      </>
    );
  }

  return (
    <div onKeyDown={submitOnModEnter(() => void submit())} style={{ display: 'contents' }}>
      <DialogHeader title={editing ? object.pluralNoun : 'Create attribute'} onClose={onClose} />
      <DialogBody className={type === 'relationship' ? `${s.dialogBody} ${s.relationshipBody}` : s.dialogBody}>
        {submitError && (
          <div ref={bannerRef}>
            <Banner variant="error" title={submitError} />
          </div>
        )}
        {body}
      </DialogBody>
      <DialogFooter>
        <DialogActions
          onCancel={onClose}
          onSubmit={() => void submit()}
          submitLabel={editing ? 'Save changes' : 'Create attribute'}
          isPending={pending}
          isDisabled={!canSubmit(state)}
          showCancel={type !== 'relationship' || !editing}
        />
      </DialogFooter>
    </div>
  );
}

function ConstraintRow({
  label,
  help,
  isSelected,
  isDisabled,
  onChange,
}: {
  label: string;
  help: string;
  isSelected: boolean;
  isDisabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={s.constraintRow}>
      <Checkbox isSelected={isSelected} isDisabled={isDisabled} onChange={onChange}>
        {label}
      </Checkbox>
      <InfoTip content={help} label={`About ${label}`} />
    </div>
  );
}

/** "Available object types": multi-pick of active objects ("No objects selected"). */
function AllowedObjectsField({
  objects,
  value,
  onChange,
}: {
  objects: readonly EntityDefinition[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const chosen = objects.filter((o) => value.includes(o.id));
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>Available object types</span>
      <Popover
        aria-label="Select objects"
        width="trigger"
        padding={0}
        trigger={
          <AriaButton className={s.fieldButton} aria-label="Available object types">
            <span className={s.fieldButtonValue}>
              {chosen.length === 0 ? (
                <span className={s.placeholderText}>No objects selected</span>
              ) : (
                chosen.map((o) => (
                  <span key={o.id} className={s.stageChip}>
                    <ObjectTile object={o} />
                    {o.pluralNoun}
                  </span>
                ))
              )}
            </span>
            <Icon icon="chevronDown" size={16} className={s.chevron} />
          </AriaButton>
        }
      >
        <div className={s.checkList}>
          <div className={s.checkListLabel}>Select objects</div>
          {objects.map((o) => (
            <div key={o.id} className={s.checkListRow}>
              <Checkbox
                isSelected={value.includes(o.id)}
                onChange={(on) => onChange(on ? [...value, o.id] : value.filter((id) => id !== o.id))}
              >
                <span className={s.checkListItem}>
                  <ObjectTile object={o} />
                  {o.pluralNoun}
                </span>
              </Checkbox>
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/** Attribute type picker: field-sized trigger (icon + label) and a searchable menu of the 16 types. */
function TypePicker({
  label,
  value,
  isDisabled,
  target,
  onChange,
  onAiShortcut,
}: {
  label: string;
  value: PickerType;
  isDisabled: boolean;
  target: 'object' | 'list';
  onChange: (type: PickerType) => void;
  /** "AI Autofill" group (ai-attributes): sets the base type and switches autofill on. */
  onAiShortcut?: (type: (typeof PICKER_SHORTCUTS)[number]['type'], base: 'text' | 'multi-select') => void;
}) {
  const entry = pickerEntry(value);
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <MenuTrigger>
        <AriaButton
          className={`${s.fieldButton} ${s.fieldButtonDisabledType}`}
          aria-label={label}
          isDisabled={isDisabled}
        >
          <Icon icon={entry.icon} size={16} className={s.chevron} />
          <span className={s.fieldButtonValue}>{entry.label}</span>
          <Icon icon="chevronDown" size={16} className={s.chevron} />
        </AriaButton>
        <FilterableMenu
          aria-label="Attribute types"
          placeholder="Search attribute types..."
          width="trigger"
          selectionMode="single"
          selectedKeys={[value]}
          onAction={(k) => {
            const key = String(k);
            const shortcut = PICKER_SHORTCUTS.find((x) => `ai:${x.type}` === key);
            if (shortcut) onAiShortcut?.(shortcut.type, shortcut.base);
            else onChange(k as PickerType);
          }}
          disabledKeys={PICKER_SHORTCUTS.filter((x) => !AUTOFILL_TYPES[x.type].available).map((x) => `ai:${x.type}`)}
          className={s.pickerList}
        >
          {onAiShortcut ? (
            <MenuSection title="AI Autofill">
              {PICKER_SHORTCUTS.map((x) => (
                <MenuItem
                  key={x.type}
                  id={`ai:${x.type}`}
                  icon={AUTOFILL_TYPES[x.type].icon}
                  textValue={AUTOFILL_TYPES[x.type].label}
                >
                  {AUTOFILL_TYPES[x.type].label}
                </MenuItem>
              ))}
            </MenuSection>
          ) : null}
          <MenuSection title="Type">
            {pickerEntriesFor(target).map((e) => (
              <MenuItem key={e.id} id={e.id} icon={e.icon} textValue={e.label}>
                {e.label}
              </MenuItem>
            ))}
          </MenuSection>
        </FilterableMenu>
      </MenuTrigger>
    </div>
  );
}

export function attributePickerLabel(attr: AttributeDefinition): string {
  const t = pickerTypeOf(attr);
  return t ? pickerEntry(t).label : attr.type;
}
