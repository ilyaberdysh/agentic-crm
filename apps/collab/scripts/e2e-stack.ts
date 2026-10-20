// Backend for the editor e2e (packages/editor/e2e): a fresh database `<prefix>editor_e2e`, the API (sign-up/sign-in,
// Better Auth cookies) and the collab server in one process, two members (Ada, Grace) in one workspace with a few
// records to mention. Writes the accounts to E2E_STATE_FILE and runs until SIGTERM.
//   pnpm --filter @agentic-crm/collab exec tsx scripts/e2e-stack.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApp } from '@agentic-crm/api';
import { databaseUrlFor, testDatabaseName } from '@agentic-crm/config';
import { createDb, migrateUp } from '@agentic-crm/db';
import { createDomain, memberContext, newId } from '@agentic-crm/domain';
import pg from 'pg';
import { createCollabServer } from '../src/server.ts';

const DATABASE = testDatabaseName('editor_e2e');
const API_PORT = Number(process.env.E2E_API_PORT ?? 4152);
const COLLAB_PORT = Number(process.env.COLLAB_TEST_PORT ?? 4151);
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:5185';
const STATE_FILE =
  process.env.E2E_STATE_FILE ?? new URL('../../../packages/editor/e2e/.auth/state.json', import.meta.url).pathname;
const PASSWORD = 'correct-horse-battery';

const databaseUrl = databaseUrlFor;

const admin = new pg.Client({ connectionString: databaseUrl('postgres') });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${DATABASE}`);
await admin.end();
await migrateUp(databaseUrl(DATABASE));

const api = await buildApp({
  config: {
    databaseUrl: databaseUrl(DATABASE),
    host: '127.0.0.1',
    port: API_PORT,
    webOrigin: WEB_ORIGIN,
    publicUrl: WEB_ORIGIN,
    logLevel: 'warn',
  },
});
await api.app.listen({ host: '127.0.0.1', port: API_PORT });

const database = createDb({ connectionString: databaseUrl(DATABASE), applicationName: 'editor-e2e' });
const domain = createDomain({ database });
const collab = createCollabServer({
  database,
  domain,
  config: {
    host: '127.0.0.1',
    port: COLLAB_PORT,
    databaseUrl: databaseUrl(DATABASE),
    authSecret: api.config.authSecret,
    allowedOrigins: [WEB_ORIGIN],
    debounceMs: 200,
    maxDebounceMs: 1_000,
    logLevel: 'warn',
  },
});
await collab.start();

async function signUp(name: string, email: string) {
  const response = await fetch(`http://127.0.0.1:${API_PORT}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });
  if (!response.ok) throw new Error(`sign-up ${email}: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { user: { id: string } };
  const [firstName = '', ...rest] = name.split(' ');
  return {
    id: body.user.id,
    name,
    email,
    identity: { userId: body.user.id, emailAddress: email, firstName, lastName: rest.join(' ') },
  };
}

const ada = await signUp('Ada Lovelace', 'ada@editor-e2e.test');
const grace = await signUp('Grace Hopper', 'grace@editor-e2e.test');
const ws = await domain.workspaces.create(ada.identity, { name: 'Editor e2e', slug: 'editor-e2e' });
const ctx = memberContext(ws.id, ws.membership.id);
await domain.invites.create(ctx, { invites: [{ emailAddress: grace.email, accessLevel: 'member' }] });
const graceMember = await domain.invites.accept(grace.identity, { workspaceId: ws.id });

const companies = await domain.schema.getObject(ctx, 'companies');
for (const [name, domainName] of [
  ['[seed] Atlas Ventures', 'atlas-ventures.example'],
  ['[seed] Cedar Health', 'cedar.example'],
  ['[seed] Helios Energy', 'helios.example'],
]) {
  await domain.records.create(ctx, {
    entityDefinitionId: companies.id,
    entityInstanceId: newId(),
    values: { name: [{ value: name }], domains: [{ value: domainName }] },
  });
}

mkdirSync(dirname(STATE_FILE), { recursive: true });
writeFileSync(
  STATE_FILE,
  `${JSON.stringify(
    {
      workspaceId: ws.id,
      password: PASSWORD,
      users: [
        { email: ada.email, name: ada.name, memberId: ws.membership.id },
        { email: grace.email, name: grace.name, memberId: graceMember.membership.id },
      ],
    },
    null,
    2,
  )}\n`,
);
console.log(`[editor-e2e] api :${API_PORT}, collab :${COLLAB_PORT}, database ${DATABASE}`);

const shutdown = async () => {
  await collab.stop();
  await api.app.close();
  await database.destroy();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
