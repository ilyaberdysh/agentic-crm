// Slice-3 services wired for createDomain(): notes, note templates, tasks, comments, favorites, files, record page
// layouts, timeline, record page states and member preferences. Every method is one workspace transaction (I1) —
// except files.complete, which HEADs the uploaded object between its read and its write transaction.
import { config } from '@agentic-crm/config';
import type {
  AddReactionInput,
  ApplyNoteTemplateInput,
  BatchGetNotesInput,
  BulkSetTasksCompletedInput,
  CommentCountsInput,
  CountDueTasksInput,
  CreateCommentInput,
  CreateFolderInput,
  CreateNoteInput,
  CreateNoteTemplateInput,
  CreateTaskInput,
  CreateTemplateFromNoteInput,
  CreateUploadSessionInput,
  DownloadUrlInput,
  GetLayoutInput,
  ListFilesInput,
  ListNotesInput,
  ListNoteTemplatesInput,
  ListTasksInput,
  ListThreadsInput,
  ListTimelineInput,
  MoveFavoriteInput,
  PutFavoriteDirectoryInput,
  PutFavoriteInput,
  RecordRefInput,
  RecordStateInput,
  RelatedCountsInput,
  RemoveFavoriteByTargetInput,
  RemoveReactionInput,
  RenameEntryInput,
  ResolveCommentInput,
  SaveLayoutInput,
  SetTaskCompletedInput,
  StorageEntry,
  UpdateFavoriteDirectoryInput,
  UpdateMemberPreferencesInput,
  UpdateNoteInput,
  UpdateNoteTemplateInput,
  UpdateTaskInput,
} from '@agentic-crm/contracts';
import { completeUploadInputSchema } from '@agentic-crm/contracts';
import type { Database } from '@agentic-crm/db';
import type { ServiceContext } from '../context.ts';
import { notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Policies } from '../permissions.ts';
import { type ObjectStorage, S3Storage } from '../storage/s3.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { type CommentWriteOptions, commentOps } from './comments.ts';
import type { CollabDeps } from './common.ts';
import { resolveRecordRefs } from './common.ts';
import { favoriteOps } from './favorites.ts';
import { directUploadKey, type FileDeps, fileOps, insertFileEntry, storageCall } from './files.ts';
import { layoutOps } from './layouts.ts';
import { documentOwner, noteOps, noteTemplateOps } from './notes.ts';
import { preferenceOps } from './preferences.ts';
import { recordPageOps } from './record-children.ts';
import { taskOps } from './tasks.ts';
import { timelineOps } from './timeline.ts';

export interface CollabWiring {
  database: Database;
  policies: Policies;
  storage?: ObjectStorage;
}

