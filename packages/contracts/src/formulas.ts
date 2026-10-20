// Slice 10: formula attributes (I-ai-calls/formulas.md) and AI autofill attributes (ai-attributes.md). Stored
// formulas are plaintext with one `_` per reference plus annotations pointing at those placeholders (§1.6).
import { z } from 'zod';
import { actorSchema, idOrSlugSchema, pathSchema, timestampSchema, uuidSchema } from './common.ts';

const annotationBase = { startPosition: z.number().int().min(0), length: z.literal(1).default(1) };

export const formulaAnnotationSchema = z.discriminatedUnion('type', [
  z.object({
    ...annotationBase,
    type: z.literal('entity-variable'),
    path: pathSchema,
    field: z.string().max(64).nullable().default(null),
    fallbackValue: z.string().nullable().optional(),
  }),
  z.object({
    ...annotationBase,
    type: z.literal('select-option'),
    entityDefinitionId: uuidSchema,
    attributeDefinitionId: uuidSchema,
    selectOptionId: uuidSchema,
  }),
  z.object({
    ...annotationBase,
    type: z.literal('pipeline-stage'),
    entityDefinitionId: uuidSchema,
    attributeDefinitionId: uuidSchema,
    pipelineStageId: uuidSchema,
  }),
  z.object({
    ...annotationBase,
    type: z.literal('actor-reference'),
    referencedActorType: z.string().max(64),
    referencedActorId: z.string().max(128),
  }),
]);
export type FormulaAnnotationInput = z.input<typeof formulaAnnotationSchema>;

export const formulaSourceSchema = z.object({
  plaintext: z.string().max(20_000),
  annotations: z.array(formulaAnnotationSchema).max(500).default([]),
});
export type FormulaSourceInput = z.input<typeof formulaSourceSchema>;

/** The 8 explicit output types of the "Output" menu (null = Auto). */
export const formulaOutputOverrides = [
  'text',
  'number',
  'checkbox',
  'date',
  'timestamp',
  'rating',
  'currency',
  'phone-number',
] as const;
export const formulaOutputOverrideSchema = z.enum(formulaOutputOverrides);

/** Write shape on attribute create / update (a new snapshot id per save). */
export const formulaConfigurationInputSchema = formulaSourceSchema.extend({
  snapshotId: uuidSchema,
  outputTypeOverride: formulaOutputOverrideSchema.nullable().default(null),
});
export type FormulaConfigurationInput = z.input<typeof formulaConfigurationInputSchema>;

/** Read shape on the attribute definition. */
export const formulaConfigurationSchema = z.object({
  activeSnapshotId: uuidSchema,
  activeSnapshotCreatedAt: timestampSchema,
});
export type FormulaConfiguration = z.infer<typeof formulaConfigurationSchema>;

export const aiAutofillTypes = ['research-web', 'classify-record', 'summarize-record', 'prompt-completion'] as const;
export const aiAutofillTypeSchema = z.enum(aiAutofillTypes);
export type AiAutofillType = z.infer<typeof aiAutofillTypeSchema>;

/** Prompt with variables (attribute paths) at `_` placeholders, like formula annotations. */
export const aiAutofillPromptSchema = z.object({
  plaintext: z.string().max(10_000),
  variables: z
    .array(z.object({ startPosition: z.number().int().min(0), path: pathSchema }))
    .max(100)
    .default([]),
});
export type AiAutofillPrompt = z.infer<typeof aiAutofillPromptSchema>;

export const aiAutofillConfigurationInputSchema = z.object({
  isEnabled: z.boolean().default(true),
  type: aiAutofillTypeSchema,
  prompt: aiAutofillPromptSchema.nullable().default(null),
  isOptionCreationEnabled: z.boolean().default(false),
});
export type AiAutofillConfigurationInput = z.input<typeof aiAutofillConfigurationInputSchema>;

