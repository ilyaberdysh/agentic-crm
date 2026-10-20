// Attribute values (A §4.7, attribute-types §3 and §5). Value shapes are Attio's internal shapes with camelCase keys.
// Write forms are what clients send in `value`; read forms are what the server returns.
import { z } from 'zod';
import { actorSchema, actorTypeSchema, rankSchema, timestampSchema, uuidSchema } from './common.ts';
import { type AttributeType, attributeTypeSchema } from './schema.ts';

const locationShape = {
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  line3: z.string().nullable(),
  line4: z.string().nullable(),
  locality: z.string().nullable(),
  region: z.string().nullable(),
  postcode: z.string().nullable(),
  countryCode: z.string().nullable(),
  latitude: z.string().nullable(),
  longitude: z.string().nullable(),
};

/** Write form per type. */
export const valueInputSchemas = {
  text: z.string().max(100_000),
  number: z.number().finite(),
  checkbox: z.boolean(),
  currency: z.object({
    currencyValue: z.number().finite(),
    /** null = the attribute's default currency */
    currencyCode: z.string().length(3).nullable().optional(),
  }),
  /** 'YYYY-MM-DD' (a full ISO timestamp is accepted and truncated to its UTC date). */
  date: z.union([z.iso.date(), timestampSchema]),
  timestamp: timestampSchema,
  rating: z.number().int().min(0).max(5),
  pipeline: z.object({ pipelineStageId: uuidSchema }),
  select: z.object({ selectOptionId: uuidSchema }),
  'entity-reference': z.object({
    entityDefinitionId: uuidSchema.optional(),
    entityInstanceId: uuidSchema,
  }),
  'actor-reference': z.object({ referencedActorType: actorTypeSchema, referencedActorId: uuidSchema }),
  location: z.object(locationShape).partial(),
  domain: z.union([z.string(), z.object({ domain: z.string() })]),
  'email-address': z.union([z.string(), z.object({ emailAddress: z.string() })]),
  'phone-number': z.union([
    z.string(),
    z.object({ originalPhoneNumber: z.string(), countryCode: z.string().length(2).nullable().optional() }),
  ]),
  interaction: z.object({
    interactionHeaderId: uuidSchema.nullable().optional(),
    interactionType: z.string(),
    interactedAt: timestampSchema,
    ownerMembershipId: uuidSchema.nullable().optional(),
    mailboxId: uuidSchema.nullable().optional(),
  }),
  'personal-name': z.object({
    firstName: z.string().max(500).optional(),
    lastName: z.string().max(500).optional(),
    fullName: z.string().max(1000).optional(),
  }),
} satisfies Record<AttributeType, z.ZodType>;

/** Read form per type. */
export const valueOutputSchemas = {
  text: z.string(),
  number: z.number(),
  checkbox: z.boolean(),
  currency: z.object({ currencyValue: z.number(), currencyCode: z.string().nullable() }),
  date: z.iso.date(),
  timestamp: timestampSchema,
  rating: z.number().int(),
  pipeline: z.object({ pipelineStageId: uuidSchema }),
  select: z.object({ selectOptionId: uuidSchema }),
  'entity-reference': z.object({ entityDefinitionId: uuidSchema, entityInstanceId: uuidSchema }),
  'actor-reference': z.object({ referencedActorType: actorTypeSchema, referencedActorId: uuidSchema }),
  location: z.object(locationShape),
  domain: z.object({ normalizedDomain: z.string(), rootDomain: z.string() }),
  'email-address': z.object({
    originalEmailAddress: z.string(),
    normalizedEmailAddress: z.string(),
    emailDomain: z.string(),
    emailRootDomain: z.string(),
    emailLocalSpecifier: z.string(),
  }),
  'phone-number': z.object({
    originalPhoneNumber: z.string(),
    countryCode: z.string().nullable(),
    normalizedPhoneNumber: z.string(),
  }),
  interaction: z.object({
    interactionHeaderId: uuidSchema.nullable(),
    interactionType: z.string(),
    interactedAt: timestampSchema,
    ownerMembershipId: uuidSchema.nullable(),
    mailboxId: uuidSchema.nullable(),
  }),
  'personal-name': z.object({ firstName: z.string(), lastName: z.string(), fullName: z.string() }),
} satisfies Record<AttributeType, z.ZodType>;

export type ValueOutput<T extends AttributeType> = z.infer<(typeof valueOutputSchemas)[T]>;

/** One value row as returned by reads (current or historic). */
export const attributeValueSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  entityDefinitionId: uuidSchema,
  entityInstanceId: uuidSchema,
  attributeDefinitionId: uuidSchema,
  attributeType: attributeTypeSchema,
  value: z.unknown(),
  activeFrom: timestampSchema,
  activeUntil: timestampSchema.nullable(),
  sortOrder: z.string().nullable(),
  createdBy: actorSchema,
  deactivatedBy: actorSchema.nullable(),
});
export type AttributeValue = z.infer<typeof attributeValueSchema>;

/** One value in a write: optional client-minted value id, the write-form value, optional rank (multi-value). */
export const valueInputSchema = z.object({
  id: uuidSchema.optional(),
  value: z.unknown(),
  sortOrder: rankSchema.optional(),
});
export type ValueInput = z.infer<typeof valueInputSchema>;

/** `{<attribute id or api_slug>: ValueInput[]}`; an empty array clears the attribute. */
export const valuesMapSchema = z.record(z.string(), z.array(valueInputSchema).max(1000));
export type ValuesMap = z.infer<typeof valuesMapSchema>;
