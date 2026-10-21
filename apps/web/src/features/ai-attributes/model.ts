// AI autofill, React-free so it is unit-tested: the autofill types (labels, descriptions,
// icons, credits per value, prompt copy), which types each attribute type allows and its default, the prompt ⇄
// editor document conversion (variables are `_` placeholders with attribute paths), the "Recalculate values" copy and
// credit math, and the display state of a value from its entity annotation.
import type { AiAutofillPrompt, AiAutofillType, EntityAnnotation } from '@agentic-crm/contracts';
import type { IconName } from '@agentic-crm/ui';
import { type EditorDoc, loadSource, storedSource } from '../formulas/model/source';

export interface AutofillTypeInfo {
  label: string;
  description: string;
  icon: IconName;
  /** Credits per generated value. */
  credits: number;
  promptLabel: string;
  placeholder: string;
  helper: string;
  promptRequired: boolean;
  /** Offered in this build (the web agent needs a web-research provider;  defer). */
  available: boolean;
}

export const AUTOFILL_TYPES: Record<AiAutofillType, AutofillTypeInfo> = {
  'research-web': {
    label: 'Web agent',
    description: 'Research details about a record using AI and advanced web research',
    icon: 'aiWeb',
    credits: 10,
    promptLabel: 'Prompt',
    placeholder: 'Describe what to research with AI',
    helper: 'AI will have access to all record attributes',
    promptRequired: true,
    available: false,
  },
  'prompt-completion': {
    label: 'Prompt completion',
    description: 'Generate text responses using a custom prompt you define',
    icon: 'aiPrompt',
    credits: 1,
    promptLabel: 'Prompt',
    placeholder: 'Generate an LLM completion for a provided prompt',
    helper: 'Use variables to specify which record attributes AI will have access to',
    promptRequired: true,
    available: true,
  },
  'summarize-record': {
    label: 'Summarize record',
    description: 'Creates a summary of the record based on existing attributes',
    icon: 'aiSummarize',
    credits: 1,
    promptLabel: 'Prompt (optional)',
    placeholder: 'Tell the AI what to generate from record details and attributes',
    helper: 'AI will have access to all record attributes',
    promptRequired: false,
    available: true,
  },
  'classify-record': {
    label: 'Classify record',
    description: 'Automatically tag records based on their attributes',
    icon: 'aiClassify',
    credits: 1,
    promptLabel: 'Prompt (optional)',
    placeholder: 'Tell the AI what to generate from record details and attributes',
    helper: 'AI will have access to all record attributes',
    promptRequired: false,
    available: true,
  },
};

/** Picker order (web agent, prompt completion, summarize record, classify record). */
export const AUTOFILL_ORDER: readonly AiAutofillType[] = [
  'research-web',
  'prompt-completion',
  'summarize-record',
  'classify-record',
];

/** The dialog's attribute kinds that can carry AI autofill (J attribute-dialogs). */
export type AiCapableType = 'text' | 'number' | 'currency' | 'select' | 'multi-select';

const ALLOWED: Record<AiCapableType, AiAutofillType[]> = {
  text: ['research-web', 'prompt-completion', 'summarize-record'],
  number: ['research-web', 'prompt-completion'],
  currency: ['research-web', 'prompt-completion'],
  select: ['classify-record'],
  'multi-select': ['classify-record'],
};

const DEFAULT: Record<AiCapableType, AiAutofillType> = {
  text: 'summarize-record',
  number: 'prompt-completion',
  currency: 'prompt-completion',
  select: 'classify-record',
  'multi-select': 'classify-record',
};

export function isAiCapable(type: string): type is AiCapableType {
  return type in ALLOWED;
}

/** Autofill types an attribute type allows (picker order). */
export function allowedAutofillTypes(type: AiCapableType): AiAutofillType[] {
  return AUTOFILL_ORDER.filter((t) => ALLOWED[type].includes(t));
}

export function defaultAutofillType(type: AiCapableType): AiAutofillType {
  return DEFAULT[type];
}

/** The type picker's "AI Autofill" shortcuts: Classify → Multi-select, the others → Text, with autofill switched on. */
export const PICKER_SHORTCUTS: readonly { type: AiAutofillType; base: 'text' | 'multi-select' }[] = [
  { type: 'classify-record', base: 'multi-select' },
  { type: 'prompt-completion', base: 'text' },
  { type: 'summarize-record', base: 'text' },
  { type: 'research-web', base: 'text' },
];

