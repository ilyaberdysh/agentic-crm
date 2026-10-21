// View export (BACKLOG 4.08; specs C2 export.md E1–E3, C1 README §3.8; procedure names:
// decisions/slice4-contracts.md). exports.create freezes the view's saved filter, sorts and columns (for a kanban
// view: the grouping attribute first, then the card attributes) and queues a worker job; the client polls
// exports.status (toast: Preparing → Collecting data {progress} → Building CSV file) and then fetches
// exports.downloadUrl (signed, 5 minutes) for "<Object> - <View>.csv".
//
// File layout: UTF-8 with BOM, RFC 4180 quoting, CRLF. Columns: "Record ID"
// (lists: "Entry ID", then the parent's "Record ID"), the record column (the record's display name), then the view
// columns with their labels. Values are formatted like the app's cells with ONE locale (X-11): numbers and currency
// with `locale`, dates as "Mar 1, 2026", timestamps as "Mar 1st 2026, 12:30pm" in `timeZone`; multiple values are
// joined with ", ".
import { z } from 'zod';
import { actorSchema, timestampSchema, uuidSchema } from './common.ts';

export const exportStatusSchema = z.enum(['pending', 'in-progress', 'complete', 'failed']);
export type ExportStatus = z.infer<typeof exportStatusSchema>;
/** `instance-count-zero` → "No records to export"; anything else → "Failed to export". */
export const exportFailureReasonSchema = z.enum(['instance-count-zero', 'unknown-error']);
export type ExportFailureReason = z.infer<typeof exportFailureReasonSchema>;

export const exportJobSchema = z.object({
  id: uuidSchema,
  entityDefinitionId: uuidSchema,
  viewId: uuidSchema,
  format: z.literal('csv'),
  /** Toast title "<List or object name> - <View title> Export". */
  title: z.string(),
  fileName: z.string(),
  status: exportStatusSchema,
  /** 0–100 while collecting rows. */
  progress: z.number().int(),
  failureReason: exportFailureReasonSchema.nullable(),
  rowCount: z.number().int().nullable(),
  locale: z.string(),
  timeZone: z.string(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;

export const createExportInputSchema = z.object({
  /** Client-minted (I3); replays return the existing export. */
  exportId: uuidSchema.optional(),
  viewId: uuidSchema,
  format: z.literal('csv').default('csv'),
  /** BCP 47 locale of the user (number and currency formatting); default: member preference, else en-US. */
  locale: z.string().min(2).max(35).optional(),
  /** IANA time zone of the user (timestamps); default: member preference, else UTC. */
  timeZone: z.string().min(1).max(64).optional(),
});
export type CreateExportInput = z.input<typeof createExportInputSchema>;
export const createExportOutputSchema = z.object({ exportId: uuidSchema, export: exportJobSchema });
export type CreateExportOutput = z.infer<typeof createExportOutputSchema>;

export const exportRefSchema = z.object({ exportId: uuidSchema });
export type ExportRef = z.input<typeof exportRefSchema>;

export const exportDownloadUrlOutputSchema = z.object({
  url: z.string(),
  expiresAt: timestampSchema,
  fileName: z.string(),
});
export type ExportDownloadUrlOutput = z.infer<typeof exportDownloadUrlOutputSchema>;
