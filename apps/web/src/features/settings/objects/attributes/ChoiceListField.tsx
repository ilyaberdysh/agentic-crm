// Options (select / multi-select) and Statuses fields with their popover editors (J attribute-dialogs §5; raw J
// s15–s17, s21–s23). The field shows the current options as coloured chips (≈12 chars + "…") or stages as dot +
// name; "No Options" / "No stages" when empty. Editor rows: ⋮⋮ (reorder) · colour (12 pastel swatches / solid stage
// colours) · name input · copy ID + ✕ (options) or ⋮ menu (stages: Confetti, Time in status, Copy status ID, Delete
// status). "+ Create option" / "+ Add status" add a row and focus it; Enter commits and blurs. Deleting is immediate
// in the editor and becomes an archive on save.
import {
  Button,
  Icon,
  IconButton,
  Popover,
  Select,
  SelectItem,
  Switch,
  selectOptionColors,
  statusColors,
  Tag,
  toast,
  toHue,
} from '@agentic-crm/ui';
import { useEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { newId } from '../../../../lib/ids';
import { useDragReorder } from '../dragReorder';
import { copyToClipboard } from '../parts';
import * as s from './attributes.css';
import { type DurationUnit, nextColor, type OptionDraft, type StageDraft } from './formModel';

type Mode = 'option' | 'stage';

function truncate(title: string, max = 12): string {
  return title.length > max ? `${title.slice(0, max)}…` : title;
}

export function ChoiceListField<T extends OptionDraft>({
  mode,
  label,
  items,
  onChange,
  errors,
  limit = null,
}: {
  mode: Mode;
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  errors?: Record<string, string>;
  /** Options/stages per attribute (quota `select_options_per_attribute_hard`); null = unlimited. */
  limit?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const invalid = errors && Object.keys(errors).length > 0;
  const atLimit = limit !== null && items.length >= limit;

  function add() {
    if (atLimit) return;
    const id = newId();
    const color = nextColor(
      mode,
      items.map((i) => i.color),
    );
    const base: OptionDraft = { id, title: '', color, isNew: true };
    const draft = (mode === 'stage'
      ? { ...base, celebrationEnabled: false, targetTime: { amount: '', unit: 'days' } }
      : base) as unknown as T;
    onChange([...items, draft]);
    setFocusId(id);
  }

  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <Popover
        isOpen={open}
        onOpenChange={setOpen}
        aria-label={label}
        width="trigger"
        offset={4}
        padding={0}
        trigger={
          <AriaButton className={s.fieldButton} data-invalid={invalid || undefined} aria-label={label}>
            <span className={s.fieldButtonValue}>
              {items.length === 0 ? (
                <span>{mode === 'stage' ? 'No stages' : 'No Options'}</span>
              ) : mode === 'stage' ? (
                items.map((i) => (
                  <span key={i.id} className={s.stageChip}>
                    <span className={`${s.stageDot} ${s.hueDot[toHue(i.color)]}`} />
                    {i.title || 'Untitled'}
                  </span>
                ))
              ) : (
                items.map((i) => (
                  <Tag key={i.id} color={i.color}>
                    {truncate(i.title || 'Untitled')}
                  </Tag>
                ))
              )}
            </span>
          </AriaButton>
        }
      >
        <ChoiceEditor
          mode={mode}
          items={items}
          onChange={onChange}
          onAdd={add}
          focusId={focusId}
          errors={errors}
          limitReached={atLimit ? limit : null}
        />
      </Popover>
    </div>
  );
}

function ChoiceEditor<T extends OptionDraft>({
  mode,
  items,
  onChange,
  onAdd,
  focusId,
  errors,
  limitReached,
}: {
  mode: Mode;
  items: T[];
  onChange: (items: T[]) => void;
  onAdd: () => void;
  focusId: string | null;
  errors?: Record<string, string>;
  limitReached: number | null;
}) {
  const drag = useDragReorder(items, (next) => onChange(next));
  const update = (id: string, patch: Partial<T>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const remove = (id: string) => onChange(items.filter((i) => i.id !== id));

  return (
    <div className={s.editorPanel} data-editor-panel tabIndex={-1} style={{ outline: 'none' }}>
      {items.length > 0 && (
        <div className={s.editorRows}>
          {items.map((item) => (
            <div key={item.id}>
              <div
                className={`${s.editorRow} ${drag.dropTarget?.id === item.id ? (drag.dropTarget.position === 'before' ? s.dropBefore : s.dropAfter) : ''} ${drag.dragId === item.id ? s.dragging : ''}`}
                {...drag.rowProps(item.id)}
              >
                <span className={s.dragHandle} {...drag.handleProps(item.id)} aria-hidden="true">
                  <Icon icon="drag" size={14} />
                </span>
                <ColorPicker
                  mode={mode}
                  value={item.color}
                  onChange={(color) => update(item.id, { color } as Partial<T>)}
                />
                <RowInput
                  value={item.title}
                  placeholder={mode === 'stage' ? 'Status name' : 'Option name'}
                  autoFocus={focusId === item.id}
                  onChange={(title) => update(item.id, { title } as Partial<T>)}
                />
                {mode === 'option' ? (
                  <>
                    <IconButton
                      icon="copy"
                      aria-label="Copy option ID to clipboard"
                      tooltip="Copy option ID to clipboard"
                      size={20}
                      onPress={() => void copyToClipboard(item.id, (t) => toast(t, { icon: 'copy' }))}
                    />
                    <IconButton
                      icon="close"
                      aria-label="Delete"
                      tooltip="Delete"
                      size={20}
                      onPress={() => remove(item.id)}
                    />
                  </>
                ) : (
                  <StageMenu
                    stage={item as unknown as StageDraft}
                    onChange={(patch) => update(item.id, patch as Partial<T>)}
                    onDelete={() => remove(item.id)}
                  />
                )}
              </div>
              {errors?.[item.id] && <div className={s.editorRowError}>{errors[item.id]}</div>}
            </div>
          ))}
        </div>
      )}
      <div className={s.editorFooter}>
        {limitReached !== null && (
          <p className={s.limitNote}>
            Reached the limit of {limitReached} {mode === 'stage' ? 'statuses' : 'options'}. New{' '}
            {mode === 'stage' ? 'statuses' : 'options'} will not be created.
          </p>
        )}
        <Button variant="secondary" size={32} icon="add" fullWidth isDisabled={limitReached !== null} onPress={onAdd}>
          {mode === 'stage' ? 'Add status' : 'Create option'}
        </Button>
      </div>
    </div>
  );
}

/** Inline name input: Enter commits and blurs (it does not create the next row). */
function RowInput({
  value,
  placeholder,
  autoFocus,
  onChange,
}: {
  value: string;
  placeholder: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      className={s.editorInput}
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // Blur by moving focus to the panel (the popover keeps focus inside itself).
          const panel = e.currentTarget.closest<HTMLElement>('[data-editor-panel]');
          if (panel) panel.focus();
          else e.currentTarget.blur();
        }
      }}
    />
  );
}

