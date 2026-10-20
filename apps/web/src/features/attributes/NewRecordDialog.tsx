// "Create {Object}" dialog (BACKLOG 2.12, C1 README §3.7; evidence/C1/40, ds-modal-create-record): one field per
// writable attribute in attribute order, "(optional)" unless required, per-type controls (text inputs, pickers in
// popovers, inline checkbox and stars), defaults prefilled; footer "Create more" + "Create record ⌘↵". The record is
// created with a client-minted id (I3) in one `records.put`.
import type { ValuesMap } from '@agentic-crm/contracts';
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconTile,
  Modal,
  Switch,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextInput,
  toast,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { keys } from '../../data/keys';
import { queryClient } from '../../data/queryClient';
import { api, errorEnvelopeOf, httpStatusOf, inWorkspace } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { objectAppearance } from '../shell/objectAppearance';
import { useAttributeEnv } from './data/env';
import { useAttributes, useMembers, useObjectDefinition, useSelectOptions, useStages } from './data/queries';
import * as d from './dialogs.css';
import { todayIso } from './format/formatValue';
import { getFormatSettings } from './format/locale';
import { getAttributeUi } from './registry';
import type { AttributeDefinition, AttributeType, AttributeValue, CommitInput, CommitMeta, ValueInput } from './types';
import { CheckboxMark, recordPath, Stars } from './ui/primitives';
import { pasteValueOf } from './values/clipboard';
import { currentValues, read, toWriteForm } from './values/shapes';
import { setPlaceholder } from './views/frame';
import { planCommit } from './write/plan';

export interface NewRecordDialogProps {
  entityDefinitionId: string;
  onClose: () => void;
  /** After a create (with "Create more" on, after each one). */
  onCreated?: (record: { entityDefinitionId: string; entityInstanceId: string }) => void;
  /** Prefills the display-name attribute (a picker's "+ Create Person" passes the typed query). */
  initialTitle?: string;
  /** Prefilled values by attribute id or api slug (write forms). */
  initialValues?: Record<string, ValueInput[]>;
  /** Shows the "Create more" switch (default true). */
  allowCreateMore?: boolean;
  /** With "Create more" off, open the new record afterwards (default true). */
  navigateOnCreate?: boolean;
}

/** Text-entry types: typed text is parsed like a single-cell paste on submit. */
export const TEXT_TYPES = new Set<AttributeType>([
  'text',
  'number',
  'currency',
  'domain',
  'email-address',
  'phone-number',
]);

/** Attributes the dialog offers: writable, not archived/hidden, not computed (C1 README §3.7). */
export function creatableAttributes(attributes: AttributeDefinition[]): AttributeDefinition[] {
  return attributes.filter(
    (a) => !a.isArchived && !a.isHidden && !a.isReadOnly && a.type !== 'interaction' && a.systemAttributeType !== 'id',
  );
}

/** Default value rows of an attribute (A §4.6: static JSON arrays; dynamic PT… durations and current-user). */
export function defaultInputs(attribute: AttributeDefinition, memberId: string | null, now = new Date()): ValueInput[] {
  const def = attribute.defaultValue;
  if (!def) return [];
  if (def.type === 'dynamic') {
    if (attribute.type === 'actor-reference' && def.identifier === 'current-user' && memberId)
      return [{ value: { referencedActorType: 'workspace-member', referencedActorId: memberId } }];
    if (attribute.type === 'date') return [{ value: todayIso(now) }];
    if (attribute.type === 'timestamp') return [{ value: now.toISOString() }];
    return [];
  }
  try {
    const parsed = JSON.parse(def.identifier) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((v) => ({
      value: v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v,
    }));
  } catch {
    return [];
  }
}

export function errorFor(attribute: AttributeDefinition): string {
  switch (attribute.type) {
    case 'email-address':
      return 'You have entered an invalid email address';
    case 'domain':
      return 'You have entered an invalid domain';
    case 'phone-number':
      return 'Invalid phone number';
    default:
      return `Enter a valid ${attribute.title.toLowerCase()}`;
  }
}

interface FormState {
  recordId: string;
  rows: Record<string, AttributeValue[]>;
  texts: Record<string, string>;
}

