// Variable chips: "{ Record action › … › Headcount }" in blue (amber when the data source no longer
// resolves). Clicking one opens its settings: the data sources in order (first non-empty wins) with "Add data source",
// a "Fallback" switch with a static value, and Remove.
import type { VariableExpr, WfType } from '@agentic-crm/contracts';
import { Button, Icon, IconButton, PopoverPanel, Switch } from '@agentic-crm/ui';
import { type ReactNode, type RefObject, useRef, useState } from 'react';
import { Dialog } from 'react-aria-components';
import { useVariables } from '../../data';
import { addDataSource, type ChipLabel, chipLabel, type PickerData } from '../../model/variables';
import { useEditorUi } from '../EditorContext';
import * as ps from './panel.css';
import * as s from './picker.css';
import { VariablePicker } from './VariablePicker';

export function useChipLabel(blockId: string, variable: VariableExpr): ChipLabel {
  const ui = useEditorUi();
  const data = useVariables(ui.page.workflowId, blockId, ui.viewingVersionId).data as PickerData | undefined;
  return chipLabel(data, variable, ui.blockTitle);
}

export function ChipContent({ label }: { label: ChipLabel }) {
  return (
    <>
      <span className={s.chipBrace}>{'{'}</span>
      {label.shown.map((seg, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span className={s.chipSep}>›</span>}
          <span>{seg}</span>
        </span>
      ))}
      <span className={s.chipBrace}>{'}'}</span>
    </>
  );
}

/** A chip rendered by React (single-variable inputs, conditions, read-only configuration). */
export function VariableChip({
  blockId,
  variable,
  expected,
  readOnly,
  onChange,
  onRemove,
}: {
  blockId: string;
  variable: VariableExpr;
  expected?: WfType;
  readOnly?: boolean;
  onChange?: (next: VariableExpr) => void;
  onRemove?: () => void;
}) {
  const label = useChipLabel(blockId, variable);
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <span
        ref={ref}
        className={s.chip}
        data-broken={label.broken || undefined}
        data-readonly={readOnly || undefined}
        data-testid="variable-chip"
        title={label.segments.join(' › ')}
        role={readOnly ? undefined : 'button'}
        tabIndex={readOnly ? undefined : 0}
        onClick={(e) => {
          e.stopPropagation();
          if (!readOnly) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!readOnly && (e.key === 'Enter' || e.key === ' ')) setOpen(true);
        }}
      >
        <ChipContent label={label} />
      </span>
      {!readOnly && (
        <ChipSettings
          anchor={ref}
          isOpen={open}
          onOpenChange={setOpen}
          blockId={blockId}
          variable={variable}
          expected={expected}
          onChange={(v) => onChange?.(v)}
          onRemove={() => {
            setOpen(false);
            onRemove?.();
          }}
        />
      )}
    </>
  );
}

/** The chip's settings popover (data sources, fallback, remove). */
export function ChipSettings({
  anchor,
  isOpen,
  onOpenChange,
  blockId,
  variable,
  expected,
  onChange,
  onRemove,
}: {
  anchor: RefObject<Element | null>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  blockId: string;
  variable: VariableExpr;
  expected?: WfType;
  onChange: (next: VariableExpr) => void;
  onRemove: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const fallbackText =
    variable.fallback?.type === 'string'
      ? variable.fallback.value
      : variable.fallback?.type === 'number'
        ? String(variable.fallback.value)
        : '';
  const [fallback, setFallback] = useState(fallbackText);
  const hasFallback = variable.fallback !== undefined && variable.fallback !== null;
  const commitFallback = (text: string) => {
    const trimmed = text.trim();
    const numeric = expected?.kind === 'number' && trimmed !== '' && !Number.isNaN(Number(trimmed));
    onChange({
      ...variable,
      fallback: numeric ? { type: 'number', value: Number(trimmed) } : { type: 'string', value: text },
    });
  };
  return (
    <PopoverPanel
      triggerRef={anchor as RefObject<Element>}
      isOpen={isOpen}
      onOpenChange={(o) => {
        if (!o) setAdding(false);
        onOpenChange(o);
      }}
      placement="bottom start"
      padding={4}
    >
      <Dialog aria-label="Variable settings" style={{ outline: 'none' }}>
        {adding ? (
          <VariablePicker
            blockId={blockId}
            expected={expected}
            onPick={(source) => {
              setAdding(false);
              onChange(addDataSource(variable, source));
            }}
          />
        ) : (
          <div className={s.sources} data-testid="variable-settings">
            <span className={s.sourceLabel}>Data sources</span>
            {variable.matchers.map((m, i) => (
              <SourceRow
                key={m.id}
                blockId={blockId}
                variable={{ type: 'variable', matchers: [m] }}
                onRemove={
                  variable.matchers.length > 1
                    ? () => onChange({ ...variable, matchers: variable.matchers.filter((_, k) => k !== i) })
                    : undefined
                }
              />
            ))}
            <Button variant="secondary" size={28} icon="add" onPress={() => setAdding(true)}>
              Add data source
            </Button>
            <div className={s.sourceRow}>
              <Switch
                isSelected={hasFallback}
                aria-label="Fallback"
                onChange={(on) => {
                  if (on) commitFallback(fallback);
                  else {
                    const { fallback: _f, ...rest } = variable;
                    onChange(rest);
                  }
                }}
              >
                <span className={s.sourceLabel}>Fallback</span>
              </Switch>
            </div>
            {hasFallback && (
              <input
                className={s.chip}
                style={{
                  height: 30,
                  borderRadius: 8,
                  padding: '0 8px',
                  background: 'transparent',
                  color: 'inherit',
                  border: '1px solid var(--ar-color-stroke-secondary)',
                  cursor: 'text',
                  userSelect: 'text',
                }}
                aria-label="Fallback value"
                placeholder="Fallback value"
                value={fallback}
                onChange={(e) => setFallback(e.target.value)}
                onBlur={() => commitFallback(fallback)}
              />
            )}
            <Button variant="secondary-destructive" size={28} icon="delete" onPress={onRemove}>
              Remove variable
            </Button>
          </div>
        )}
      </Dialog>
    </PopoverPanel>
  );
}

function SourceRow({
  blockId,
  variable,
  onRemove,
}: {
  blockId: string;
  variable: VariableExpr;
  onRemove?: () => void;
}): ReactNode {
  const label = useChipLabel(blockId, variable);
  return (
    <div className={s.sourceRow}>
      <span className={s.chip} data-broken={label.broken || undefined} data-readonly>
        <ChipContent label={label} />
      </span>
      <span style={{ flex: 1 }} />
      {onRemove && <IconButton icon="close" size={20} aria-label="Remove data source" onPress={onRemove} />}
    </div>
  );
}

/** {x} "Use a variable" button on a field's label row. */
export function VarButton({
  onPress,
  buttonRef,
}: {
  onPress: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={ps.varButton}
      aria-label="Use a variable"
      title="Use a variable"
      data-testid="use-variable"
      onClick={onPress}
    >
      <Icon icon="wfVariable" size={14} />
    </button>
  );
}
