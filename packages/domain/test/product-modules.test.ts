import { recordFollowUpProductModule } from '@agentic-crm/contracts/product-modules';
import { describe, expect, it } from 'vitest';
import {
  compileProductModuleRegistry,
  DuplicateProductModuleError,
  productModuleRegistry,
  UnknownProductModuleError,
} from '../src/modules/registry.ts';

describe('product module registry', () => {
  it('resolves the built-in module by requested id', () => {
    expect(productModuleRegistry.resolveRequested(['record-follow-up'])).toEqual([recordFollowUpProductModule]);
    expect(productModuleRegistry.get('record-follow-up')).toEqual(recordFollowUpProductModule);
  });

  it('rejects duplicate declaration ids when compiling', () => {
    expect(() => compileProductModuleRegistry([recordFollowUpProductModule, recordFollowUpProductModule])).toThrow(
      DuplicateProductModuleError,
    );
  });

  it('rejects requested module ids absent from the compiled registry', () => {
    expect(() => productModuleRegistry.resolveRequested(['not-installed'])).toThrow(UnknownProductModuleError);
  });
});
