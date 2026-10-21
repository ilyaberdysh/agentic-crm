import { type AiModelsOutput, aiTargetModelChoice, parseAiTargetModelChoice } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { defaultAskModel } from './modelChoice';

const target = aiTargetModelChoice('12345678-1234-4567-8901-123456789abc', 4);
const models: AiModelsOutput = {
  configured: true,
  models: [
    { id: 'claude-opus-5-5', label: 'Opus', brand: 'anthropic', isAuto: true, isUnavailable: true },
    { id: target, label: 'My model · Local', brand: 'openai-compatible', isAuto: false, isUnavailable: false },
  ],
};

describe('saved Ask model selection', () => {
  it('selects an available saved target when the server has no key', () => {
    expect(defaultAskModel(models)).toBe(target);
    expect(defaultAskModel(models, 'claude-opus-5-5')).toBe(target);
  });

  it('preserves a supported saved preference and otherwise uses configured Auto', () => {
    const configured = { ...models, models: models.models.map((m) => ({ ...m, isUnavailable: false })) };
    expect(defaultAskModel(configured)).toBe('auto');
    expect(defaultAskModel(configured, target)).toBe(target);
    expect(defaultAskModel({ configured: false, models: [] })).toBe('auto');
  });

  it('pins a UUID and safe positive version while rejecting malformed choices', () => {
    expect(parseAiTargetModelChoice(target)).toEqual({
      targetId: '12345678-1234-4567-8901-123456789abc',
      expectedVersion: 4,
    });
    for (const choice of [
      'target:bad:4',
      target.replace(':4', ':0'),
      target.replace(':4', ':1e2'),
      target.replace(':4', ':9007199254740992'),
      'auto',
    ])
      expect(parseAiTargetModelChoice(choice)).toBeNull();
  });
});