export const aiAutofillConfigurationSchema = z.object({
  isEnabled: z.boolean(),
  type: aiAutofillTypeSchema,
  prompt: aiAutofillPromptSchema.nullable(),
  isOptionCreationEnabled: z.boolean(),
  /** Credits per generated value (1, or 10 for the web agent). */
  creditsPerValue: z.number().int(),
});
export type AiAutofillConfiguration = z.infer<typeof aiAutofillConfigurationSchema>;

// ---------------------------------------------------------------------------------------------------------------
// formulas.*

export const formulaDiagnosticSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.literal('error'),
  /** Plaintext offsets (each reference placeholder is one character). */
  from: z.number().int(),
  to: z.number().int(),
  line: z.number().int(),
  column: z.number().int(),
  endLine: z.number().int(),
  endColumn: z.number().int(),
  fix: z
    .object({
      label: z.string(),
      edits: z.array(z.object({ from: z.number().int(), to: z.number().int(), insert: z.string() })),
    })
    .optional(),
});
export type FormulaDiagnostic = z.infer<typeof formulaDiagnosticSchema>;

export const validateFormulaInputSchema = formulaSourceSchema.extend({
  entityDefinitionId: idOrSlugSchema,
  outputTypeOverride: formulaOutputOverrideSchema.nullable().default(null),
  /** The formula attribute being edited: also checks circularity and chain depth. */
  attributeDefinitionId: idOrSlugSchema.optional(),
});
export type ValidateFormulaInput = z.input<typeof validateFormulaInputSchema>;

export const validateFormulaOutputSchema = z.object({
  valid: z.boolean(),
  empty: z.boolean(),
  diagnostics: z.array(formulaDiagnosticSchema),
  /** Helper header summary: the single message or "Multiple errors (n)". */
  summary: z.string().nullable(),
  /** Readable checked type ("number", "text[]", "status attribute"). */
  resultType: z.string().nullable(),
  /** "Auto" output type (null = none). */
  inferredOutputType: z.string().nullable(),
  /** Attribute type the formula would be saved as. */
  outputType: z.string(),
  /** FORMULA_EMPTY, FORMULA_HAS_ERRORS, FORMULA_CIRCULAR_REFERENCE, FORMULA_MAX_DEPTH_EXCEEDED. */
  saveError: z.string().nullable(),
  usesNow: z.boolean(),
});
export type ValidateFormulaOutput = z.infer<typeof validateFormulaOutputSchema>;

export const previewFormulaInputSchema = validateFormulaInputSchema.extend({ entityInstanceId: uuidSchema });
export type PreviewFormulaInput = z.input<typeof previewFormulaInputSchema>;

export const previewFormulaOutputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('complete'),
    /** Value in the write form of `outputType` (null = no value). */
    value: z.unknown(),
    outputType: z.string(),
    /** Text for the preview ("No value" when null). */
    display: z.string().nullable(),
    accurateAt: timestampSchema,
  }),
  z.object({
    type: z.literal('syntax_error'),
    diagnostics: z.array(formulaDiagnosticSchema),
    accurateAt: timestampSchema,
  }),
  z.object({
    type: z.literal('evaluation_error'),
    code: z.string(),
    message: z.string(),
    accurateAt: timestampSchema,
  }),
]);
export type PreviewFormulaOutput = z.infer<typeof previewFormulaOutputSchema>;

export const formulaGenerationTypes = ['generate', 'refine', 'fix'] as const;

export const createFormulaGenerationInputSchema = z.object({
  /** Client-minted request id (PUT semantics). */
  id: uuidSchema,
  entityDefinitionId: idOrSlugSchema,
  prompt: z.string().max(4000).nullable().default(null),
  selectionStartFrom: z.number().int().min(0).nullable().default(null),
  selectionStartTo: z.number().int().min(0).nullable().default(null),
  inputFormulaDraft: formulaSourceSchema.nullable().default(null),
});
export type CreateFormulaGenerationInput = z.input<typeof createFormulaGenerationInputSchema>;

