// "AI autofill" card of the create / edit attribute dialog (ai-attributes.md §3, `EI:ai-attribute-create-summarize.png`):
// header "Set up AI autofill" + switch; when on: "Autofill type" select (icon + label, entries with descriptions),
// "Prompt" / "Prompt (optional)" editor with variable chips and a "{ } Use variable" footer button, the helper line,
// and for select attributes "Allow AI to generate new options". Without an LLM the card says AI is not configured.
import type { AiAutofillType } from '@agentic-crm/contracts';
import { Button, Icon, Menu, MenuItem, MenuTrigger, Switch } from '@agentic-crm/ui';
import { useMemo, useRef } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { WorkspaceRef } from '../../data/trpc';
import { useAiConfigured } from '../formulas/data';
import { CodeEditor, type CodeEditorHandle } from '../formulas/editor/CodeEditor';
import { useReferences } from '../formulas/useReferences';
import * as s from './ai.css';
import {
  type AiAutofillState,
  type AiCapableType,
  AUTOFILL_TYPES,
  aiStateError,
  allowedAutofillTypes,
  docToPrompt,
  promptToDoc,
} from './model';

export function AiAutofillCard({
  workspace,
  entityDefinitionId,
  attributeId,
  type,
  value,
  onChange,
  showErrors,
  labelClassName,
  fieldClassName,
}: {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  attributeId: string | null;
  type: AiCapableType;
  value: AiAutofillState;
  onChange: (next: AiAutofillState) => void;
  showErrors?: boolean;
  labelClassName?: string;
  fieldClassName?: string;
}) {
  const configured = useAiConfigured(workspace);
  const info = AUTOFILL_TYPES[value.type];
  const types = allowedAutofillTypes(type);
  const set = (patch: Partial<AiAutofillState>) => onChange({ ...value, ...patch });
  const error = showErrors ? aiStateError(value) : null;
  const switchDisabled = configured === false && !value.enabled;

  return (
    <div className={fieldClassName}>
      <span className={labelClassName}>AI autofill</span>
      <div className={s.card} data-testid="ai-autofill-card">
        <div className={s.cardHeader}>
          <Icon icon="askAi" size={16} className={s.cardIcon} />
          <span style={{ flex: 1 }}>Set up AI autofill</span>
          <Switch
            aria-label="Set up AI autofill"
            isSelected={value.enabled}
            isDisabled={switchDisabled}
            onChange={(enabled) =>
              set({ enabled, type: types.includes(value.type) ? value.type : (types.find(available) ?? value.type) })
            }
          />
        </div>
        {configured === false && (
          <div className={s.notice}>AI is not configured for this workspace: values can't be generated yet.</div>
        )}
        {value.enabled && (
          <div className={s.cardBody}>
            <div className={s.field}>
              <span className={s.label}>Autofill type</span>
              <MenuTrigger>
                <AriaButton className={s.typeButton} aria-label="Autofill type">
                  <Icon icon={info.icon} size={16} className={s.cardIcon} />
                  <span className={s.typeLabel}>{info.label}</span>
                  <Icon icon="chevronDown" size={16} className={s.cardIcon} />
                </AriaButton>
                <Menu
                  aria-label="Autofill types"
                  width="trigger"
                  selectionMode="single"
                  selectedKeys={[value.type]}
                  disabledKeys={types.filter((t) => !available(t))}
                  onAction={(k) => set({ type: k as AiAutofillType })}
                >
                  {types.map((t) => (
                    <MenuItem
                      key={t}
                      id={t}
                      icon={AUTOFILL_TYPES[t].icon}
                      textValue={AUTOFILL_TYPES[t].label}
                      description={
                        AUTOFILL_TYPES[t].available
                          ? AUTOFILL_TYPES[t].description
                          : `${AUTOFILL_TYPES[t].description} (not available yet)`
                      }
                    >
                      {AUTOFILL_TYPES[t].label}
                    </MenuItem>
                  ))}
                </Menu>
              </MenuTrigger>
            </div>
            <PromptField
              key={value.type}
              workspace={workspace}
              entityDefinitionId={entityDefinitionId}
              attributeId={attributeId}
              label={info.promptLabel}
              placeholder={info.placeholder}
              helper={info.helper}
              error={error}
              value={value}
              onChange={(prompt) => set({ prompt })}
            />
            {value.type === 'classify-record' && (
              <div className={s.switchRow}>
                <span>Allow AI to generate new options</span>
                <Switch
                  aria-label="Allow AI to generate new options"
                  isSelected={value.allowNewOptions}
                  onChange={(allowNewOptions) => set({ allowNewOptions })}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const available = (t: AiAutofillType) => AUTOFILL_TYPES[t].available;

function PromptField({
  workspace,
  entityDefinitionId,
  attributeId,
  label,
  placeholder,
  helper,
  error,
  value,
  onChange,
}: {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  attributeId: string | null;
  label: string;
  placeholder: string;
  helper: string;
  error: string | null;
  value: AiAutofillState;
  onChange: (prompt: AiAutofillState['prompt']) => void;
}) {
  const editor = useRef<CodeEditorHandle>(null);
  const initial = useMemo(() => promptToDoc(value.prompt), []);
  const last = useRef(JSON.stringify(value.prompt ?? null));
  const refs = useReferences(workspace, entityDefinitionId, {
    excludeAttributeId: attributeId,
    tokens: initial.tokens.values(),
  });
  return (
    <div className={s.field}>
      <span className={s.label}>{label}</span>
      <div className={s.promptBox}>
        <CodeEditor
          ref={editor}
          mode="prompt"
          className={s.promptEditor}
          initial={initial}
          resolveChip={refs.resolveChip}
          attributeOptions={refs.attributeOptions}
          popups
          placeholder={placeholder}
          ariaLabel={label}
          onChange={(u) => {
            const next = docToPrompt(u.doc);
            const key = JSON.stringify(next);
            if (key === last.current) return;
            last.current = key;
            onChange(next);
          }}
        />
        <div className={s.promptFooter}>
          <Button
            variant="ghost"
            size={20}
            icon="variable"
            onPress={() => editor.current?.startVariable()}
            aria-label="Use variable"
          >
            Use variable
          </Button>
        </div>
      </div>
      {error ? <span className={s.error}>{error}</span> : <span className={s.helper}>{helper}</span>}
    </div>
  );
}
