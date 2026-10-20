// Schema inputs (block-catalog §7): Object / List / Object or List selects ("Select a object", "Select a list"),
// attribute selects of the chosen object, and "Attributes to set" — a checklist of writable attributes, then one input
// per chosen attribute "<Attribute> (optional)" with {x}: text-like values as rich text with variables, select and
// status options, checkbox, record and member values.
import type { AttributeDefinition, ConfigExpr, VariableExpr } from '@agentic-crm/contracts';
import { Checkbox, Icon, IconTile, PopoverPanel, Select, SelectItem } from '@agentic-crm/ui';
import { useRef, useState } from 'react';
import { Button as AriaButton, Dialog, DialogTrigger } from 'react-aria-components';
import { useObjects } from '../../../../../data/objects';
import { useAttributes, useMembers, useSelectOptions, useStages } from '../../../../attributes/data/queries';
import { MemberPicker, RecordPicker } from '../../../../attributes/editors/pickers';
import { memberName } from '../../../../attributes/format/formatValue';
import { MemberAvatar } from '../../../../attributes/ui/primitives';
import { useLists } from '../../../../lists/data';
import { ListIcon } from '../../../../lists/icon';
import { objectAppearance } from '../../../../shell/objectAppearance';
import { TYPE_UI } from '../../../../views/operators';
import { useWs } from '../../../data';
import { definitionRef, issueAt, richTextSegments, segmentsEmpty, segmentsToRichText } from '../../../model/config';
import type { InputProps } from '../Field';
import * as s from '../panel.css';
import { VarButton, VariableChip } from '../VariableChip';
import { VariableText, type VariableTextHandle } from '../VariableText';
import { useVariablePopover } from './values';

const PLACEHOLDER: Record<string, string> = {
  object: 'Select a object',
  list: 'Select a list',
  'object-or-list': 'Select a object or list',
};

export function DefinitionInput({ spec, value, readOnly, invalid, onChange }: InputProps) {
  const ws = useWs();
  const objects = useObjects(ws).data ?? [];
  const lists = useLists(ws).data ?? [];
  const withObjects = spec.control !== 'list';
  const withLists = spec.control !== 'object';
  const items = [
    ...(withObjects ? objects.map((o) => ({ id: o.id, label: o.pluralNoun, kind: 'object' as const, object: o })) : []),
    ...(withLists ? lists.map((l) => ({ id: l.id, label: l.name, kind: 'list' as const, icon: l.icon })) : []),
  ];
  const current = definitionRef(value);
  return (
    <Select
      aria-label={spec.label}
      size={36}
      searchable={items.length > 8}
      placeholder={PLACEHOLDER[spec.control] ?? 'Select...'}
      isDisabled={readOnly}
      isInvalid={invalid}
      selectedKey={current && items.some((i) => i.id === current) ? current : null}
      onSelectionChange={(k) => {
        const item = items.find((i) => i.id === k);
        if (!item) return;
        onChange(
          item.kind === 'list'
            ? { type: 'agentic-crm-list', listId: item.id }
            : { type: 'agentic-crm-object', entityDefinitionId: item.id },
        );
      }}
      items={items}
      data-testid={`definition-select-${spec.key}`}
    >
      {(item) => (
        <SelectItem
          id={item.id}
          textValue={item.label}
          icon={
            item.kind === 'object' ? (
              <IconTile
                icon={objectAppearance(item.object).icon}
                color={objectAppearance(item.object).color}
                size={16}
              />
            ) : (
              <ListIcon icon={item.icon} size={16} />
            )
          }
        >
          {item.label}
        </SelectItem>
      )}
    </Select>
  );
}

