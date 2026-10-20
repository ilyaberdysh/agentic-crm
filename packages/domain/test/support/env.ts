import { databaseUrlFor, testDatabaseName } from '@agentic-crm/config';

/**
 * The suite database (CLAUDE.md: never the dev DB `agentic_crm`): per checkout, or `AGENTIC_CRM_TEST_DB_PREFIX` + `domain`
 * (e.g. `agentic_crm_test_s2srv_` → `agentic_crm_test_s2srv_domain`), so parallel checkouts never share it.
 */
export const TEST_DATABASE = testDatabaseName('domain');

export function databaseUrl(name = TEST_DATABASE): string {
  return databaseUrlFor(name);
}
