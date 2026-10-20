import { databaseUrlFor, testDatabaseName } from '@agentic-crm/config';

/** The suite database (CLAUDE.md: never the dev DB `agentic_crm`): per checkout, or `AGENTIC_CRM_TEST_DB_PREFIX` + `worker`. */
export const TEST_DATABASE = testDatabaseName('worker');

export function databaseUrl(name = TEST_DATABASE): string {
  return databaseUrlFor(name);
}
