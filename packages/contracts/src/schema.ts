// Data model metadata: entity definitions (objects, list entries, tasks, members, interfaces), attribute
// definitions of the 17 internal types, select options and pipeline stages (A §4.3–4.6, attribute-types.md,
// J attribute-dialogs §7).
import { z } from 'zod';
import { actorSchema, idOrSlugSchema, pathSchema, rankSchema, timestampSchema, uuidSchema } from './common.ts';
import {
  aiAutofillConfigurationInputSchema,
  aiAutofillConfigurationSchema,
  formulaConfigurationInputSchema,
  formulaConfigurationSchema,
} from './formulas.ts';

export const entityTypes = [
  'person-record',
  'company-record',
  'standard-object',
  'custom-record',
  'collection-entry',
  'task',
  'workspace-member',
  'interface',
] as const;
export const entityTypeSchema = z.enum(entityTypes);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const standardObjectTypeSchema = z.enum(['deal', 'user', 'workspace']);

/** The 17 internal attribute types (attribute-types §1). Public renames: pipeline→status, entity-reference→record-reference. */
export const attributeTypes = [
  'text',
  'number',
  'checkbox',
  'currency',
  'date',
  'timestamp',
  'rating',
  'pipeline',
  'select',
  'entity-reference',
  'actor-reference',
  'location',
  'domain',
  'email-address',
  'phone-number',
  'interaction',
  'personal-name',
] as const;
export const attributeTypeSchema = z.enum(attributeTypes);
export type AttributeType = z.infer<typeof attributeTypeSchema>;

/** Types that may hold several values (multi-select, Record/User "Multiple values", phone; system domains/emails). */
export const multiValueTypes: ReadonlySet<AttributeType> = new Set([
  'select',
  'entity-reference',
  'actor-reference',
  'phone-number',
  'domain',
  'email-address',
]);
/** Types created with is_historic = true (attribute-types §2). */
export const historicByDefaultTypes: ReadonlySet<AttributeType> = new Set(['pipeline', 'currency']);

// biome-ignore format: compact table
export const currencyCodes = [
  'ARS', 'AUD', 'BRL', 'BGN', 'CAD', 'CLP', 'CNY', 'COP', 'CZK', 'DKK', 'EGP', 'EUR', 'HKD', 'HUF', 'ISK', 'INR',
  'IDR', 'ILS', 'JPY', 'KES', 'KRW', 'MYR', 'MXN', 'MAD', 'NZD', 'NGN', 'NOK', 'PKR', 'PEN', 'PHP', 'PLN', 'GBP',
  'RON', 'RUB', 'SAR', 'SGD', 'ZAR', 'SEK', 'CHF', 'TWD', 'THB', 'TRY', 'UAH', 'AED', 'USD', 'VND', 'KZT',
] as const;
export const currencyCodeSchema = z.enum(currencyCodes);

export const numberConfigurationSchema = z.object({
  defaultDecimalPlaces: z.number().int().min(0).max(4).nullable().default(null),
  defaultGroups: z.enum(['default', 'no-groups']).default('default'),
});
export const currencyConfigurationSchema = z.object({
  defaultCurrencyCode: currencyCodeSchema.default('USD'),
  defaultDisplayType: z.enum(['code', 'name', 'narrowSymbol', 'symbol']).default('symbol'),
  defaultDecimalPlaces: z.enum(['two-decimals', 'no-decimals']).default('two-decimals'),
  defaultGroups: z.enum(['default', 'no-groups']).default('default'),
});
export const entityReferenceConfigurationSchema = z.object({
  /** null = any object. */
  allowedEntityDefinitionIds: z.array(uuidSchema).nullable().default(null),
});
export const attributeConfigSchema = z.object({
  numberConfiguration: numberConfigurationSchema.optional(),
  currencyConfiguration: currencyConfigurationSchema.optional(),
  entityReferenceConfiguration: entityReferenceConfigurationSchema.optional(),
});
export type AttributeConfig = z.infer<typeof attributeConfigSchema>;

