// Record files and folders (BACKLOG 3.06; specs D README §3.9, §4.4; contract E5 in slice3-contracts.md).
// Upload is three-step: createUploadSession → PUT the bytes to `upload.url` → complete (accept).
import { z } from 'zod';
import { acceptAfterSchema, actorSchema, idOrSlugSchema, timestampSchema, uuidSchema } from './common.ts';

/** Largest file accepted (the public API documents 50 MB). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export const storageEntrySchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  entityDefinitionId: uuidSchema,
  entityInstanceId: uuidSchema,
  parentFolderId: uuidSchema.nullable(),
  rootEntryId: uuidSchema,
  entryType: z.enum(['file', 'folder']),
  storageProvider: z.literal('agentic-crm'),
  name: z.string(),
  contentType: z.string().nullable(),
  contentSize: z.number().int().nullable(),
  /** Folders only: whether the folder has live children. */
  hasChildren: z.boolean().nullable(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type StorageEntry = z.infer<typeof storageEntrySchema>;

const fileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((s) => !/[/\\\u0000]/.test(s), { message: 'Names cannot contain slashes' });

export const uploadSessionSchema = z.object({
  id: uuidSchema,
  entityDefinitionId: uuidSchema,
  entityInstanceId: uuidSchema,
  parentFolderId: uuidSchema.nullable(),
  filename: z.string(),
  contentType: z.string(),
  contentSize: z.number().int(),
  state: z.enum(['pending', 'accepted', 'failed']),
  error: z.string().nullable(),
  fileEntryId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
});
export type UploadSession = z.infer<typeof uploadSessionSchema>;

export const createUploadSessionInputSchema = z.object({
  /** Client-minted session id (I3); a replay returns the session with a fresh upload URL while it is pending. */
  id: uuidSchema,
  entityDefinitionId: idOrSlugSchema,
  entityInstanceId: uuidSchema,
  parentFolderId: uuidSchema.nullable().default(null),
  filename: fileName,
  contentType: z.string().min(1).max(255).default('application/octet-stream'),
  contentSize: z.number().int().min(0).max(MAX_FILE_BYTES),
});
export type CreateUploadSessionInput = z.input<typeof createUploadSessionInputSchema>;

export const createUploadSessionOutputSchema = z.object({
  session: uploadSessionSchema,
  /** Presigned S3 PUT: send the raw bytes with these headers before `expiresAt`. */
  upload: z.object({ url: z.url(), method: z.literal('PUT'), headers: z.record(z.string(), z.string()) }),
});
export type CreateUploadSessionOutput = z.infer<typeof createUploadSessionOutputSchema>;

/** Accept the uploaded object: verifies it exists with the declared size, then creates the file entry. */
export const completeUploadInputSchema = z.object({ sessionId: uuidSchema });
export type CompleteUploadInput = z.input<typeof completeUploadInputSchema>;
export const completeUploadOutputSchema = z.object({ session: uploadSessionSchema, entry: storageEntrySchema });
export type CompleteUploadOutput = z.infer<typeof completeUploadOutputSchema>;

/** Entries of one folder (null = the record's root entries), folders first, then by name. */
export const listFilesInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  entityInstanceId: uuidSchema,
  parentFolderId: uuidSchema.nullable().default(null),
  /** Every nesting level below the folder (flat). */
  recursive: z.boolean().default(false),
  acceptAfter: acceptAfterSchema,
});
export type ListFilesInput = z.input<typeof listFilesInputSchema>;
export const listFilesOutputSchema = z.object({ entries: z.array(storageEntrySchema) });
export type ListFilesOutput = z.infer<typeof listFilesOutputSchema>;

export const createFolderInputSchema = z.object({
  id: uuidSchema,
  entityDefinitionId: idOrSlugSchema,
  entityInstanceId: uuidSchema,
  parentFolderId: uuidSchema.nullable().default(null),
  name: fileName,
});
export type CreateFolderInput = z.input<typeof createFolderInputSchema>;

export const renameEntryInputSchema = z.object({ entryId: uuidSchema, name: fileName });
export type RenameEntryInput = z.input<typeof renameEntryInputSchema>;

/** Deleting a folder deletes everything inside it. */
export const entryIdInputSchema = z.object({ entryId: uuidSchema, acceptAfter: acceptAfterSchema });
export type EntryIdInput = z.input<typeof entryIdInputSchema>;

export const downloadUrlInputSchema = z.object({
  entryId: uuidSchema,
  disposition: z.enum(['attachment', 'inline']).default('attachment'),
});
export type DownloadUrlInput = z.input<typeof downloadUrlInputSchema>;
export const downloadUrlOutputSchema = z.object({ url: z.url(), expiresAt: timestampSchema });
export type DownloadUrlOutput = z.infer<typeof downloadUrlOutputSchema>;
