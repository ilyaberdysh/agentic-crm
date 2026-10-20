import {
  type ProductModule,
  productModuleSchema,
  recordFollowUpProductModule,
} from '@agentic-crm/contracts/product-modules';

export class DuplicateProductModuleError extends Error {
  constructor(readonly moduleId: string) {
    super(`Duplicate product module id: ${moduleId}`);
    this.name = 'DuplicateProductModuleError';
  }
}

export class UnknownProductModuleError extends Error {
  constructor(readonly moduleId: string) {
    super(`Unknown product module: ${moduleId}`);
    this.name = 'UnknownProductModuleError';
  }
}

export interface ProductModuleRegistry {
  get(moduleId: string): ProductModule | undefined;
  resolveRequested(moduleIds: readonly string[]): readonly ProductModule[];
}

/** Validate and compile a fixed set of declarations into an ID-indexed registry. */
export function compileProductModuleRegistry(declarations: readonly ProductModule[]): ProductModuleRegistry {
  const modules = new Map<string, ProductModule>();

  for (const declaration of declarations) {
    const module = productModuleSchema.parse(declaration);
    if (modules.has(module.id)) throw new DuplicateProductModuleError(module.id);
    modules.set(module.id, Object.freeze(module));
  }

  return Object.freeze({
    get(moduleId: string) {
      return modules.get(moduleId);
    },
    resolveRequested(moduleIds: readonly string[]) {
      return moduleIds.map((moduleId) => {
        const module = modules.get(moduleId);
        if (!module) throw new UnknownProductModuleError(moduleId);
        return module;
      });
    },
  });
}

/** The statically compiled set of built-in modules available to this core build. */
export const productModuleRegistry = compileProductModuleRegistry([recordFollowUpProductModule]);
