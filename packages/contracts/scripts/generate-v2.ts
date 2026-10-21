import { readFileSync, writeFileSync } from 'node:fs';
import { renderOpenApiDocument } from '../src/v2/openapi.ts';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--check')) throw new Error('Usage: node scripts/generate-v2.ts [--check]');
const path = new URL('../src/v2/openapi.gen.json', import.meta.url);
const expected = renderOpenApiDocument();
if (args.includes('--check')) {
  let actual: string | undefined;
  try {
    actual = readFileSync(path, 'utf8');
  } catch {
    /* A missing snapshot is drift too. */
  }
  if (actual !== expected) {
    console.error('The Agentic CRM OpenAPI document is stale. Run pnpm --filter @agentic-crm/contracts generate:v2.');
    process.exitCode = 1;
  }
} else {
  writeFileSync(path, expected);
}
