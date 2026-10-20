import { describe, expect, it } from 'vitest';
import { productModuleSchema, recordFollowUpProductModule } from '../src/product-modules.ts';

describe('product module declarations', () => {
  it('provides the built-in record follow-up declaration', () => {
    expect(recordFollowUpProductModule).toEqual({
      id: 'record-follow-up',
      compatibleCore: { kind: 'marker', marker: 'agentic-core-v1' },
      recordSurfaceIds: ['record.agent'],
      uiSurfaceIds: ['record.agent.tab'],
      agentTaskTypes: ['record.follow_up'],
      executableCapabilityIds: ['crm.task.create'],
      connectorRequirements: [],
      migrationIds: [],
    });
    expect(productModuleSchema.parse(recordFollowUpProductModule)).toEqual(recordFollowUpProductModule);
  });

  it('rejects undeclared fields', () => {
    expect(() => productModuleSchema.parse({ ...recordFollowUpProductModule, hooks: [] })).toThrow();
  });
});