function ColorPicker({ mode, value, onChange }: { mode: Mode; value: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  const palette: readonly string[] = mode === 'stage' ? statusColors : selectOptionColors;
  const hue = toHue(value);
  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      aria-label="Choose a colour"
      placement="bottom start"
      padding={0}
      trigger={
        <AriaButton
          aria-label="Change colour"
          className={`${s.colorButton} ${mode === 'stage' ? '' : s.hueSubtle[hue]}`}
        >
          {mode === 'stage' ? (
            <span className={`${s.stageDot} ${s.hueDot[hue]}`} style={{ width: 12, height: 12, borderRadius: 6 }} />
          ) : (
            <Icon icon="chevronDown" size={12} />
          )}
        </AriaButton>
      }
    >
      <div className={s.colorGrid}>
        {palette.map((color) => {
          const h = toHue(color);
          const selected = color === value;
          return (
            <AriaButton
              key={color}
              aria-label={color.replace(/^(pastel|block)_/, '')}
              className={s.colorCell}
              onPress={() => {
                onChange(color);
                setOpen(false);
              }}
            >
              <span
                className={`${s.colorSample} ${mode === 'stage' ? s.hueDot[h] : s.hueSubtle[h]} ${selected ? s.colorSampleSelected : ''}`}
              >
                {mode === 'option' ? 'A' : ''}
              </span>
            </AriaButton>
          );
        })}
      </div>
    </Popover>
  );
}

const UNITS: Array<{ id: DurationUnit; label: string }> = [
  { id: 'days', label: 'Days' },
  { id: 'months', label: 'Months' },
  { id: 'years', label: 'Years' },
];

function StageMenu({
  stage,
  onChange,
  onDelete,
}: {
  stage: StageDraft;
  onChange: (patch: Partial<StageDraft>) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      aria-label="Status options"
      placement="right top"
      offset={8}
      padding={0}
      trigger={<IconButton icon="moreVertical" aria-label="Status options" size={20} />}
    >
      <div className={s.stageMenu}>
        <div className={s.stageMenuRow}>
          <span>Confetti</span>
          <Switch
            aria-label="Confetti"
            isSelected={stage.celebrationEnabled}
            onChange={(celebrationEnabled) => onChange({ celebrationEnabled })}
          />
        </div>
        <div className={s.stageMenuLabel}>Time in status</div>
        <div className={s.timeRow}>
          <input
            className={s.timeInput}
            type="number"
            min={1}
            placeholder="Unlimited"
            aria-label="Time in status"
            value={stage.targetTime.amount}
            onChange={(e) => onChange({ targetTime: { ...stage.targetTime, amount: e.target.value } })}
          />
          <Select<{ id: DurationUnit; label: string }>
            aria-label="Unit"
            items={UNITS}
            size={32}
            menuWidth={120}
            selectedKey={stage.targetTime.unit}
            onSelectionChange={(k) => onChange({ targetTime: { ...stage.targetTime, unit: k as DurationUnit } })}
            style={{ width: 96 }}
          >
            {(u) => <SelectItem id={u.id}>{u.label}</SelectItem>}
          </Select>
        </div>
        <div style={{ height: 1, background: 'var(--ar-color-stroke-primary)', margin: '3px 0' }} />
        <Button
          variant="ghost"
          size={32}
          icon="copy"
          fullWidth
          style={{ justifyContent: 'flex-start' }}
          onPress={() => {
            void copyToClipboard(stage.id, (t) => toast(t, { icon: 'copy' }));
            setOpen(false);
          }}
        >
          Copy status ID
        </Button>
        <Button
          variant="ghost"
          size={32}
          icon="close"
          fullWidth
          style={{ justifyContent: 'flex-start', color: 'var(--ar-color-content-critical)' }}
          onPress={() => {
            setOpen(false);
            onDelete();
          }}
        >
          Delete status
        </Button>
      </div>
    </Popover>
  );
}
