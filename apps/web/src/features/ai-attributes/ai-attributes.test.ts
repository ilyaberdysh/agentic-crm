// AI autofill glue (BACKLOG 10.05): autofill types per attribute type, the configuration sent on save, the prompt ⇄
// editor document conversion, the "Recalculate values" copy and credit math, and value states from annotations.
import type { EntityAnnotation } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { OBJ_ID } from '../attributes/test/fixtures';
import { tokensIn } from '../formulas/model/source';
import {
  AUTOFILL_TYPES,
  aiConfigInput,
  aiErrorText,
  aiStateError,
  aiValueState,
  allowedAutofillTypes,
  creditsText,
  defaultAutofillType,
  docToPrompt,
  estimateCredits,
  exceedsBudget,
  formulaValueState,
  initialAiState,
  PICKER_SHORTCUTS,
  promptToDoc,
  recordsText,
  sameAiState,
} from './model';

const annotation = (
  ai: Partial<NonNullable<EntityAnnotation['aiAutofill']>> | null,
  formula?: EntityAnnotation['formula'],
) =>
  ({
    entityInstanceId: 'r',
    formula: formula ?? null,
    aiAutofill: ai
      ? { status: null, statusChangedAt: null, error: null, basisReasoning: null, thinking: false, ...ai }
      : null,
  }) as EntityAnnotation;

describe('autofill types', () => {
  it('allows and defaults per attribute type (J attribute-dialogs §3)', () => {
    expect(allowedAutofillTypes('text')).toEqual(['research-web', 'prompt-completion', 'summarize-record']);
    expect(allowedAutofillTypes('number')).toEqual(['research-web', 'prompt-completion']);
    expect(allowedAutofillTypes('multi-select')).toEqual(['classify-record']);
    expect(defaultAutofillType('text')).toBe('summarize-record');
    expect(defaultAutofillType('currency')).toBe('prompt-completion');
    expect(defaultAutofillType('select')).toBe('classify-record');
    expect(AUTOFILL_TYPES['research-web'].credits).toBe(10);
    expect(AUTOFILL_TYPES['research-web'].available).toBe(false);
    expect(PICKER_SHORTCUTS.find((s) => s.type === 'classify-record')?.base).toBe('multi-select');
  });

  it('sends the configuration only when switched on; prompt completion needs a prompt', () => {
    const off = initialAiState('text');
    expect(aiConfigInput(off)).toBeNull();
    const on = { ...off, enabled: true };
    expect(aiConfigInput(on)).toEqual({
      isEnabled: true,
      type: 'summarize-record',
      prompt: null,
      isOptionCreationEnabled: false,
    });
    const prompt = { ...on, type: 'prompt-completion' as const };
    expect(aiStateError(prompt)).toBe('Enter a prompt');
    expect(aiStateError({ ...prompt, prompt: { plaintext: 'Size of _', variables: [] } })).toBeNull();
    const classify = { ...on, type: 'classify-record' as const, allowNewOptions: true };
    expect(aiConfigInput(classify)?.isOptionCreationEnabled).toBe(true);
    expect(sameAiState(off, initialAiState('text'))).toBe(true);
    expect(sameAiState(off, on)).toBe(false);
  });

  it('round-trips a prompt with variables through the editor document', () => {
    const prompt = {
      plaintext: 'Estimate the size of _ from _',
      variables: [
        { startPosition: 21, path: [{ entityDefinitionId: OBJ_ID, attributeDefinitionId: 'a1' }] },
        { startPosition: 28, path: [{ entityDefinitionId: OBJ_ID, attributeDefinitionId: 'a2' }] },
      ],
    };
    const doc = promptToDoc(prompt);
    expect(tokensIn(doc.text)).toHaveLength(2);
    expect(docToPrompt(doc)).toEqual(prompt);
    expect(docToPrompt({ text: '   ', tokens: new Map() })).toBeNull();
    expect(promptToDoc(null).text).toBe('');
  });
});

describe('"Recalculate values" confirmation', () => {
  it('records × credits per value, singular / plural copy, budget check', () => {
    expect(estimateCredits(12, 1)).toBe(12);
    expect(estimateCredits(3, 10)).toBe(30);
    expect(estimateCredits(-1, 1)).toBe(0);
    expect(recordsText(1)).toBe('By confirming the recalculation, 1 record will be updated.');
    expect(recordsText(12)).toBe('By confirming the recalculation, 12 records will be updated.');
    expect(creditsText(1)).toBe('1 credit will be used');
    expect(creditsText(30)).toBe('30 credits will be used');
    expect(exceedsBudget(30, null)).toBe(false);
    expect(exceedsBudget(30, 29)).toBe(true);
    expect(exceedsBudget(30, 30)).toBe(false);
  });
});

describe('value states', () => {
  it('AI: thinking, error without a value, outdated (error over an earlier value), value', () => {
    expect(aiValueState(undefined, false)).toBe('value');
    expect(aiValueState(annotation({ status: 'queued', thinking: true }), true)).toBe('thinking');
    expect(aiValueState(annotation({ status: 'error', error: 'boom' }), false)).toBe('error');
    expect(aiValueState(annotation({ status: 'error', error: 'boom' }), true)).toBe('outdated');
    expect(aiValueState(annotation({ status: 'complete' }), true)).toBe('value');
    expect(aiErrorText(null)).toBe("Couldn't generate a value");
    expect(aiErrorText('AI_NOT_CONFIGURED')).toBe('AI is not configured for this workspace');
  });

  it('formula: calculating, errored, value', () => {
    const f = (state: 'calculating' | 'errored' | 'value') =>
      annotation(null, {
        lastExecutionStatus: null,
        lastExecutionStatusChangedAt: null,
        lastExecutionError: null,
        lastExecutionErrorPublicMessage: null,
        state,
      });
    expect(formulaValueState(f('calculating'))).toBe('calculating');
    expect(formulaValueState(f('errored'))).toBe('errored');
    expect(formulaValueState(undefined)).toBe('value');
  });
});