export function AttributeInput({ block, spec, value, readOnly, invalid, onChange }: InputProps) {
  const defId = spec.of ? definitionRef(block.config.entries[spec.of]) : null;
  const { attributes } = useAttributes(defId);
  const options = attributes.filter((a) => !a.isArchived && (spec.control !== 'unique-attribute' || a.isUnique));
  const current =
    value?.type === 'agentic-crm-attribute'
      ? value.attributeDefinitionId
      : value?.type === 'string'
        ? value.value
        : null;
  if (!defId) {
    return (
      <div className={s.control} data-disabled>
        <span className={`${s.controlValue} ${s.placeholder}`}>Select an object first</span>
      </div>
    );
  }
  return (
    <Select
      aria-label={spec.label}
      size={36}
      searchable={options.length > 8}
      placeholder="Select an attribute"
      isDisabled={readOnly}
      isInvalid={invalid}
      selectedKey={current}
      onSelectionChange={(k) =>
        onChange({ type: 'agentic-crm-attribute', entityDefinitionId: defId, attributeDefinitionId: String(k) })
      }
      items={options}
    >
      {(a) => (
        <SelectItem id={a.id} textValue={a.title} icon={TYPE_UI[a.type].icon}>
          {a.title}
        </SelectItem>
      )}
    </Select>
  );
}

const NOT_WRITABLE = new Set([
  'id',
  'created-at',
  'created-by',
  'list-entries',
  'entry-parent-record',
  'next-due-task',
]);

export function isWritable(a: AttributeDefinition): boolean {
  return !a.isArchived && !a.isReadOnly && !NOT_WRITABLE.has(a.systemAttributeType ?? '');
}