// ---- form state ----------------------------------------------------------------------------------------------------

export interface AiAutofillState {
  enabled: boolean;
  type: AiAutofillType;
  prompt: AiAutofillPrompt | null;
  allowNewOptions: boolean;
}

export function initialAiState(type: AiCapableType | null): AiAutofillState {
  return {
    enabled: false,
    type: type ? defaultAutofillType(type) : 'summarize-record',
    prompt: null,
    allowNewOptions: false,
  };
}

/** Prompt completion needs a prompt; the other types may go without. */
export function aiStateError(state: AiAutofillState): string | null {
  if (!state.enabled) return null;
  if (AUTOFILL_TYPES[state.type].promptRequired && !state.prompt?.plaintext.trim()) return 'Enter a prompt';
  return null;
}

/** The configuration sent on create / update (null = AI autofill off). */
export function aiConfigInput(state: AiAutofillState) {
  if (!state.enabled) return null;
  return {
    isEnabled: true,
    type: state.type,
    prompt: state.prompt?.plaintext.trim() ? state.prompt : null,
    isOptionCreationEnabled: state.type === 'classify-record' && state.allowNewOptions,
  };
}

export function sameAiState(a: AiAutofillState, b: AiAutofillState): boolean {
  return JSON.stringify(aiConfigInput(a)) === JSON.stringify(aiConfigInput(b));
}

// ---- prompt ⇄ editor -------------------------------------------------------------------------------------------------

export function promptToDoc(prompt: AiAutofillPrompt | null | undefined): EditorDoc {
  if (!prompt) return { text: '', tokens: new Map() };
  return loadSource({
    plaintext: prompt.plaintext,
    annotations: prompt.variables.map((v) => ({
      type: 'entity-variable' as const,
      startPosition: v.startPosition,
      length: 1,
      path: v.path,
      field: null,
    })),
  });
}

export function docToPrompt(doc: EditorDoc): AiAutofillPrompt | null {
  const source = storedSource(doc.text, doc.tokens);
  if (!source.plaintext.trim()) return null;
  return {
    plaintext: source.plaintext,
    variables: source.annotations
      .filter((a) => a.type === 'entity-variable')
      .map((a) => ({ startPosition: a.startPosition, path: a.type === 'entity-variable' ? a.path : [] })),
  };
}

// ---- "Recalculate values" ---------------------------------------------------------------------------------------------

export function estimateCredits(recordCount: number, creditsPerValue: number): number {
  return Math.max(0, recordCount) * Math.max(0, creditsPerValue);
}

export function recordsText(recordCount: number): string {
  return `By confirming the recalculation, ${recordCount} ${recordCount === 1 ? 'record' : 'records'} will be updated.`;
}

export function creditsText(credits: number): string {
  return `${credits} ${credits === 1 ? 'credit' : 'credits'} will be used`;
}

/** The run would exceed the workspace budget (null remaining = no budget). */
export function exceedsBudget(credits: number, remaining: number | null): boolean {
  return remaining !== null && credits > remaining;
}

// ---- value state -------------------------------------------------------------------------------------------------------

/**
 * thinking: queued or running ("AI is thinking..."); error: the last run failed and there is no value; outdated: the
 * last run failed, so the shown value comes from an earlier run; value: anything else (generated or edited).
 */
export type AiValueState = 'thinking' | 'error' | 'outdated' | 'value';

export function aiValueState(annotation: EntityAnnotation | undefined, hasValue: boolean): AiValueState {
  const ai = annotation?.aiAutofill;
  if (!ai) return 'value';
  if (ai.thinking) return 'thinking';
  if (ai.status === 'error') return hasValue ? 'outdated' : 'error';
  return 'value';
}

/** Human text of an AI run error code. */
export function aiErrorText(error: string | null | undefined): string {
  if (!error) return "Couldn't generate a value";
  if (error === 'AI_NOT_CONFIGURED') return 'AI is not configured for this workspace';
  if (error === 'CREDITS_EXHAUSTED') return 'Not enough credits left';
  return error.length > 200 ? `${error.slice(0, 200)}…` : error;
}

export type FormulaValueState = 'calculating' | 'errored' | 'value';

export function formulaValueState(annotation: EntityAnnotation | undefined): FormulaValueState {
  return annotation?.formula?.state ?? 'value';
}
