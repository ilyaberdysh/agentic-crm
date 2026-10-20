// "Default value (optional)" per type (J attribute-dialogs §3 table; raw J s24-dd-*_default, s26-filled-*). One
// adapter for every type; it stores the internal encoding (A §4.6): dynamic ISO durations / `current-user`, or a
// static JSON array of write-form values. Record defaults use the attributes feature's record picker (C1, B.8).
import type { DefaultValue, WorkspaceMember } from '@agentic-crm/contracts';
import {
  Checkbox,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Select,
  SelectItem,
  Tag,
  TextInput,
  toHue,
} from '@agentic-crm/ui';
import { type ReactNode, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { RecordChip, RecordPicker } from '../../../attributes';
import * as s from './attributes.css';
import { decodeStatic, encodeStatic, type OptionDraft, RELATIVE_DATE_PRESETS } from './formModel';
import type { PickerType } from './typeCatalog';

export interface DefaultValueContext {
  options: readonly OptionDraft[];
  stages: readonly OptionDraft[];
  members: readonly WorkspaceMember[];
  currentUserId: string | null;
  allowedObjectIds: readonly string[];
}

export function DefaultValueField({
  type,
  value,
  onChange,
  context,
}: {
  type: PickerType;
  value: DefaultValue | null;
  onChange: (next: DefaultValue | null) => void;
  context: DefaultValueContext;
}) {
  if (type === 'relationship' || type === 'formula') return null;
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>Default value (optional)</span>
      <DefaultControl type={type} value={value} onChange={onChange} context={context} />
    </div>
  );
}

function first(value: DefaultValue | null): unknown {
  return decodeStatic(value)[0];
}

function DefaultControl({
  type,
  value,
  onChange,
  context,
}: {
  type: PickerType;
  value: DefaultValue | null;
  onChange: (next: DefaultValue | null) => void;
  context: DefaultValueContext;
}) {
  switch (type) {
    case 'text':
      return (
        <TextInput
          aria-label="Default value"
          size={32}
          value={typeof first(value) === 'string' ? (first(value) as string) : ''}
          onChange={(v) => onChange(v ? encodeStatic([v]) : null)}
        />
      );
    case 'number':
    case 'currency': {
      const v = first(value);
      const n =
        type === 'currency' ? (v as { currencyValue?: number } | undefined)?.currencyValue : (v as number | undefined);
      return (
        <TextInput
          aria-label="Default value"
          size={32}
          inputMode="decimal"
          placeholder={type === 'currency' ? 'Set a default value...' : 'Set a default'}
          value={typeof n === 'number' ? String(n) : ''}
          onChange={(raw) => {
            const num = Number(raw.replace(',', '.'));
            if (!raw.trim() || !Number.isFinite(num)) return onChange(null);
            onChange(encodeStatic([type === 'currency' ? { currencyValue: num, currencyCode: null } : num]));
          }}
        />
      );
    }
    case 'checkbox':
      return (
        <div className={s.checkboxBox}>
          <Checkbox
            aria-label="Checked by default"
            isSelected={first(value) === true}
            onChange={(on) => onChange(on ? encodeStatic([true]) : null)}
          />
        </div>
      );
    case 'rating': {
      const current = typeof first(value) === 'number' ? (first(value) as number) : 0;
      return (
        <div className={s.ratingRow}>
          <div className={s.ratingBox}>
            <div className={s.stars} role="radiogroup" aria-label="Default rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <AriaButton
                  key={n}
                  className={s.star}
                  aria-label={n === 1 ? '1 star' : `${n} stars`}
                  data-filled={n <= current || undefined}
                  onPress={() => onChange(n === current ? null : encodeStatic([n]))}
                >
                  <Icon icon="attrRating" size={16} fill={n <= current ? 'currentColor' : 'currentColor'} />
                </AriaButton>
              ))}
            </div>
          </div>
          <IconButton icon="close" aria-label="Clear" variant="secondary" size={28} onPress={() => onChange(null)} />
        </div>
      );
    }
    case 'date':
    case 'timestamp':
      return <RelativeDateDefault type={type} value={value} onChange={onChange} />;
    case 'select':
    case 'multi-select':
      return (
        <OptionDefault
          multi={type === 'multi-select'}
          options={context.options}
          value={value}
          onChange={onChange}
          placeholder={type === 'multi-select' ? 'Select one or more default options...' : 'Select a default option...'}
          idKey="selectOptionId"
        />
      );
    case 'status':
      return (
        <OptionDefault
          multi={false}
          options={context.stages}
          value={value}
          onChange={onChange}
          placeholder="Set a default stage..."
          idKey="pipelineStageId"
          stage
        />
      );
    case 'user':
      return (
        <UserDefault
          value={value}
          onChange={onChange}
          members={context.members}
          currentUserId={context.currentUserId}
        />
      );
    case 'record':
      if (context.allowedObjectIds.length === 0) {
        return (
          <AriaButton className={s.fieldButton} isDisabled>
            <span className={s.fieldButtonValue}>Select an object type to enable default values</span>
          </AriaButton>
        );
      }
      return <RecordDefault value={value} onChange={onChange} allowedObjectIds={context.allowedObjectIds} />;
    case 'location':
      return <LocationDefault value={value} onChange={onChange} />;
    case 'phone-number':
      return <PhoneDefault value={value} onChange={onChange} />;
    default:
      return null;
  }
}

