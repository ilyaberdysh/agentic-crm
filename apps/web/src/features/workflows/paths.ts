// Workflow routes below `/<workspaceSlug>/` (README §1 route table).
export const workflowsPath = () => 'automations/workflows';
export const editorPath = (workflowId: string) => `automations/workflows/${workflowId}/editor`;
export const runsPath = (workflowId: string, run?: { versionId: string; runId: string }) =>
  run
    ? `automations/workflows/${workflowId}/runs/${run.versionId}/${run.runId}`
    : `automations/workflows/${workflowId}/runs`;
export const settingsTabPath = (workflowId: string) => `automations/workflows/${workflowId}/settings`;
export const adminWorkflowsPath = () => 'settings/automations/workflows';
export const adminPermissionsPath = (workflowId: string) => `settings/automations/workflows/${workflowId}/permissions`;
export const creditUsagePath = () => 'settings/billing/automation-credit-usage';