export function createCollabServices(wiring: CollabWiring) {
  const { database, policies } = wiring;
  const storage = wiring.storage ?? new S3Storage(config.s3);
  const deps: FileDeps = { policies, storage };
  const collab: CollabDeps = deps;
  const run = <T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) => runInWorkspace(database, ctx, fn);

  return {
    notes: {
      create: (ctx: ServiceContext, input: CreateNoteInput, options?: { markdown?: string; createdAt?: string }) =>
        run(ctx, (tx) => noteOps.create(tx, collab, input, options)),
      update: (ctx: ServiceContext, input: UpdateNoteInput, options?: { markdown?: string }) =>
        run(ctx, (tx) => noteOps.update(tx, collab, input, options)),
      delete: (ctx: ServiceContext, noteId: string) => run(ctx, (tx) => noteOps.delete(tx, collab, noteId)),
      get: (ctx: ServiceContext, noteId: string) => run(ctx, (tx) => noteOps.get(tx, collab, noteId)),
      batchGet: (ctx: ServiceContext, input: BatchGetNotesInput) =>
        run(ctx, (tx) => noteOps.batchGet(tx, collab, input)),
      list: (ctx: ServiceContext, input: ListNotesInput) => run(ctx, (tx) => noteOps.list(tx, collab, input)),
      applyTemplate: (ctx: ServiceContext, input: ApplyNoteTemplateInput) =>
        run(ctx, (tx) => noteOps.applyTemplate(tx, collab, input)),
    },
    noteTemplates: {
      create: (ctx: ServiceContext, input: CreateNoteTemplateInput) =>
        run(ctx, (tx) => noteTemplateOps.create(tx, input)),
      update: (ctx: ServiceContext, input: UpdateNoteTemplateInput) =>
        run(ctx, (tx) => noteTemplateOps.update(tx, input)),
      delete: (ctx: ServiceContext, templateId: string) => run(ctx, (tx) => noteTemplateOps.delete(tx, templateId)),
      get: (ctx: ServiceContext, templateId: string) => run(ctx, (tx) => noteTemplateOps.get(tx, templateId)),
      list: (ctx: ServiceContext, input: ListNoteTemplatesInput) => run(ctx, (tx) => noteTemplateOps.list(tx, input)),
      createFromNote: (ctx: ServiceContext, input: CreateTemplateFromNoteInput) =>
        run(ctx, (tx) => noteTemplateOps.createFromNote(tx, collab, input)),
    },
    documents: {
      /** For the collab server: which note / template owns a document, if the caller may open it. */
      owner: (ctx: ServiceContext, documentId: string) => run(ctx, (tx) => documentOwner(tx, collab, documentId)),
    },
    tasks: {
      create: (ctx: ServiceContext, input: CreateTaskInput, options?: { createdAt?: string }) =>
        run(ctx, (tx) => taskOps.create(tx, collab, input, options)),
      update: (ctx: ServiceContext, input: UpdateTaskInput) => run(ctx, (tx) => taskOps.update(tx, collab, input)),
      setCompleted: (ctx: ServiceContext, input: SetTaskCompletedInput) =>
        run(ctx, (tx) => taskOps.setCompleted(tx, collab, input)),
      bulkSetCompleted: (ctx: ServiceContext, input: BulkSetTasksCompletedInput) =>
        run(ctx, (tx) => taskOps.bulkSetCompleted(tx, collab, input)),
      delete: (ctx: ServiceContext, taskIds: string[]) => run(ctx, (tx) => taskOps.delete(tx, taskIds)),
      get: (ctx: ServiceContext, taskId: string) => run(ctx, (tx) => taskOps.get(tx, collab, taskId)),
      batchGet: (ctx: ServiceContext, taskIds: string[]) => run(ctx, (tx) => taskOps.batchGet(tx, collab, taskIds)),
      list: (ctx: ServiceContext, input: ListTasksInput) => run(ctx, (tx) => taskOps.list(tx, collab, input)),
      countDue: (ctx: ServiceContext, input: CountDueTasksInput) =>
        run(ctx, (tx) => taskOps.countDue(tx, collab, input)),
    },
    comments: {
      create: (ctx: ServiceContext, input: CreateCommentInput, options?: CommentWriteOptions) =>
        run(ctx, (tx) => commentOps.create(tx, collab, input, options)),
      resolve: (ctx: ServiceContext, input: ResolveCommentInput) =>
        run(ctx, (tx) => commentOps.resolve(tx, collab, input)),
      delete: (ctx: ServiceContext, commentId: string) => run(ctx, (tx) => commentOps.delete(tx, collab, commentId)),
      addReaction: (ctx: ServiceContext, input: AddReactionInput) =>
        run(ctx, (tx) => commentOps.addReaction(tx, collab, input)),
      removeReaction: (ctx: ServiceContext, input: RemoveReactionInput) =>
        run(ctx, (tx) => commentOps.removeReaction(tx, collab, input)),
      listThreads: (ctx: ServiceContext, input: ListThreadsInput) =>
        run(ctx, (tx) => commentOps.listThreads(tx, collab, input)),
      getThread: (ctx: ServiceContext, threadId: string) =>
        run(ctx, (tx) => commentOps.getThread(tx, collab, threadId)),
      get: (ctx: ServiceContext, commentId: string) => run(ctx, (tx) => commentOps.get(tx, collab, commentId)),
      locate: (ctx: ServiceContext, commentId: string) => run(ctx, (tx) => commentOps.locate(tx, collab, commentId)),
      counts: (ctx: ServiceContext, input: CommentCountsInput) =>
        run(ctx, (tx) => commentOps.counts(tx, collab, input)),
    },
    favorites: {
      list: (ctx: ServiceContext) => run(ctx, (tx) => favoriteOps.list(tx, collab)),
      put: (ctx: ServiceContext, input: PutFavoriteInput) => run(ctx, (tx) => favoriteOps.put(tx, collab, input)),
      move: (ctx: ServiceContext, input: MoveFavoriteInput) => run(ctx, (tx) => favoriteOps.move(tx, collab, input)),
      delete: (ctx: ServiceContext, favoriteId: string) => run(ctx, (tx) => favoriteOps.delete(tx, favoriteId)),
      removeByTarget: (ctx: ServiceContext, input: RemoveFavoriteByTargetInput) =>
        run(ctx, (tx) => favoriteOps.removeByTarget(tx, input)),
      putDirectory: (ctx: ServiceContext, input: PutFavoriteDirectoryInput) =>
        run(ctx, (tx) => favoriteOps.putDirectory(tx, input)),
      updateDirectory: (ctx: ServiceContext, input: UpdateFavoriteDirectoryInput) =>
        run(ctx, (tx) => favoriteOps.updateDirectory(tx, input)),
      deleteDirectory: (ctx: ServiceContext, directoryId: string) =>
        run(ctx, (tx) => favoriteOps.deleteDirectory(tx, directoryId)),
    },
    files: {
      createUploadSession: (ctx: ServiceContext, input: CreateUploadSessionInput) =>
        run(ctx, (tx) => fileOps.createUploadSession(tx, deps, input)),
      /** Accept an upload: HEAD the object (outside the transaction), then create the file entry. */
      complete: async (ctx: ServiceContext, input: { sessionId: string }) => {
        const { sessionId } = completeUploadInputSchema.parse(input);
        const session = await run(ctx, (tx) => fileOps.sessionForCompletion(tx, deps, sessionId));
        const object = session.state === 'pending' ? await storageCall(() => storage.head(session.object_key)) : null;
        return run(ctx, (tx) => fileOps.acceptUpload(tx, deps, sessionId, object));
      },
      /**
       * Public API upload (multipart, D §6): stores the bytes, then creates the file entry. The object is written
       * before the transaction; a failed insert leaves an unreferenced object for garbage collection.
       */
      upload: async (
        ctx: ServiceContext,
        input: {
          record: RecordRefInput;
          parentFolderId: string | null;
          name: string;
          contentType: string;
          body: Uint8Array;
        },
      ): Promise<StorageEntry> => {
        const id = newId();
        const key = directUploadKey(ctx.workspaceId, id);
        // Validate access and the folder before writing bytes.
        await run(ctx, (tx) => resolveRecordRefs(tx, collab, [input.record], { flag: 'update_entity_instance' }));
        await storageCall(() => storage.put(key, input.body, input.contentType));
        return run(ctx, async (tx) => {
          const [record] = await resolveRecordRefs(tx, collab, [input.record], { flag: 'update_entity_instance' });
          const ref = record as { entityDefinitionId: string; entityInstanceId: string };
          let root: string | null = null;
          if (input.parentFolderId) {
            const folder = await tx.db
              .selectFrom('storage_entries')
              .select(['root_entry_id', 'entity_instance_id', 'entry_type'])
              .where('id', '=', input.parentFolderId)
              .where('deleted_at', 'is', null)
              .executeTakeFirst();
            if (!folder || folder.entity_instance_id !== ref.entityInstanceId || folder.entry_type !== 'folder') {
              throw notFound('The requested folder could not be found', { folder_id: input.parentFolderId });
            }
            root = folder.root_entry_id;
          }
          await insertFileEntry(tx, {
            id,
            record: ref,
            parentFolderId: input.parentFolderId,
            rootEntryId: root,
            name: input.name,
            contentType: input.contentType,
            contentSize: input.body.byteLength,
            objectKey: key,
          });
          return fileOps.get(tx, collab, id);
        });
      },
      list: (ctx: ServiceContext, input: ListFilesInput) => run(ctx, (tx) => fileOps.list(tx, collab, input)),
      get: (ctx: ServiceContext, entryId: string) => run(ctx, (tx) => fileOps.get(tx, collab, entryId)),
      createFolder: (ctx: ServiceContext, input: CreateFolderInput) =>
        run(ctx, (tx) => fileOps.createFolder(tx, collab, input)),
      rename: (ctx: ServiceContext, input: RenameEntryInput) => run(ctx, (tx) => fileOps.rename(tx, collab, input)),
      delete: (ctx: ServiceContext, entryId: string) => run(ctx, (tx) => fileOps.delete(tx, collab, entryId)),
      downloadUrl: (ctx: ServiceContext, input: DownloadUrlInput) =>
        run(ctx, (tx) => fileOps.downloadUrl(tx, deps, input)),
    },
    layouts: {
      get: (ctx: ServiceContext, input: GetLayoutInput) =>
        run(ctx, async (tx) => {
          const layout = await layoutOps.get(tx, input);
          await policies.assertCan(tx, layout.entityDefinitionId, 'read_entity_definition');
          return layout;
        }),
      save: (ctx: ServiceContext, input: SaveLayoutInput) =>
        run(ctx, async (tx) => {
          const current = await layoutOps.byId(tx, input.customLayoutId);
          await policies.assertCan(tx, current.entityDefinitionId, 'update_custom_layout');
          return layoutOps.save(tx, input);
        }),
    },
    timeline: {
      list: (ctx: ServiceContext, input: ListTimelineInput) => run(ctx, (tx) => timelineOps.list(tx, collab, input)),
    },
    recordPage: {
      state: (ctx: ServiceContext, input: RecordStateInput) => run(ctx, (tx) => recordPageOps.state(tx, collab, input)),
      relatedCounts: (ctx: ServiceContext, input: RelatedCountsInput) =>
        run(ctx, (tx) => recordPageOps.relatedCounts(tx, collab, input)),
    },
    preferences: {
      get: (ctx: ServiceContext) => run(ctx, (tx) => preferenceOps.get(tx)),
      update: (ctx: ServiceContext, input: UpdateMemberPreferencesInput) =>
        run(ctx, (tx) => preferenceOps.update(tx, input)),
    },
  };
}