interface RecordDefaultValue {
  entityDefinitionId?: string;
  entityInstanceId: string;
}

/** Default records: the record picker in a popover; the field lists the chosen records as chips. */
function RecordDefault({
  value,
  onChange,
  allowedObjectIds,
}: {
  value: DefaultValue | null;
  onChange: (next: DefaultValue | null) => void;
  allowedObjectIds: readonly string[];
}) {
  const current = decodeStatic(value).filter(
    (v): v is RecordDefaultValue => typeof (v as RecordDefaultValue | null)?.entityInstanceId === 'string',
  );
  const selected = current.map((v) => ({
    entityDefinitionId: v.entityDefinitionId ?? allowedObjectIds[0] ?? '',
    entityInstanceId: v.entityInstanceId,
  }));
  return (
    <Popover
      aria-label="Default records"
      placement="bottom start"
      width="trigger"
      padding={0}
      trigger={
        <AriaButton className={s.fieldButton} aria-label="Default records">
          <span className={s.fieldButtonValue}>
            {selected.length > 0 ? (
              selected.map((r) => (
                <RecordChip
                  key={r.entityInstanceId}
                  entityDefinitionId={r.entityDefinitionId}
                  entityInstanceId={r.entityInstanceId}
                  interactive={false}
                />
              ))
            ) : (
              <span className={s.placeholderText}>Select one or more default records...</span>
            )}
          </span>
        </AriaButton>
      }
    >
      <RecordPicker
        entityDefinitionIds={[...allowedObjectIds]}
        selected={selected}
        multiple
        onSelect={(record, isSelected) => {
          const next = isSelected
            ? selected.filter((r) => r.entityInstanceId !== record.entityInstanceId)
            : [...selected, record];
          onChange(
            encodeStatic(
              next.map((r) => ({ entityDefinitionId: r.entityDefinitionId, entityInstanceId: r.entityInstanceId })),
            ),
          );
        }}
      />
    </Popover>
  );
}

function FieldButton({ children, placeholder }: { children?: ReactNode; placeholder: string }) {
  return (
    <AriaButton className={s.fieldButton} aria-label={placeholder}>
      <span className={s.fieldButtonValue}>{children ?? <span className={s.placeholderText}>{placeholder}</span>}</span>
    </AriaButton>
  );
}

function RelativeDateDefault({
  type,
  value,
  onChange,
}: {
  type: 'date' | 'timestamp';
  value: DefaultValue | null;
  onChange: (next: DefaultValue | null) => void;
}) {
  const [custom, setCustom] = useState(value?.type === 'static');
  const preset =
    value?.type === 'dynamic' ? RELATIVE_DATE_PRESETS.find((p) => p.duration === value.identifier) : undefined;
  const staticValue = typeof first(value) === 'string' ? (first(value) as string) : '';
  const placeholder = type === 'date' ? 'Set default date...' : 'Set default timestamp...';
  return (
    <>
      <MenuTrigger>
        <FieldButton placeholder={placeholder}>{preset?.label ?? (custom ? 'Custom date' : undefined)}</FieldButton>
        <Menu
          aria-label={placeholder}
          width={146}
          onAction={(k) => {
            if (k === 'custom') {
              setCustom(true);
              onChange(null);
              return;
            }
            setCustom(false);
            onChange({ type: 'dynamic', identifier: String(k) });
          }}
        >
          {RELATIVE_DATE_PRESETS.map((p) => (
            <MenuItem key={p.duration} id={p.duration}>
              {p.label}
            </MenuItem>
          ))}
          <MenuItem id="custom">Custom date</MenuItem>
        </Menu>
      </MenuTrigger>
      {custom && (
        <TextInput
          aria-label="Custom default date"
          size={32}
          type={type === 'date' ? 'date' : 'datetime-local'}
          value={type === 'date' ? staticValue.slice(0, 10) : staticValue.slice(0, 16)}
          onChange={(v) => {
            if (!v) return onChange(null);
            onChange(encodeStatic([type === 'date' ? v : new Date(v).toISOString()]));
          }}
        />
      )}
    </>
  );
}

