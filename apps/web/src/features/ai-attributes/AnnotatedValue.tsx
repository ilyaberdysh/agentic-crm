// Per-record states of formula and AI values, drawn around the
// registry's View in table cells and record fields:
// formula  calculating → "Calculating..." (role=status); errored → "Couldn't calculate a result" + warning (known
// runtime codes; tooltip = public message or code) or "Calculation error" (tooltip "Something went wrong
// while calculating this value."); otherwise the value.
// AI thinking → "AI is thinking..."; error without a value → "Couldn't generate a value"; error with a value →
// the earlier value with an "outdated" dot; otherwise the value.
// Annotations come from the batched `formulas.annotations` reads and refresh on `entity-annotation` invalidations.
import type { AttributeDefinition } from '@agentic-crm/contracts';
import { RUNTIME_ERROR_CODES } from '@agentic-crm/formula';
import { Icon, IconButton, Tooltip } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { WorkspaceRef } from '../../data/trpc';
import { isAnnotated, useAnnotation } from '../formulas/data';
import * as s from './ai.css';
import { aiErrorText, aiValueState, formulaValueState } from './model';

type AnnotatedAttribute = Pick<
  AttributeDefinition,
  'id' | 'entityDefinitionId' | 'formulaConfiguration' | 'aiAutofillConfiguration' | 'title'
>;

const KNOWN_RUNTIME = new Set<string>(RUNTIME_ERROR_CODES);

export function AnnotatedValue({
  workspace,
  attribute,
  recordId,
  hasValue,
  density,
  live = true,
  children,
}: {
  workspace: WorkspaceRef;
  attribute: AnnotatedAttribute;
  recordId: string | undefined;
  hasValue: boolean;
  density: 'cell' | 'field';
  /** False while a table flings: cached annotation only, no request. */
  live?: boolean;
  children: ReactNode;
}) {
  const annotation = useAnnotation(workspace, attribute, recordId, live);
  if (!isAnnotated(attribute)) return <>{children}</>;
  const box = density === 'cell' ? s.cellState : s.fieldState;

  if (attribute.formulaConfiguration) {
    const state = formulaValueState(annotation);
    if (state === 'calculating') {
      return (
        <div className={box} role="status" data-testid="formula-calculating">
          <span className={s.muted}>Calculating...</span>
        </div>
      );
    }
    if (state === 'errored') {
      const f = annotation?.formula;
      const code = f?.lastExecutionError ?? '';
      const known = KNOWN_RUNTIME.has(code);
      return (
        <div className={box} data-testid="formula-error">
          <Tooltip
            content={
              known
                ? (f?.lastExecutionErrorPublicMessage ?? code)
                : 'Something went wrong while calculating this value.'
            }
          >
            <AriaButton
              style={{ border: 'none', background: 'none', padding: 0, display: 'flex', gap: 6, minWidth: 0 }}
            >
              {known ? (
                <>
                  <Icon icon="warning" size={14} className={s.warnIcon} />
                  <span className={s.muted}>Couldn't calculate a result</span>
                </>
              ) : (
                <span className={s.negative}>Calculation error</span>
              )}
            </AriaButton>
          </Tooltip>
        </div>
      );
    }
    return <>{children}</>;
  }

  const state = aiValueState(annotation, hasValue);
  if (state === 'thinking') {
    return (
      <div className={box} role="status" data-testid="ai-thinking">
        <span className={s.thinking}>AI is thinking...</span>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className={box} data-testid="ai-error">
        <Tooltip content={aiErrorText(annotation?.aiAutofill?.error)}>
          <AriaButton style={{ border: 'none', background: 'none', padding: 0, display: 'flex', gap: 6, minWidth: 0 }}>
            <Icon icon="warning" size={14} className={s.warnIcon} />
            <span className={s.muted}>Couldn't generate a value</span>
          </AriaButton>
        </Tooltip>
      </div>
    );
  }
  if (state === 'outdated') {
    return (
      <div className={s.withMarker} data-testid="ai-outdated">
        <div className={s.valueGrow}>{children}</div>
        <Tooltip
          content={`Outdated: the last AI run failed (${aiErrorText(annotation?.aiAutofill?.error)}). Showing the previous value.`}
        >
          <AriaButton className={s.outdatedDot} aria-label="Outdated value" />
        </Tooltip>
      </div>
    );
  }
  return <>{children}</>;
}

/** The marker after an attribute's label: "fx" for formulas, a sparkle for AI autofill (record page, headers). */
export function AttributeKindMarker({
  attribute,
  size = 14,
  className,
}: {
  attribute: Pick<AttributeDefinition, 'formulaConfiguration' | 'aiAutofillConfiguration'>;
  size?: number;
  className?: string;
}) {
  if (attribute.formulaConfiguration) {
    return <Icon icon="formulaFx" size={size} className={className ?? s.marker} label="Formula" />;
  }
  if (attribute.aiAutofillConfiguration?.isEnabled) {
    return <Icon icon="askAi" size={size} className={className ?? s.marker} label="AI autofill" />;
  }
  return null;
}

/** Hover action of an AI value on the record page: "Run AI autofill" (opens the confirmation). */
export function RunAiAction({ onRun }: { onRun: () => void }) {
  return (
    <span
      className={s.hoverActions}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <IconButton
        icon="aiRun"
        size={20}
        aria-label="Run AI autofill"
        tooltip="Run AI autofill"
        onPress={() => {
          // The action hides again once the confirmation takes over (it shows on hover / focus).
          (document.activeElement as HTMLElement | null)?.blur();
          onRun();
        }}
      />
    </span>
  );
}