export function ConfiguredAttributes({ block, spec, value, readOnly, invalid, onChange }: InputProps) {
  const defId = spec.of ? definitionRef(block.config.entries[spec.of]) : null;
  const { attributes } = useAttributes(defId);
  const writable = attributes.filter(isWritable);
  const entries = value?.type === 'object' ? value.entries : {};
  const chosen = Object.keys(entries);
  const set = (next: Record<string, ConfigExpr>) =>
    onChange(Object.keys(next).length ? { type: 'object', entries: next } : undefined);
  const [open, setOpen] = useState(false);
  if (!defId) {
    return (
      <div className={s.control} data-disabled>
        <span className={`${s.controlValue} ${s.placeholder}`}>Select attributes...</span>
      </div>
    );
  }
  const byId = new Map(attributes.map((a) => [a.id, a]));
  return (
    <>
      <DialogTrigger isOpen={open} onOpenChange={setOpen}>
        <AriaButton
          className={s.control}
          isDisabled={readOnly}
          data-invalid={invalid || undefined}
          data-testid="attributes-to-set"
        >
          <span className={s.controlValue} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {chosen.length === 0 ? (
              <span className={s.placeholder}>Select attributes...</span>
            ) : (
              chosen.map((id) => {
                const a = byId.get(id);
                return (
                  <span
                    key={id}
                    className={s.row}
                    style={{
                      gap: 4,
                      padding: '1px 6px',
                      borderRadius: 6,
                      background: 'var(--ar-color-surface-tertiary)',
                    }}
                  >
                    {a && <Icon icon={TYPE_UI[a.type].icon} size={14} />}
                    {a?.title ?? 'Deleted attribute'}
                  </span>
                );
              })
            )}
          </span>
          <Icon icon="chevronDown" size={16} className={s.chevron} />
        </AriaButton>
        <PopoverPanel placement="bottom start" width="trigger" maxHeight={360}>
          <Dialog
            aria-label="Attributes to set"
            style={{ outline: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            {writable.map((a) => {
              const on = a.id in entries;
              return (
                <Checkbox
                  key={a.id}
                  isSelected={on}
                  onChange={(checked) => {
                    const next = { ...entries };
                    if (checked) next[a.id] = { type: 'null' };
                    else delete next[a.id];
                    set(next);
                  }}
                  style={{ padding: '6px 8px' }}
                >
                  <span className={s.row} style={{ gap: 6 }}>
                    <Icon icon={TYPE_UI[a.type].icon} size={14} />
                    {a.title}
                  </span>
                </Checkbox>
              );
            })}
          </Dialog>
        </PopoverPanel>
      </DialogTrigger>
      {chosen.map((id) => {
        const a = byId.get(id);
        if (!a) return null;
        return (
          <AttributeValueField
            key={id}
            block={block}
            attribute={a}
            value={entries[id]}
            readOnly={readOnly}
            issue={issueAt(block.issues, [spec.key, id])}
            onChange={(v) => set({ ...entries, [id]: v ?? { type: 'null' } })}
          />
        );
      })}
    </>
  );
}

/** The value expression inside a configured attribute entry (bare or `{value, overwrite_multi_value}`). */
function innerValue(entry: ConfigExpr | undefined): ConfigExpr | undefined {
  if (entry?.type === 'object' && 'value' in entry.entries) return entry.entries.value;
  return entry;
}

function AttributeValueField({
  block,
  attribute: a,
  value: entry,
  readOnly,
  issue,
  onChange,
}: {
  block: InputProps['block'];
  attribute: AttributeDefinition;
  value: ConfigExpr | undefined;
  readOnly: boolean;
  issue: string | null;
  onChange: (v: ConfigExpr | undefined) => void;
}) {
  const value = innerValue(entry);
  const textRef = useRef<VariableTextHandle>(null);
  const varButton = useRef<HTMLButtonElement>(null);
  const pop = useVariablePopover(block.id, undefined, (v) =>
    onChange(a.isMultiselect ? { type: 'array', items: [v] } : v),
  );
  const textLike = !['select', 'pipeline', 'checkbox', 'entity-reference', 'actor-reference'].includes(a.type);
  const openVariable = () => {
    if (!varButton.current) return;
    if (textLike) textRef.current?.openPicker(varButton.current);
    else pop.open(varButton.current);
  };
  return (
    <div className={s.field} data-testid="attribute-value-field" data-attribute={a.title}>
      <div className={s.labelRow}>
        <span className={s.label}>{`${a.title} (optional)`}</span>
        {!readOnly && <VarButton buttonRef={varButton} onPress={openVariable} />}
      </div>
      {textLike ? (
        <VariableText
          ref={textRef}
          blockId={block.id}
          value={richTextSegments(value)}
          invalid={issue !== null}
          readOnly={readOnly}
          onCommit={(segs) => onChange(segmentsEmpty(segs) ? undefined : segmentsToRichText(segs))}
        />
      ) : value?.type === 'variable' || (value?.type === 'array' && value.items[0]?.type === 'variable') ? (
        <div className={s.control} style={{ cursor: 'default' }}>
          <VariableChip
            blockId={block.id}
            variable={
              (value.type === 'variable' ? value : (value as { items: VariableExpr[] }).items[0]) as VariableExpr
            }
            readOnly={readOnly}
            onChange={(v) => onChange(a.isMultiselect ? { type: 'array', items: [v] } : v)}
            onRemove={() => onChange(undefined)}
          />
        </div>
      ) : (
        <StaticAttributeValue
          attribute={a}
          value={value}
          readOnly={readOnly}
          invalid={issue !== null}
          onChange={onChange}
        />
      )}
      {issue && <span className={s.fieldError}>{issue}</span>}
      {pop.element}
    </div>
  );
}

function StaticAttributeValue({
  attribute: a,
  value,
  readOnly,
  invalid,
  onChange,
}: {
  attribute: AttributeDefinition;
  value: ConfigExpr | undefined;
  readOnly: boolean;
  invalid: boolean;
  onChange: (v: ConfigExpr | undefined) => void;
}) {
  const raw = value?.type === 'value' ? (value.value as Record<string, unknown> | boolean | null) : null;
  if (a.type === 'checkbox') {
    return (
      <Select
        aria-label={a.title}
        size={36}
        isDisabled={readOnly}
        placeholder="Select a value..."
        selectedKey={typeof raw === 'boolean' ? String(raw) : null}
        onSelectionChange={(k) => onChange({ type: 'value', value: k === 'true' })}
      >
        <SelectItem id="true">True</SelectItem>
        <SelectItem id="false">False</SelectItem>
      </Select>
    );
  }
  if (a.type === 'select' || a.type === 'pipeline')
    return <OptionValue attribute={a} value={raw} readOnly={readOnly} invalid={invalid} onChange={onChange} />;
  if (a.type === 'actor-reference') return <MemberValue value={raw} readOnly={readOnly} onChange={onChange} />;
  return <RecordValue attribute={a} value={raw} readOnly={readOnly} onChange={onChange} />;
}

function OptionValue({
  attribute: a,
  value,
  readOnly,
  invalid,
  onChange,
}: {
  attribute: AttributeDefinition;
  value: unknown;
  readOnly: boolean;
  invalid: boolean;
  onChange: (v: ConfigExpr | undefined) => void;
}) {
  const options = useSelectOptions(a);
  const stages = useStages(a);
  const items =
    a.type === 'pipeline'
      ? stages.map((x) => ({ id: x.id, title: x.title }))
      : options.map((x) => ({ id: x.id, title: x.title }));
  const key = a.type === 'pipeline' ? 'pipelineStageId' : 'selectOptionId';
  const current =
    value && typeof value === 'object' ? ((value as Record<string, unknown>)[key] as string | undefined) : undefined;
  return (
    <Select
      aria-label={a.title}
      size={36}
      isDisabled={readOnly}
      isInvalid={invalid}
      placeholder="Select an option..."
      selectedKey={current ?? null}
      onSelectionChange={(k) => onChange({ type: 'value', value: { [key]: String(k) } })}
      items={items}
    >
      {(o) => (
        <SelectItem id={o.id} textValue={o.title}>
          {o.title}
        </SelectItem>
      )}
    </Select>
  );
}

function MemberValue({
  value,
  readOnly,
  onChange,
}: {
  value: unknown;
  readOnly: boolean;
  onChange: (v: ConfigExpr | undefined) => void;
}) {
  const members = useMembers();
  const [open, setOpen] = useState(false);
  const id =
    value && typeof value === 'object' ? ((value as { referencedActorId?: string }).referencedActorId ?? null) : null;
  const member = members.find((m) => m.id === id);
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <AriaButton className={s.control} isDisabled={readOnly}>
        {member ? (
          <>
            <MemberAvatar member={member} size={16} />
            <span className={s.controlValue}>{memberName(member)}</span>
          </>
        ) : (
          <span className={`${s.controlValue} ${s.placeholder}`}>Select a member</span>
        )}
        <Icon icon="chevronDown" size={16} className={s.chevron} />
      </AriaButton>
      <PopoverPanel placement="bottom start" width={320} padding={0}>
        <Dialog aria-label="Select a member" style={{ outline: 'none' }}>
          <MemberPicker
            selectedIds={id ? [id] : []}
            onSelect={(m) => {
              setOpen(false);
              onChange({ type: 'value', value: { referencedActorType: 'workspace-member', referencedActorId: m.id } });
            }}
          />
        </Dialog>
      </PopoverPanel>
    </DialogTrigger>
  );
}

function RecordValue({
  attribute: a,
  value,
  readOnly,
  onChange,
}: {
  attribute: AttributeDefinition;
  value: unknown;
  readOnly: boolean;
  onChange: (v: ConfigExpr | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref =
    value && typeof value === 'object' ? (value as { entityDefinitionId?: string; entityInstanceId?: string }) : null;
  const allowed = a.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null;
  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <AriaButton className={s.control} isDisabled={readOnly}>
        <span className={`${s.controlValue} ${ref?.entityInstanceId ? '' : s.placeholder}`}>
          {ref?.entityInstanceId ? 'Record selected' : 'Select a record'}
        </span>
        <Icon icon="chevronDown" size={16} className={s.chevron} />
      </AriaButton>
      <PopoverPanel placement="bottom start" width={360} padding={0}>
        <Dialog aria-label="Select a record" style={{ outline: 'none' }}>
          <RecordPicker
            entityDefinitionIds={allowed && allowed.length ? allowed : null}
            selected={
              ref?.entityInstanceId
                ? [{ entityDefinitionId: ref.entityDefinitionId ?? '', entityInstanceId: ref.entityInstanceId }]
                : []
            }
            onSelect={(r) => {
              setOpen(false);
              onChange({
                type: 'value',
                value: { entityDefinitionId: r.entityDefinitionId, entityInstanceId: r.entityInstanceId },
              });
            }}
          />
        </Dialog>
      </PopoverPanel>
    </DialogTrigger>
  );
}
