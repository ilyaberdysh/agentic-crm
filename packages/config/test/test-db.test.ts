// Test database names: per checkout by default (checkouts share one Postgres container and each suite's global setup
// drops its database), AGENTIC_CRM_TEST_DB_PREFIX when set.
import { afterEach, describe, expect, it } from 'vitest';
import { databaseUrlFor, testDatabaseName, testDatabasePrefix } from '../src/index.ts';

const saved = process.env.AGENTIC_CRM_TEST_DB_PREFIX;
afterEach(() => {
  if (saved === undefined) delete process.env.AGENTIC_CRM_TEST_DB_PREFIX;
  else process.env.AGENTIC_CRM_TEST_DB_PREFIX = saved;
});

describe('test databases', () => {
  it('derives a stable prefix from the checkout path when no prefix is set', () => {
    delete process.env.AGENTIC_CRM_TEST_DB_PREFIX;
    const prefix = testDatabasePrefix();
    expect(prefix).toMatch(/^agentic_crm_test_[0-9a-f]{8}_$/);
    expect(testDatabasePrefix()).toBe(prefix);
    expect(testDatabaseName('api')).toBe(`${prefix}api`);
  });

  it('uses AGENTIC_CRM_TEST_DB_PREFIX when it is a valid identifier prefix', () => {
    process.env.AGENTIC_CRM_TEST_DB_PREFIX = 'agentic_crm_test_s4int_';
    expect(testDatabaseName('domain')).toBe('agentic_crm_test_s4int_domain');
    process.env.AGENTIC_CRM_TEST_DB_PREFIX = 'bad-prefix; drop';
    expect(testDatabasePrefix()).toMatch(/^agentic_crm_test_[0-9a-f]{8}_$/);
  });

  it('points a URL at another database on the same server', () => {
    expect(new URL(databaseUrlFor('agentic_crm_test_x_api')).pathname).toBe('/agentic_crm_test_x_api');
  });
});