/** Internal default-value encoding (A §4.6): dynamic ISO-8601 duration / 'current-user', or static JSON array of values. */
export const defaultValueSchema = z.object({ type: z.enum(['static', 'dynamic']), identifier: z.string() });
export type DefaultValue = z.infer<typeof defaultValueSchema>;

// biome-ignore format: compact table
export const optionColors = [
  'pastel_blue', 'pastel_brown', 'pastel_green', 'pastel_grey', 'pastel_light-green', 'pastel_magenta',
  'pastel_orange', 'pastel_purple', 'pastel_red', 'pastel_teal', 'pastel_violet', 'pastel_yellow',
] as const;
// biome-ignore format: compact table
export const stageColors = [
  'block_blue', 'block_brown', 'block_green', 'block_grey', 'block_light-green', 'block_light-grey', 'block_magenta',
  'block_orange', 'block_purple', 'block_red', 'block_teal', 'block_violet', 'block_yellow',
] as const;
export const lifecyclePhaseSchema = z.enum(['ACTIVE', 'WON', 'LOST']);
/** ISO-8601 duration, e.g. 'P14D' or 'PT0S' (negative allowed with a leading '-'). */
export const isoDurationSchema = z
  .string()
  .regex(
    /^-?P(?!$)(\d+(\.\d+)?Y)?(\d+(\.\d+)?M)?(\d+(\.\d+)?W)?(\d+(\.\d+)?D)?(T(?=\d)(\d+(\.\d+)?H)?(\d+(\.\d+)?M)?(\d+(\.\d+)?S)?)?$/,
  );

// ---------------------------------------------------------------------------------------------------------------
// Entity definitions

export const entityDefinitionSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  entityType: entityTypeSchema,
  standardObjectType: standardObjectTypeSchema.nullable(),
  entitySubType: z.string().nullable(),
  apiSlug: z.string(),
  singularNoun: z.string(),
  pluralNoun: z.string(),
  icon: z.string().nullable(),
  imagePath: pathSchema.nullable(),
  epithetPath: pathSchema.nullable(),
  interfaceIds: z.array(uuidSchema),
  sortOrder: z.string().nullable(),
  isArchived: z.boolean(),
  isSystem: z.boolean(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
});
export type EntityDefinition = z.infer<typeof entityDefinitionSchema>;

export const apiSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lower-case letters, digits and underscores, starting with a letter');

export const listEntityDefinitionsInputSchema = z.object({
  includeArchived: z.boolean().default(true),
  entityTypes: z.array(entityTypeSchema).optional(),
});
export type ListEntityDefinitionsInput = z.input<typeof listEntityDefinitionsInputSchema>;

/** Create a custom object (PUT with a client UUID; idempotent). */
export const createObjectInputSchema = z.object({
  id: uuidSchema,
  apiSlug: apiSlugSchema,
  singularNoun: z.string().trim().min(1).max(100),
  pluralNoun: z.string().trim().min(1).max(100),
  icon: z.string().max(100).nullable().optional(),
  sortOrder: rankSchema.optional(),
  /**
   * The "Workspace access" select of the create dialog (J permissions §5; default Read and write, X-06). The creator
   * (a member) also gets Full access.
   */
  workspaceAccess: z.enum(['full-access', 'read-write', 'read-only', 'no-access']).optional(),
});
export type CreateObjectInput = z.input<typeof createObjectInputSchema>;

export const updateObjectInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  apiSlug: apiSlugSchema.optional(),
  singularNoun: z.string().trim().min(1).max(100).optional(),
  pluralNoun: z.string().trim().min(1).max(100).optional(),
  icon: z.string().max(100).nullable().optional(),
  /** false on an archived standard object = activation (seeds its attributes and views on first use). */
  isArchived: z.boolean().optional(),
  imagePath: pathSchema.nullable().optional(),
  epithetPath: pathSchema.nullable().optional(),
  sortOrder: rankSchema.optional(),
});
export type UpdateObjectInput = z.input<typeof updateObjectInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Attribute definitions

