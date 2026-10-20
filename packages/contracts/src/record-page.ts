// Record page support (BACKLOG 3.07, 3.08, 3.11; specs D README §2.6, §3.10, §4.2; decision X-22) and the member's
// calendar preferences (X-09/X-10).
import { z } from 'zod';
import { acceptAfterSchema, idOrSlugSchema, timestampSchema, uuidSchema } from './common.ts';

/**
 * Where a record id leads (record page states, D §2.6): live, merged into another record (following merge chains to
 * the live record: "Go to record"), deleted (soft, X-22) or unknown.
 */
export const recordStateInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  entityInstanceId: uuidSchema,
  acceptAfter: acceptAfterSchema,
});
export type RecordStateInput = z.input<typeof recordStateInputSchema>;
export const recordStateOutputSchema = z.object({
  state: z.enum(['live', 'merged', 'deleted', 'not-found']),
  entityDefinitionId: uuidSchema.nullable(),
  entityInstanceId: uuidSchema,
  mergedAt: timestampSchema.nullable(),
  /** The live record the id was merged into (end of the chain), null if not merged or the target is gone. */
  mergedInto: z.object({ entityDefinitionId: uuidSchema, entityInstanceId: uuidSchema }).nullable(),
  deletedAt: timestampSchema.nullable(),
});
export type RecordStateOutput = z.infer<typeof recordStateOutputSchema>;

/** Counters of the merge cards (D §3.10) and record tab badges: lists, notes, open tasks, comments, files. */
export const relatedCountsInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  entityInstanceIds: z.array(uuidSchema).min(1).max(200),
  acceptAfter: acceptAfterSchema,
});
export type RelatedCountsInput = z.input<typeof relatedCountsInputSchema>;
export const relatedCountsSchema = z.object({
  lists: z.number().int(),
  notes: z.number().int(),
  tasks: z.number().int(),
  openTasks: z.number().int(),
  comments: z.number().int(),
  files: z.number().int(),
});
export type RelatedCounts = z.infer<typeof relatedCountsSchema>;
export const relatedCountsOutputSchema = z.object({ counts: z.record(z.string(), relatedCountsSchema) });
export type RelatedCountsOutput = z.infer<typeof relatedCountsOutputSchema>;

export const memberPreferencesSchema = z.object({
  memberId: uuidSchema,
  timeZone: z.string().nullable(),
  locale: z.string().nullable(),
  /** 0 = Sunday … 6 = Saturday; null = from the locale. */
  weekStartDay: z.number().int().min(0).max(6).nullable(),
  /** Effective week start: the preference, else derived from the locale, else Monday. */
  effectiveWeekStartDay: z.number().int().min(0).max(6),
});
export type MemberPreferences = z.infer<typeof memberPreferencesSchema>;

export const updateMemberPreferencesInputSchema = z.object({
  timeZone: z.string().min(1).max(64).nullable().optional(),
  locale: z.string().min(2).max(35).nullable().optional(),
  weekStartDay: z.number().int().min(0).max(6).nullable().optional(),
});
export type UpdateMemberPreferencesInput = z.input<typeof updateMemberPreferencesInputSchema>;