export function NewRecordDialog({
  entityDefinitionId,
  onClose,
  onCreated,
  initialTitle,
  initialValues,
  allowCreateMore = true,
  navigateOnCreate = true,
}: NewRecordDialogProps) {
  const env = useAttributeEnv();
  const definition = useObjectDefinition(entityDefinitionId);
  const { attributes, isLoading } = useAttributes(entityDefinitionId);
  const fields = useMemo(() => creatableAttributes(attributes), [attributes]);
  const navigate = useNavigate();
  const [createMore, setCreateMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ attributeId: string; anchor: HTMLElement } | null>(null);

  const titleAttrId =
    definition?.epithetPath?.length === 1 ? definition.epithetPath[0]?.attributeDefinitionId : undefined;

  const initialState = (): FormState => {
    const recordId = newId();
    const rows: Record<string, AttributeValue[]> = {};
    const texts: Record<string, string> = {};
    for (const a of fields) {
      const given = initialValues?.[a.id] ?? initialValues?.[a.apiSlug];
      const inputs =
        given ?? (a.id === titleAttrId && initialTitle ? titleInputs(a, initialTitle) : defaultInputs(a, env.memberId));
      if (inputs.length === 0) continue;
      const plan = planCommit(a, [], inputs, {
        recordRef: { workspace: env.workspace, entityDefinitionId, entityInstanceId: recordId },
        newId,
      });
      rows[a.id] = plan.optimistic;
      if (TEXT_TYPES.has(a.type)) texts[a.id] = inputs.map((i) => textOfInput(a, i.value)).join(', ');
    }
    return { recordId, rows, texts };
  };

  const [form, setForm] = useState<FormState>(initialState);
  const initialised = useRef(false);
  useEffect(() => {
    // Attributes arrive after the first render: build the prefilled state once they are known.
    if (!initialised.current && fields.length > 0 && definition) {
      initialised.current = true;
      setForm(initialState());
    }
  }, [fields.length, definition]);

  const commitTo = (attribute: AttributeDefinition) => (next: CommitInput, meta?: CommitMeta) => {
    setForm((f) => {
      const plan = planCommit(attribute, f.rows[attribute.id] ?? [], next, {
        recordRef: { workspace: env.workspace, entityDefinitionId, entityInstanceId: f.recordId },
        newId,
      });
      return { ...f, rows: { ...f.rows, [attribute.id]: plan.optimistic } };
    });
    setErrors((e) => ({ ...e, [attribute.id]: '' }));
    if (!meta?.keepOpen) setEditing(null);
  };

  const submit = async () => {
    if (busy || !definition) return;
    const settings = getFormatSettings();
    const ctx = { settings, today: todayIso(new Date(), settings) };
    const values: ValuesMap = {};
    const nextErrors: Record<string, string> = {};
    for (const a of fields) {
      let inputs: ValueInput[];
      if (TEXT_TYPES.has(a.type)) {
        const parsed = pasteValueOf(a, form.texts[a.id] ?? '', ctx);
        if (parsed === null) {
          nextErrors[a.id] = errorFor(a);
          continue;
        }
        inputs = parsed.map((p) => ({ ...p, id: newId() }));
      } else {
        inputs = currentValues(form.rows[a.id] ?? []).map((r) => ({
          id: r.id,
          value: toWriteForm(a.type, r.value),
          ...(r.sortOrder ? { sortOrder: r.sortOrder } : {}),
        }));
      }
      if (inputs.length === 0) {
        if (a.isRequired) nextErrors[a.id] = `${a.title} is required`;
        continue;
      }
      values[a.id] = inputs;
    }
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;
    setBusy(true);
    try {
      const result = await api.records.put.mutate(
        { entityDefinitionId, entityInstanceId: form.recordId, values },
        inWorkspace(env.workspace),
      );
      const ws = env.workspace.id;
      queryClient.setQueryData(keys.record(ws, entityDefinitionId, form.recordId), result.record);
      for (const a of fields) {
        queryClient.setQueryData(keys.values(ws, entityDefinitionId, a.id, form.recordId), {
          values: result.values[a.id] ?? [],
          accurateAt: result.record.accurateAt,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['ws', ws, 'snapshot', entityDefinitionId] });
      const ref = { entityDefinitionId, entityInstanceId: form.recordId };
      onCreated?.(ref);
      if (createMore && allowCreateMore) {
        toast.success({ title: 'Record created' });
        initialised.current = true;
        setForm(initialState());
        setErrors({});
      } else {
        onClose();
        const href = navigateOnCreate ? recordPath(env.workspace.slug, definition, form.recordId) : null;
        if (href) void navigate({ href });
      }
    } catch (error) {
      const { code, message } = errorEnvelopeOf(error);
      toast.error({
        title:
          httpStatusOf(error) === 409 && /UNIQUE/i.test(code ?? '')
            ? 'This value is already in use by another record'
            : 'Failed to create record',
        description: message,
      });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const look = definition ? objectAppearance(definition) : { icon: 'object' as const, color: 'grey' as const };
  const singular = definition?.singularNoun ?? 'record';
  const editingAttr = editing ? fields.find((a) => a.id === editing.attributeId) : undefined;
  const EditingEditor = editingAttr ? getAttributeUi(editingAttr.type).Editor : null;

  return (
    <Modal
      isOpen
      onOpenChange={(open) => !open && !editing && onClose()}
      size="large"
      style={{ height: 522 }}
      aria-label={`Create ${singular}`}
      isKeyboardDismissDisabled={Boolean(editing)}
    >
      <div style={{ display: 'contents' }} onKeyDown={onKeyDown}>
        <DialogHeader
          icon={<IconTile icon={look.icon} color={look.color} size={16} />}
          title={`Create ${singular}`}
          onClose={onClose}
        />
        <Tabs defaultSelectedKey="all" className={d.tabs} style={{ display: 'contents' }}>
          <div className={d.tabs}>
            <TabList aria-label={`Create ${singular}`}>
              <Tab id="all">All</Tab>
              <Tab id="templates" icon="template" divider>
                Create templates
              </Tab>
            </TabList>
          </div>
          <TabPanel id="all" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <DialogBody className={d.body}>
              <h3 className={d.sectionTitle}>All</h3>
              {isLoading && <span className={d.label}>Loading…</span>}
              {fields.map((a) => (
                <FieldControl
                  key={a.id}
                  attribute={a}
                  rows={form.rows[a.id] ?? []}
                  text={form.texts[a.id] ?? ''}
                  error={errors[a.id]}
                  isOpen={editing?.attributeId === a.id}
                  onText={(t) => {
                    setForm((f) => ({ ...f, texts: { ...f.texts, [a.id]: t } }));
                    setErrors((e) => ({ ...e, [a.id]: '' }));
                  }}
                  onCommit={commitTo(a)}
                  onOpen={(anchor) => setEditing({ attributeId: a.id, anchor })}
                />
              ))}
            </DialogBody>
          </TabPanel>
          <TabPanel id="templates" style={{ flex: 1 }}>
            <div className={d.templates}>Record templates are not available yet.</div>
          </TabPanel>
        </Tabs>
        <DialogFooter>
          <div className={d.footerStart}>
            {allowCreateMore && (
              <Switch isSelected={createMore} onChange={setCreateMore}>
                Create more
              </Switch>
            )}
            <Button size={28} shortcut={['mod', 'enter']} isPending={busy} onPress={() => void submit()}>
              Create record
            </Button>
          </div>
        </DialogFooter>
      </div>
      {editingAttr && EditingEditor && editing && (
        <EditingEditor
          attribute={editingAttr}
          values={form.rows[editingAttr.id] ?? []}
          anchor={editing.anchor}
          density="field"
          onCommit={commitTo(editingAttr)}
          onCancel={() => setEditing(null)}
        />
      )}
    </Modal>
  );
}

function titleInputs(attribute: AttributeDefinition, title: string): ValueInput[] {
  if (!title.trim()) return [];
  if (attribute.type === 'personal-name') {
    const [first = '', ...rest] = title.trim().split(/\s+/);
    return [{ value: { firstName: first, lastName: rest.join(' '), fullName: title.trim() } }];
  }
  return [{ value: title }];
}

export function textOfInput(attribute: AttributeDefinition, value: unknown): string {
  switch (attribute.type) {
    case 'currency':
      return String(read.currency(value)?.currencyValue ?? '');
    case 'email-address':
      return read.email(value)?.originalEmailAddress ?? (typeof value === 'string' ? value : '');
    case 'domain':
      return read.domain(value)?.normalizedDomain ?? (typeof value === 'string' ? value : '');
    case 'phone-number':
      return read.phone(value)?.originalPhoneNumber ?? '';
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

export interface FieldControlProps {
  attribute: AttributeDefinition;
  rows: AttributeValue[];
  text: string;
  error?: string;
  isOpen: boolean;
  onText: (text: string) => void;
  onCommit: (next: CommitInput, meta?: CommitMeta) => void;
  onOpen: (anchor: HTMLElement) => void;
}

/** One labelled field of a create form (also the list Add-to-list form, features/lists). */
export function FieldControl({ attribute, rows, text, error, isOpen, onText, onCommit, onOpen }: FieldControlProps) {
  // Warm the caches the pickers and views read.
  useSelectOptions(attribute);
  useStages(attribute);
  useMembers(attribute.type === 'actor-reference');
  const label = (
    <span className={d.label}>
      {attribute.title}
      {!attribute.isRequired && <span>(optional)</span>}
    </span>
  );
  const placeholder = setPlaceholder(attribute.title);
  let control: ReactNode;
  if (TEXT_TYPES.has(attribute.type)) {
    control = (
      <TextInput
        size={32}
        aria-label={attribute.title}
        placeholder={placeholder}
        value={text}
        onChange={onText}
        isInvalid={Boolean(error)}
        inputMode={attribute.type === 'number' || attribute.type === 'currency' ? 'decimal' : undefined}
      />
    );
  } else if (attribute.type === 'personal-name') {
    const name = rows[0] ? read.name(rows[0].value) : null;
    const set = (first: string, last: string) =>
      onCommit(
        first.trim() || last.trim()
          ? [
              {
                value: {
                  firstName: first,
                  lastName: last,
                  fullName: [first.trim(), last.trim()].filter(Boolean).join(' '),
                },
              },
            ]
          : [],
        { keepOpen: true },
      );
    control = (
      <div className={d.nameRow}>
        <TextInput
          size={32}
          aria-label="First name"
          placeholder="First name"
          value={name?.firstName ?? ''}
          onChange={(v) => set(v, name?.lastName ?? '')}
          style={{ flex: 1 }}
        />
        <TextInput
          size={32}
          aria-label="Last name"
          placeholder="Last name"
          value={name?.lastName ?? ''}
          onChange={(v) => set(name?.firstName ?? '', v)}
          style={{ flex: 1 }}
        />
      </div>
    );
  } else if (attribute.type === 'checkbox') {
    const checked = rows[0] ? read.checkbox(rows[0].value) === true : false;
    control = (
      <button
        type="button"
        className={`${d.box} ${d.boxStatic}`}
        role="checkbox"
        aria-checked={checked}
        aria-label={attribute.title}
        onClick={() => onCommit([{ value: !checked }], { keepOpen: true })}
      >
        <CheckboxMark checked={checked} />
      </button>
    );
  } else if (attribute.type === 'rating') {
    const value = rows[0] ? (read.rating(rows[0].value) ?? 0) : 0;
    control = (
      <div className={`${d.box} ${d.boxStatic}`}>
        <Stars
          value={value}
          label={attribute.title}
          onChange={(n) => onCommit(n ? [{ value: n }] : [], { keepOpen: true })}
        />
      </div>
    );
  } else {
    const ui = getAttributeUi(attribute.type);
    control = (
      <button
        type="button"
        className={d.box}
        data-open={isOpen || undefined}
        data-invalid={error ? true : undefined}
        aria-label={attribute.title}
        aria-haspopup="dialog"
        onClick={(e) => onOpen(e.currentTarget)}
      >
        <ui.View attribute={attribute} values={rows} density="field" placeholder={placeholder} />
      </button>
    );
  }
  return (
    <div className={d.fieldBlock}>
      {label}
      {control}
      {error && <span className={d.error}>{error}</span>}
    </div>
  );
}
