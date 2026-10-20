// Wiring of the export services for createDomain(): one workspace transaction per call (I1, I2). Members export
// what they can read (export.md E1: all members on objects, read access on lists).
import type { CreateExportInput } from '@agentic-crm/contracts';
import type { Database } from '@agentic-crm/db';
import type { ServiceContext } from '../context.ts';
import type { JobQueue } from '../jobs/queue.ts';
import type { Policies } from '../permissions.ts';
import type { ObjectStorage } from '../storage/s3.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { viewOps } from '../views/service.ts';
import { executeExport, exportOps, failExport } from './service.ts';

export interface ExportWiring {
  database: Database;
  policies: Policies;
  storage: ObjectStorage;
  jobs: JobQueue;
}

export function createExportServices(wiring: ExportWiring) {
  const { database, policies, storage, jobs } = wiring;
  const deps = { jobs, storage };
  const run = <T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) => runInWorkspace(database, ctx, fn);
  const readable = async (tx: Tx, exportId: string) => {
    const status = await exportOps.status(tx, exportId);
    await policies.assertCan(tx, status.entityDefinitionId, 'read_entity_instance');
    return status;
  };
  return {
    exports: {
      /** Export view as CSV: freezes the saved view and queues the worker job. */
      create: (ctx: ServiceContext, input: CreateExportInput) =>
        run(ctx, async (tx) => {
          const view = await viewOps.get(tx, input.viewId);
          await policies.assertCan(tx, view.entityDefinitionId, 'read_entity_instance');
          return exportOps.create(tx, deps, input);
        }),
      status: (ctx: ServiceContext, input: { exportId: string }) => run(ctx, (tx) => readable(tx, input.exportId)),
      downloadUrl: (ctx: ServiceContext, input: { exportId: string }) =>
        run(ctx, async (tx) => {
          await readable(tx, input.exportId);
          return exportOps.downloadUrl(tx, deps, input.exportId);
        }),
      /** Worker: runs the `export.run` job. */
      execute: (workspaceId: string, exportId: string) => executeExport(database, storage, workspaceId, exportId),
      /** Worker: the job failed after its last retry. */
      fail: (workspaceId: string, exportId: string) => failExport(database, workspaceId, exportId),
    },
  };
}