export const relationshipRefSchema = z.object({
  relatedEntityDefinitionId: uuidSchema,
  relatedAttributeDefinitionId: uuidSchema,
});

export const attributeDefinitionSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  entityDefinitionId: uuidSchema,
  apiSlug: z.string(),
  title: z.string(),
  description: z.string(),
  type: attributeTypeSchema,
  isMultiselect: z.boolean(),
  isUnique: z.boolean(),
  isRequired: z.boolean(),
  isHistoric: z.boolean(),
  isArchived: z.boolean(),
  isSystem: z.boolean(),
  systemAttributeType: z.string().nullable(),
  isReadOnly: z.boolean(),
  isHidden: z.boolean(),
  config: attributeConfigSchema,
  defaultValue: defaultValueSchema.nullable(),
  relationship: relationshipRefSchema.nullable(),
  interfaceAttributeId: uuidSchema.nullable(),
  sortOrder: z.string(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  /** Slice 10: formula attributes (type = output type; values are read-only). */
  formulaConfiguration: formulaConfigurationSchema.nullable().optional(),
  /** Slice 10: AI autofill (summarize, classify, prompt completion). */
  aiAutofillConfiguration: aiAutofillConfigurationSchema.nullable().optional(),
});
export type AttributeDefinition = z.infer<typeof attributeDefinitionSchema>;

export const optionInputSchema = z.object({
  id: uuidSchema.optional(),
  title: z.string().trim().min(1).max(200),
  color: z.enum(optionColors).optional(),
  sortOrder: rankSchema.optional(),
});
export const stageInputSchema = z.object({
  id: uuidSchema.optional(),
  title: z.string().trim().min(1).max(200),
  color: z.enum(stageColors).optional(),
  sortOrder: rankSchema.optional(),
  lifecyclePhase: lifecyclePhaseSchema.default('ACTIVE'),
  targetTimeInStatus: isoDurationSchema.nullable().optional(),
  celebrationEnabled: z.boolean().default(false),
});

/** Create an attribute (PUT with a client UUID; idempotent). A relationship creates both sides in one call. */
export const createAttributeInputSchema = z.object({
  id: uuidSchema,
  entityDefinitionId: idOrSlugSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  type: attributeTypeSchema,
  /** Server-derived from the title when omitted (J attribute-dialogs §7). */
  apiSlug: apiSlugSchema.optional(),
  isMultiselect: z.boolean().default(false),
  isUnique: z.boolean().default(false),
  isRequired: z.boolean().default(false),
  /** Defaults to true for pipeline and currency. */
  isHistoric: z.boolean().optional(),
  sortOrder: rankSchema.optional(),
  numberConfiguration: numberConfigurationSchema.optional(),
  currencyConfiguration: currencyConfigurationSchema.optional(),
  entityReferenceConfiguration: entityReferenceConfigurationSchema.optional(),
  defaultValue: defaultValueSchema.nullable().optional(),
  /** Relationship: the other side, created on `entityDefinitionId` of the related object. */
  relationship: z
    .object({
      id: uuidSchema,
      entityDefinitionId: idOrSlugSchema,
      title: z.string().trim().min(1).max(200),
      apiSlug: apiSlugSchema.optional(),
      description: z.string().max(2000).default(''),
      isMultiselect: z.boolean().default(false),
      isRequired: z.boolean().default(false),
      sortOrder: rankSchema.optional(),
    })
    .optional(),
  /** Convenience: options for select attributes / stages for pipeline attributes, created in the same call. */
  options: z.array(optionInputSchema).max(500).optional(),
  stages: z.array(stageInputSchema).max(100).optional(),
  /** Formula attribute: `type` is replaced by the formula's output type. */
  formulaConfiguration: formulaConfigurationInputSchema.optional(),
  aiAutofillConfiguration: aiAutofillConfigurationInputSchema.optional(),
});
export type CreateAttributeInput = z.input<typeof createAttributeInputSchema>;

