// One configuration field (block-catalog §7): label above the control ("(optional)" suffix), the {x} "Use a variable"
// button on the label row for variable-capable inputs, the control for the input's kind, and the first issue of the
// input in red under it ("This input is required."). `InputControl` dispatches on the catalogue's control type.
import type { BlockConfig, ConfigExpr, InputSpec } from '@agentic-crm/contracts';
import { type ReactNode, useRef } from 'react';
import {
  issueAt,
  issuesUnder,
  richTextSegments,
  segmentsEmpty,
  segmentsToRichText,
  valueOrDefault,
} from '../../model/config';
import type { WorkflowBlock } from '../../types';
import { useEditorUi } from '../EditorContext';
import { Conditions, SwitchCases } from './Conditions';
import { FindFilter } from './FindFilter';
import { AttributeInput, ConfiguredAttributes, DefinitionInput } from './inputs/definitions';
import {
  ActorsInput,
  BooleanInput,
  CronInput,
  DaysInput,
  DurationInput,
  EnumInput,
  EnumMultiInput,
  HeadersInput,
  JsonInput,
  NumberInput,
  RecordInput,
  RecordsInput,
  TimeInput,
  TimestampInput,
  TimezoneInput,
  VariableOnlyInput,
} from './inputs/values';
import * as s from './panel.css';
import { VarButton } from './VariableChip';
import { VariableText, type VariableTextHandle } from './VariableText';

export interface FieldProps {
  block: WorkflowBlock;
  spec: InputSpec;
  readOnly: boolean;
  onConfig: (next: BlockConfig) => void;
}

export interface InputProps {
  block: WorkflowBlock;
  spec: InputSpec;
  value: ConfigExpr | undefined;
  readOnly: boolean;
  invalid: boolean;
  onChange: (value: ConfigExpr | undefined) => void;
  /** Set by inputs that take a variable: the {x} button calls it with itself as the anchor. */
  registerVariableOpener: (open: ((anchor: Element) => void) | null) => void;
}

/** Inputs whose label row carries the {x} button. */
const VARIABLE_CONTROLS = new Set<InputSpec['control']>([
  'rich-text',
  'text',
  'record',
  'entry',
  'records',
  'actors',
  'actors-or-teams',
  'task',
  'meeting',
  'number',
  'timestamp',
  'duration',
  'array',
  'json',
]);

export function Field({ block, spec, readOnly, onConfig }: FieldProps) {
  const opener = useRef<((anchor: Element) => void) | null>(null);
  const varButton = useRef<HTMLButtonElement>(null);
  const value = valueOrDefault(block.config, spec);
  const ui = useEditorUi();
  const shown = ui.showRequired ? block.issues : block.issues.filter((i) => i.code !== 'required' || i.path.length > 1);
  const issue = issueAt(shown, [spec.key]) ?? issuesUnder(shown, spec.key)[0]?.message ?? null;
  const withVariable = spec.variables !== 'none' && VARIABLE_CONTROLS.has(spec.control) && !readOnly;
  const onChange = (next: ConfigExpr | undefined) => {
    const entries = { ...block.config.entries };
    if (next === undefined) delete entries[spec.key];
    else entries[spec.key] = next;
    onConfig({ type: 'object', entries });
  };
  const label = spec.required || spec.control === 'configured-attributes' ? spec.label : `${spec.label} (optional)`;
  return (
    <div className={s.field} data-testid="config-field" data-key={spec.key}>
      {spec.control !== 'predicate' && spec.control !== 'cases' && (
        <div className={s.labelRow}>
          <span className={s.label}>{label}</span>
          {withVariable && (
            <VarButton buttonRef={varButton} onPress={() => varButton.current && opener.current?.(varButton.current)} />
          )}
        </div>
      )}
      <InputControl
        block={block}
        spec={spec}
        value={value}
        readOnly={readOnly}
        invalid={issue !== null}
        onChange={onChange}
        registerVariableOpener={(fn) => {
          opener.current = fn;
        }}
      />
      {issue ? (
        <span className={s.fieldError} data-testid="field-error">
          {issue}
        </span>
      ) : spec.hint ? (
        <span className={s.fieldHint}>{spec.hint}</span>
      ) : null}
    </div>
  );
}

function InputControl(props: InputProps): ReactNode {
  const { spec } = props;
  switch (spec.control) {
    case 'object':
    case 'list':
    case 'object-or-list':
      return <DefinitionInput {...props} />;
    case 'attribute':
    case 'unique-attribute':
      return <AttributeInput {...props} />;
    case 'configured-attributes':
      return <ConfiguredAttributes {...props} />;
    case 'rich-text':
    case 'text':
      return <RichTextInput {...props} />;
    case 'record':
    case 'entry':
      return <RecordInput {...props} />;
    case 'records':
      return <RecordsInput {...props} />;
    case 'actors':
    case 'actors-or-teams':
      return <ActorsInput {...props} />;
    case 'task':
    case 'meeting':
    case 'array':
      return <VariableOnlyInput {...props} />;
    case 'number':
      return <NumberInput {...props} />;
    case 'boolean':
      return <BooleanInput {...props} />;
    case 'timestamp':
      return <TimestampInput {...props} />;
    case 'duration':
      return <DurationInput {...props} />;
    case 'enum':
      return <EnumInput {...props} />;
    case 'enum-multi':
      return <EnumMultiInput {...props} />;
    case 'days-of-week':
    case 'days-of-month':
      return <DaysInput {...props} />;
    case 'time-of-day':
      return <TimeInput {...props} />;
    case 'timezone':
      return <TimezoneInput {...props} />;
    case 'cron':
      return <CronInput {...props} />;
    case 'predicate':
      return <Conditions {...props} />;
    case 'cases':
      return <SwitchCases {...props} />;
    case 'filter':
      return <FindFilter {...props} />;
    case 'json':
    case 'json-schema':
      return <JsonInput {...props} />;
    case 'headers':
      return <HeadersInput {...props} />;
    default:
      return (
        <div className={`${s.control}`} data-disabled>
          Not available yet
        </div>
      );
  }
}

/** Text with inline variables (rich text); an empty text clears the input. */
export function RichTextInput({ block, spec, value, readOnly, invalid, onChange, registerVariableOpener }: InputProps) {
  const ref = useRef<VariableTextHandle>(null);
  registerVariableOpener((anchor) => ref.current?.openPicker(anchor));
  return (
    <VariableText
      ref={ref}
      blockId={block.id}
      value={richTextSegments(value)}
      expected={spec.valueType}
      multiline={spec.key === 'content' || spec.key === 'description' || spec.key === 'instructions'}
      placeholder={spec.placeholder ?? (spec.key === 'formula' ? 'Enter a formula, e.g. {Value} * 2' : undefined)}
      invalid={invalid}
      readOnly={readOnly}
      onCommit={(segments) => onChange(segmentsEmpty(segments) ? undefined : segmentsToRichText(segments))}
    />
  );
}
