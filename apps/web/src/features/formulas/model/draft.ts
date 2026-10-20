// The formula a dialog holds (formulas.md §4.1, §5.1): what the sheet's Save hands back, how an existing attribute's
// active snapshot becomes one, and the write shape (`formulaConfiguration` with a new snapshot id per save).
import type { AttributeDefinition, FormulaConfigurationInput, FormulaSnapshot } from '@agentic-crm/contracts';
import {
  type FormulaAnnotation,
  type FormulaSource,
  OUTPUT_OVERRIDES,
  type OutputKind,
  type OutputOverride,
} from '@agentic-crm/formula';
import { sameSource, wireSource } from './source';

export interface FormulaDraft {
  source: FormulaSource;
  outputTypeOverride: OutputOverride | null;
  /** The attribute type the formula saves as (override ?? inferred ?? text). */
  outputType: OutputKind;
}

const OVERRIDES: ReadonlySet<string> = new Set(OUTPUT_OVERRIDES);

export function formulaDraftOf(
  attribute: Pick<AttributeDefinition, 'type'>,
  snapshot: Pick<FormulaSnapshot, 'plaintext' | 'annotations' | 'outputTypeOverride'>,
): FormulaDraft {
  return {
    source: {
      plaintext: snapshot.plaintext,
      annotations: (snapshot.annotations as FormulaAnnotation[]).map((a) => ({ ...a, length: 1 })),
    },
    outputTypeOverride:
      snapshot.outputTypeOverride && OVERRIDES.has(snapshot.outputTypeOverride)
        ? (snapshot.outputTypeOverride as OutputOverride)
        : null,
    outputType: attribute.type as OutputKind,
  };
}

export function formulaConfigurationInput(draft: FormulaDraft, snapshotId: string): FormulaConfigurationInput {
  return { snapshotId, ...wireSource(draft.source), outputTypeOverride: draft.outputTypeOverride };
}

export function sameDraft(a: FormulaDraft | null, b: FormulaDraft | null): boolean {
  if (!a || !b) return a === b;
  return sameSource(a.source, b.source) && a.outputTypeOverride === b.outputTypeOverride;
}