export const updateAttributeInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  attributeDefinitionId: idOrSlugSchema,
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  apiSlug: apiSlugSchema.optional(),
  isRequired: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  sortOrder: rankSchema.optional(),
  numberConfiguration: numberConfigurationSchema.optional(),
  currencyConfiguration: currencyConfigurationSchema.optional(),
  entityReferenceConfiguration: entityReferenceConfigurationSchema.optional(),
  defaultValue: defaultValueSchema.nullable().optional(),
  /** A new formula snapshot (formula attributes only). */
  formulaConfiguration: formulaConfigurationInputSchema.optional(),
  /** null turns AI autofill off. */
  aiAutofillConfiguration: aiAutofillConfigurationInputSchema.nullable().optional(),
});
export type UpdateAttributeInput = z.input<typeof updateAttributeInputSchema>;

export const listAttributesInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  includeArchived: z.boolean().default(true),
});
export type ListAttributesInput = z.input<typeof listAttributesInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Select options and pipeline stages

export const selectOptionSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  entityDefinitionId: uuidSchema,
  attributeDefinitionId: uuidSchema,
  title: z.string(),
  color: z.string(),
  sortOrder: z.string(),
  isArchived: z.boolean(),
  createdAt: timestampSchema,
});
export type SelectOption = z.infer<typeof selectOptionSchema>;

export const pipelineStageSchema = selectOptionSchema.extend({
  lifecyclePhase: lifecyclePhaseSchema,
  targetTimeInStatus: z.string().nullable(),
  celebrationEnabled: z.boolean(),
});
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

const attributeRef = { entityDefinitionId: idOrSlugSchema, attributeDefinitionId: idOrSlugSchema };

export const listOptionsInputSchema = z.object({ ...attributeRef, includeArchived: z.boolean().default(true) });
export type ListOptionsInput = z.input<typeof listOptionsInputSchema>;

export const createOptionInputSchema = z.object({ ...attributeRef, ...optionInputSchema.shape, id: uuidSchema });
export type CreateOptionInput = z.input<typeof createOptionInputSchema>;

export const updateOptionInputSchema = z.object({
  ...attributeRef,
  selectOptionId: uuidSchema,
  title: z.string().trim().min(1).max(200).optional(),
  color: z.enum(optionColors).optional(),
  sortOrder: rankSchema.optional(),
  isArchived: z.boolean().optional(),
});
export type UpdateOptionInput = z.input<typeof updateOptionInputSchema>;

export const createStageInputSchema = z.object({ ...attributeRef, ...stageInputSchema.shape, id: uuidSchema });
export type CreateStageInput = z.input<typeof createStageInputSchema>;

export const updateStageInputSchema = z.object({
  ...attributeRef,
  pipelineStageId: uuidSchema,
  title: z.string().trim().min(1).max(200).optional(),
  color: z.enum(stageColors).optional(),
  sortOrder: rankSchema.optional(),
  lifecyclePhase: lifecyclePhaseSchema.optional(),
  targetTimeInStatus: isoDurationSchema.nullable().optional(),
  celebrationEnabled: z.boolean().optional(),
  /** Stages are archived, never deleted (CROSS-DOMAIN X-08). */
  isArchived: z.boolean().optional(),
});
export type UpdateStageInput = z.input<typeof updateStageInputSchema>;

export const rebuildProjectionInputSchema = z.object({ entityDefinitionId: idOrSlugSchema });
export const projectionReportSchema = z.object({
  entityDefinitionId: uuidSchema,
  rows: z.number().int(),
  /** Rows that differ between the live projection and a rebuild from attribute_values (0 = in sync). */
  mismatchedRows: z.number().int(),
});
export type ProjectionReport = z.infer<typeof projectionReportSchema>;