export const formulaGenerationRequestSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  entityDefinitionId: uuidSchema,
  type: z.enum(formulaGenerationTypes),
  status: z.enum(['queued', 'generating', 'completed', 'failed']),
  outputPlaintext: z.string().nullable(),
  outputAnnotations: z.array(z.unknown()).nullable(),
  refusalMessage: z.string().nullable(),
  refusalCategory: z.string().nullable(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type FormulaGenerationRequest = z.infer<typeof formulaGenerationRequestSchema>;

export const formulaSnapshotSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  entityDefinitionId: uuidSchema,
  attributeDefinitionId: uuidSchema,
  grammarVersion: z.string(),
  plaintext: z.string(),
  annotations: z.array(z.unknown()),
  outputTypeOverride: z.string().nullable(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
});
export type FormulaSnapshot = z.infer<typeof formulaSnapshotSchema>;

export const attributeRefInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  attributeDefinitionId: idOrSlugSchema,
});

export const entityAnnotationsInputSchema = attributeRefInputSchema.extend({
  entityInstanceIds: z.array(uuidSchema).min(1).max(1000),
});
export type EntityAnnotationsInput = z.input<typeof entityAnnotationsInputSchema>;

export const entityAnnotationSchema = z.object({
  entityInstanceId: uuidSchema,
  formula: z
    .object({
      /** pending | complete | error; null = never evaluated (calculating). */
      lastExecutionStatus: z.enum(['pending', 'complete', 'error']).nullable(),
      lastExecutionStatusChangedAt: timestampSchema.nullable(),
      lastExecutionError: z.string().nullable(),
      lastExecutionErrorPublicMessage: z.string().nullable(),
      /** Derived cell state (§5.3). */
      state: z.enum(['calculating', 'errored', 'value']),
    })
    .nullable(),
  aiAutofill: z
    .object({
      status: z.enum(['queued', 'running', 'complete', 'error']).nullable(),
      statusChangedAt: timestampSchema.nullable(),
      error: z.string().nullable(),
      basisReasoning: z.string().nullable(),
      /** "AI is thinking..." while queued or running. */
      thinking: z.boolean(),
    })
    .nullable(),
});
export type EntityAnnotation = z.infer<typeof entityAnnotationSchema>;

// ---------------------------------------------------------------------------------------------------------------
// aiAttributes.*

export const aiRunTargetSchema = z.discriminatedUnion('type', [
  /** One value (record page) or explicit records. */
  z.object({ type: z.literal('records'), entityInstanceIds: z.array(uuidSchema).min(1).max(5000) }),
  /** A cell selection over a view snapshot ("Recalculate with AI"). */
  z.object({
    type: z.literal('selection'),
    snapshotId: uuidSchema,
    zebraEdges: z.array(z.number().int().min(0)).max(20_000),
  }),
  /** Every record of the view (column header "Run AI autofill"). */
  z.object({ type: z.literal('column'), snapshotId: uuidSchema }),
]);
export type AiRunTarget = z.infer<typeof aiRunTargetSchema>;

export const aiRunInputSchema = attributeRefInputSchema.extend({ target: aiRunTargetSchema });
export type AiRunInput = z.input<typeof aiRunInputSchema>;

/** Data of the "Recalculate values" confirmation dialog. */
export const aiRunEstimateSchema = z.object({
  recordCount: z.number().int(),
  creditsPerValue: z.number().int(),
  credits: z.number().int(),
  /** Remaining workspace budget (null = no budget configured). */
  creditsRemaining: z.number().int().nullable(),
});
export type AiRunEstimate = z.infer<typeof aiRunEstimateSchema>;

export const aiRunResultSchema = aiRunEstimateSchema.extend({
  runId: uuidSchema,
  annotations: z.record(z.string(), entityAnnotationSchema),
});
export type AiRunResult = z.infer<typeof aiRunResultSchema>;
