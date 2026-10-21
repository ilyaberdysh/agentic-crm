import type { CollabDeps } from '../collab/common.ts';
import { taskOps } from '../collab/tasks.ts';
import { assertProductModuleEnabled } from '../modules/service.ts';
import type { Tx } from '../tx.ts';
import type { ExecuteTaskCreateInput } from './actions/contracts.ts';
import type { ActionService } from './actions/service.ts';
import type { AgentTaskService } from './tasks/service.ts';

/** One bounded capability, with no transport-selected operation or executor. */
export function createTaskCapability(options: { actions: ActionService; collab: CollabDeps; tasks: AgentTaskService }) {
  return {
    async execute(tx: Tx, input: ExecuteTaskCreateInput) {
      await assertProductModuleEnabled(tx, 'record-follow-up');
      const result = await options.actions.executeTaskCreate(tx, input, (task) =>
        taskOps.create(tx, options.collab, task, { requireNew: true }),
      );
      if (result.action.status === 'SUCCEEDED') await options.tasks.settleSucceededTaskCreate(tx, result);
      return result;
    },
  };
}
