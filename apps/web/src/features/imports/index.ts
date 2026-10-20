// Imports feature (BACKLOG 4.07): the CSV import wizard at the routes, import history, and the one data module
// (data/backend.ts: tRPC when the server has the `imports` router, else the in-memory fake).
// router:...importRoutes(=> mainRoute),...importSettingsRoutes(=> settingsRoute)
// open from a page: openImportWizard(router.navigate, href, 'collection/<listId>') (overlay; closing returns there)
// settings tab: <ImportHistoryList entityDefinitionId=… pluralNoun=… startBase=… />

export { importsBackend } from './data/backend';
export type { ImportJob, ImportsBackend } from './data/contract';
export { ImportHistoryList, ImportHistoryPage } from './history/ImportHistory';
export { importRoutes, importSettingsRoutes } from './routes';
export { beginOverlaySession, openImportWizard, wizardPath } from './wizard/destination';
