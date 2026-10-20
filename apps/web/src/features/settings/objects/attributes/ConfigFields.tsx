// Number and currency display configuration (J attribute-dialogs §3; raw J s12-dlg-number, s12-dlg-currency,
// s24-dd-currency / display / decimals / grouping): every option previews 1200.50 in the browser locale.
import { currencyCodes } from '@agentic-crm/contracts';
import { Select, SelectItem, TextInput } from '@agentic-crm/ui';
import * as s from './attributes.css';
import type { AttributeFormState, CurrencyDisplay } from './formModel';

const SAMPLE = 1200.5;

function fmt(options: Intl.NumberFormatOptions): string {
  try {
    return new Intl.NumberFormat(undefined, options).format(SAMPLE);
  } catch {
    return String(SAMPLE);
  }
}

function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** 47 currencies as "<name> <code>", alphabetical by name. */
const CURRENCIES = [...currencyCodes]
  .map((code) => ({ id: code, name: currencyName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

type Set = (patch: Partial<AttributeFormState>) => void;

interface Item {
  id: string;
  label: string;
  preview?: string;
}

function ConfigSelect({
  label,
  items,
  value,
  onChange,
  searchable,
}: {
  label: string;
  items: Item[];
  value: string;
  onChange: (id: string) => void;
  searchable?: boolean;
}) {
  return (
    <Select<Item>
      label={label}
      necessity="required"
      size={32}
      items={items}
      searchable={searchable}
      selectedKey={value}
      onSelectionChange={(k) => onChange(String(k))}
      className={s.configSelect}
    >
      {(item) => (
        <SelectItem id={item.id} textValue={item.label}>
          {item.label}
          {item.preview && <span className={s.optionPreview}>{item.preview}</span>}
        </SelectItem>
      )}
    </Select>
  );
}

export function NumberConfig({ state, set, error }: { state: AttributeFormState; set: Set; error?: string }) {
  const places = state.decimalPlaces === '' ? undefined : Number(state.decimalPlaces);
  const digits = places !== undefined && Number.isInteger(places) && places >= 0 && places <= 4 ? places : 1;
  return (
    <div className={s.twoCols}>
      <TextInput
        label="Decimal places"
        size={34}
        inputMode="numeric"
        placeholder="Enter a value between 0 and 4"
        value={state.decimalPlaces}
        onChange={(decimalPlaces) => set({ decimalPlaces })}
        isInvalid={Boolean(error)}
        errorMessage={error}
      />
      <ConfigSelect
        label="Grouping"
        value={state.numberGroups}
        onChange={(v) => set({ numberGroups: v as AttributeFormState['numberGroups'] })}
        items={[
          {
            id: 'default',
            label: 'Default',
            preview: fmt({ minimumFractionDigits: digits, maximumFractionDigits: digits }),
          },
          {
            id: 'no-groups',
            label: 'No groups',
            preview: fmt({ minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false }),
          },
        ]}
      />
    </div>
  );
}

export function CurrencyConfig({ state, set }: { state: AttributeFormState; set: Set }) {
  const base: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: state.currencyCode,
    currencyDisplay: state.currencyDisplay,
    ...(state.currencyDecimals === 'no-decimals' ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : {}),
    useGrouping: state.currencyGroups === 'default',
  };
  return (
    <>
      <div className={s.twoCols}>
        <ConfigSelect
          label="Currency"
          searchable
          value={state.currencyCode}
          onChange={(currencyCode) => set({ currencyCode })}
          items={CURRENCIES.map((c) => ({ id: c.id, label: c.name, preview: c.id }))}
        />
        <ConfigSelect
          label="Display"
          value={state.currencyDisplay}
          onChange={(v) => set({ currencyDisplay: v as CurrencyDisplay })}
          items={(
            [
              ['code', 'Code'],
              ['name', 'Name'],
              ['narrowSymbol', 'Narrow symbol'],
              ['symbol', 'Symbol'],
            ] as const
          ).map(([id, label]) => ({ id, label, preview: fmt({ ...base, currencyDisplay: id }) }))}
        />
      </div>
      <div className={s.twoCols}>
        <ConfigSelect
          label="Decimal Places"
          value={state.currencyDecimals}
          onChange={(v) => set({ currencyDecimals: v as AttributeFormState['currencyDecimals'] })}
          items={[
            {
              id: 'two-decimals',
              label: '2 decimals',
              preview: fmt({ ...base, minimumFractionDigits: 2, maximumFractionDigits: 2 }),
            },
            {
              id: 'no-decimals',
              label: 'No decimals',
              preview: fmt({ ...base, minimumFractionDigits: 0, maximumFractionDigits: 0 }),
            },
          ]}
        />
        <ConfigSelect
          label="Grouping"
          value={state.currencyGroups}
          onChange={(v) => set({ currencyGroups: v as AttributeFormState['currencyGroups'] })}
          items={[
            { id: 'default', label: 'Default', preview: fmt({ ...base, useGrouping: true }) },
            { id: 'no-groups', label: 'No groups', preview: fmt({ ...base, useGrouping: false }) },
          ]}
        />
      </div>
    </>
  );
}