function OptionDefault({
  multi,
  options,
  value,
  onChange,
  placeholder,
  idKey,
  stage,
}: {
  multi: boolean;
  options: readonly OptionDraft[];
  value: DefaultValue | null;
  onChange: (next: DefaultValue | null) => void;
  placeholder: string;
  idKey: 'selectOptionId' | 'pipelineStageId';
  stage?: boolean;
}) {
  const selected = decodeStatic(value)
    .map((v) => (v as Record<string, string> | null)?.[idKey])
    .filter((id): id is string => typeof id === 'string');
  const chosen = options.filter((o) => selected.includes(o.id));
  const items = options.filter((o) => o.title.trim());
  return (
    <MenuTrigger>
      <FieldButton placeholder={placeholder}>
        {chosen.length > 0
          ? chosen.map((o) =>
              stage ? (
                <span key={o.id} className={s.stageChip}>
                  <span className={`${s.stageDot} ${s.hueDot[toHue(o.color)]}`} />
                  {o.title}
                </span>
              ) : (
                <Tag key={o.id} color={o.color}>
                  {o.title}
                </Tag>
              ),
            )
          : undefined}
      </FieldButton>
      <Menu
        aria-label={placeholder}
        width={294}
        selectionMode={multi ? 'multiple' : 'single'}
        selectedKeys={selected}
        onSelectionChange={(keys) => {
          const ids = keys === 'all' ? items.map((o) => o.id) : [...keys].map(String);
          onChange(encodeStatic(ids.map((id) => ({ [idKey]: id }))));
        }}
        renderEmptyState={() => <div style={{ padding: '8px 12px', opacity: 0.6 }}>No options yet</div>}
      >
        {items.map((o) => (
          <MenuItem
            key={o.id}
            id={o.id}
            textValue={o.title}
            icon={stage ? <span className={`${s.stageDot} ${s.hueDot[toHue(o.color)]}`} /> : undefined}
          >
            {stage ? o.title : <Tag color={o.color}>{o.title}</Tag>}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}

function memberName(m: WorkspaceMember): string {
  return `${m.firstName} ${m.lastName}`.trim() || m.emailAddress;
}

function UserDefault({
  value,
  onChange,
  members,
  currentUserId,
}: {
  value: DefaultValue | null;
  onChange: (next: DefaultValue | null) => void;
  members: readonly WorkspaceMember[];
  currentUserId: string | null;
}) {
  const staticId = (first(value) as { referencedActorId?: string } | undefined)?.referencedActorId;
  const member = members.find((m) => m.id === staticId);
  const label =
    value?.type === 'dynamic' && value.identifier === 'current-user'
      ? 'Current user'
      : member
        ? memberName(member)
        : undefined;
  const active = members.filter((m) => !m.suspendedAt);
  return (
    <MenuTrigger>
      <FieldButton placeholder="Set a default user...">{label}</FieldButton>
      <Menu
        aria-label="Set a default user"
        width={294}
        onAction={(k) => {
          if (k === 'current-user') onChange({ type: 'dynamic', identifier: 'current-user' });
          else onChange(encodeStatic([{ referencedActorType: 'workspace-member', referencedActorId: String(k) }]));
        }}
      >
        <MenuItem id="current-user" icon="user">
          Current user
        </MenuItem>
        <MenuSection title="Workspace users">
          {active.map((m) => (
            <MenuItem key={m.id} id={m.id} icon="member">
              {`${memberName(m)}${m.userId === currentUserId ? ' (me)' : ''}`}
            </MenuItem>
          ))}
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}

const COUNTRIES = [
  ['US', '+1'],
  ['GB', '+44'],
  ['DE', '+49'],
  ['FR', '+33'],
  ['ES', '+34'],
  ['IT', '+39'],
  ['NL', '+31'],
  ['SE', '+46'],
  ['PL', '+48'],
  ['RU', '+7'],
  ['KZ', '+7'],
  ['UA', '+380'],
  ['AM', '+374'],
  ['GE', '+995'],
  ['TR', '+90'],
  ['AE', '+971'],
  ['IN', '+91'],
  ['CN', '+86'],
  ['JP', '+81'],
  ['BR', '+55'],
  ['CA', '+1'],
  ['AU', '+61'],
] as const;

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function PhoneDefault({
  value,
  onChange,
}: {
  value: DefaultValue | null;
  onChange: (next: DefaultValue | null) => void;
}) {
  const v = first(value) as { originalPhoneNumber?: string; countryCode?: string } | undefined;
  const browserRegion = (() => {
    try {
      return new Intl.Locale(navigator.language).maximize().region ?? 'US';
    } catch {
      return 'US';
    }
  })();
  const [country, setCountry] = useState(v?.countryCode ?? browserRegion);
  const number = v?.originalPhoneNumber ?? '';
  const dial = COUNTRIES.find(([c]) => c === country)?.[1] ?? '';
  const write = (n: string, c: string) =>
    onChange(n.trim() ? encodeStatic([{ originalPhoneNumber: n.trim(), countryCode: c }]) : null);
  return (
    <div className={s.phoneRow}>
      <Select<{ id: string; label: string }>
        aria-label="Country code"
        size={32}
        searchable
        menuWidth={240}
        items={COUNTRIES.map(([c, d]) => ({ id: c, label: `${regionName(c)} ${d}` }))}
        selectedKey={country}
        onSelectionChange={(k) => {
          setCountry(String(k));
          write(number, String(k));
        }}
        style={{ width: 120 }}
      >
        {(item) => (
          <SelectItem id={item.id} textValue={item.label}>
            {item.label}
          </SelectItem>
        )}
      </Select>
      <TextInput
        aria-label="Default phone number"
        size={32}
        placeholder="Set a value..."
        prefix={dial || undefined}
        value={number}
        onChange={(n) => write(n, country)}
        style={{ flex: 1 }}
      />
    </div>
  );
}

interface LocationDraft {
  line1?: string | null;
  locality?: string | null;
  region?: string | null;
  postcode?: string | null;
  countryCode?: string | null;
}

function LocationDefault({
  value,
  onChange,
}: {
  value: DefaultValue | null;
  onChange: (next: DefaultValue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const v = (first(value) as LocationDraft | undefined) ?? {};
  const set = (patch: LocationDraft) => {
    const next = { ...v, ...patch };
    const filled = Object.values(next).some((x) => typeof x === 'string' && x.trim());
    onChange(filled ? encodeStatic([next]) : null);
  };
  const summary = [v.line1, v.locality, v.region, v.postcode, v.countryCode ? regionName(v.countryCode) : null]
    .filter(Boolean)
    .join(', ');
  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      aria-label="Default location"
      width="trigger"
      padding={0}
      trigger={
        <AriaButton className={s.fieldButton} aria-label="Set a default location">
          <span className={s.fieldButtonValue}>
            {summary || <span className={s.placeholderText}>Set a default</span>}
          </span>
        </AriaButton>
      }
    >
      <div className={s.locationPanel} style={{ width: 'auto' }}>
        <TextInput
          label="Street address"
          size={32}
          value={v.line1 ?? ''}
          onChange={(line1) => set({ line1 })}
          autoFocus
        />
        <div className={s.twoCols}>
          <TextInput label="City" size={32} value={v.locality ?? ''} onChange={(locality) => set({ locality })} />
          <TextInput label="State" size={32} value={v.region ?? ''} onChange={(region) => set({ region })} />
          <TextInput
            label="Postal Code"
            size={32}
            value={v.postcode ?? ''}
            onChange={(postcode) => set({ postcode })}
          />
          <Select<{ id: string; label: string }>
            label="Country"
            size={32}
            searchable
            placeholder="Select a country"
            items={COUNTRIES.filter(([c], i, all) => all.findIndex(([x]) => x === c) === i).map(([c]) => ({
              id: c,
              label: regionName(c),
            }))}
            selectedKey={v.countryCode ?? null}
            onSelectionChange={(k) => set({ countryCode: String(k) })}
          >
            {(item) => <SelectItem id={item.id}>{item.label}</SelectItem>}
          </Select>
        </div>
      </div>
    </Popover>
  );
}
