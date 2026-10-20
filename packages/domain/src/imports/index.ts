// Wiring of the import services for createDomain(): one workspace transaction per call (I1, I2) and the permission
// gate on the destination (import.md I1 "Import not allowed": members need create access to the object or list).
import type {
  CreateImportInput,
  CreateImportOptionsInput,
  ImportAssertionsInput,
  ImportHistoryInput,
  ReviewValuesInput,
  SetImportMappingInput,
  SetImportOverrideInput,
  UploadRowsInput,
} from '@agentic-crm/contracts';
import type { Database } from '@agentic-crm/db';
import type { ServiceContext } from '../context.ts';
import type { JobQueue } from '../jobs/queue.ts';
import type { Policies } from '../permissions.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { type ExecuteImportOptions, executeImport, failImport } from './execute.ts';
import { requireJob } from './model.ts';
import { importOps } from './service.ts';

export interface ImportWiring {
  database: Database;
  policies: Policies;
  jobs: JobQueue;
}

export function createImportServices(wiring: ImportWiring) {
  const { database, policies, jobs } = wiring;
  const run = <T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) => runInWorkspace(database, ctx, fn);
  /** Loads the job's destination and checks `flag` on it before `fn`. */
  const onJob =
    <I extends { jobId: string }, T>(
      flag: 'read_entity_instance' | 'create_entity_instance',
      fn: (tx: Tx, input: I) => Promise<T>,
    ) =>
    (ctx: ServiceContext, input: I) =>
      run(ctx, async (tx) => {
        const job = await requireJob(tx, input.jobId);
        await policies.assertCan(tx, job.entity_definition_id, flag);
        return fn(tx, input);
      });
  const schemaDeps = (tx: Tx) => ({
    assertCanCreateAttribute: (defId: string) => policies.assertCan(tx, defId, 'create_attribute_definition'),
    assertCanUpdateAttribute: (defId: string) => policies.assertCan(tx, defId, 'update_attribute_definition'),
  });

  return {
    imports: {
      create: (ctx: ServiceContext, input: CreateImportInput) =>
        run(ctx, async (tx) => {
          await policies.assertCan(tx, input.entityDefinitionId, 'create_entity_instance');
          return importOps.create(tx, { jobs }, input);
        }),
      uploadRows: onJob('create_entity_instance', (tx, input: UploadRowsInput) => importOps.uploadRows(tx, input)),
      status: onJob('read_entity_instance', (tx, input: { jobId: string }) => importOps.status(tx, input.jobId)),
      mappableProperties: onJob('read_entity_instance', (tx, input: { jobId: string }) =>
        importOps.mappableProperties(tx, input.jobId),
      ),
      setMapping: onJob('create_entity_instance', (tx, input: SetImportMappingInput) =>
        importOps.setMapping(tx, schemaDeps(tx), input),
      ),
      reviewValues: onJob('read_entity_instance', (tx, input: ReviewValuesInput) => importOps.reviewValues(tx, input)),
      reviewSummary: onJob('read_entity_instance', (tx, input: { jobId: string }) =>
        importOps.reviewSummary(tx, input.jobId),
      ),
      setOverride: onJob('create_entity_instance', (tx, input: SetImportOverrideInput) =>
        importOps.setOverride(tx, input),
      ),
      createOptions: onJob('create_entity_instance', (tx, input: CreateImportOptionsInput) =>
        importOps.createOptions(tx, schemaDeps(tx), input),
      ),
      preview: onJob('create_entity_instance', (tx, input: { jobId: string }) => importOps.preview(tx, input.jobId)),
      assertions: onJob('read_entity_instance', (tx, input: ImportAssertionsInput) => importOps.assertions(tx, input)),
      run: onJob('create_entity_instance', (tx, input: { jobId: string }) => importOps.run(tx, { jobs }, input.jobId)),
      cancel: onJob('create_entity_instance', (tx, input: { jobId: string }) => importOps.cancel(tx, input.jobId)),
      delete: onJob('create_entity_instance', (tx, input: { jobId: string }) => importOps.delete(tx, input.jobId)),
      history: (ctx: ServiceContext, input: ImportHistoryInput = {}) => run(ctx, (tx) => importOps.history(tx, input)),
      /** Worker: runs the `import.run` job (plan if needed, then batches). */
      execute: (workspaceId: string, jobId: string, options?: ExecuteImportOptions) =>
        executeImport(database, workspaceId, jobId, options),
      /** Worker: the job failed after its last retry. */
      fail: (workspaceId: string, jobId: string, reason: string) => failImport(database, workspaceId, jobId, reason),
    },
  };
}
