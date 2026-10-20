// Creates a workspace API token for the public REST API (/v2) and prints its secret once.
//   pnpm --filter @agentic-crm/api token:create <workspace-slug> <name> <scope…>
// Scopes are Attio's `<resource>:<read|read-write>` strings (e.g. record_permission:read-write object_configuration:read),
// comma- or space-separated; `all` grants every scope read-write. The token is attributed to the workspace's first
// admin (Attio's `authorized_by_workspace_member_id`).
import { pathToFileURL } from 'node:url';
import { type ApiScope, apiScopeResources, apiScopeSchema, type CreatedApiToken } from '@agentic-crm/contracts';
import { createDb, type Database } from '@agentic-crm/db';
import { createDomain, type Domain, systemContext } from '@agentic-crm/domain';
import { loadConfig } from '../config';

export function parseScopes(args: string[]): ApiScope[] {
  const words = args.flatMap((a) => a.split(/[\s,]+/)).filter(Boolean);
  const scopes: ApiScope[] = [];
  for (const word of words) {
    if (word === 'all') {
      scopes.push(...apiScopeResources.map((r) => `${r}:read-write` as ApiScope));
      continue;
    }
    const parsed = apiScopeSchema.safeParse(word);
    if (!parsed.success) throw new Error(`Unknown scope "${word}" (expected <resource>:read or <resource>:read-write)`);
    scopes.push(parsed.data);
  }
  if (scopes.length === 0) throw new Error('At least one scope is required');
  return scopes;
}

/** Looks the workspace up by slug (an owner-role read) and creates the token through the domain as the system. */
export async function createWorkspaceToken(
  database: Database,
  domain: Domain,
  workspaceSlug: string,
  name: string,
  scopes: ApiScope[],
): Promise<CreatedApiToken & { workspaceSlug: string }> {
  const workspace = await database.kysely
    .selectFrom('workspaces')
    .select(['id', 'slug'])
    .where('slug', '=', workspaceSlug)
    .executeTakeFirst();
  if (!workspace) throw new Error(`No workspace with slug "${workspaceSlug}"`);
  const admin = await database.kysely
    .selectFrom('workspace_members')
    .select('id')
    .where('workspace_id', '=', workspace.id)
    .where('access_level', '=', 'admin')
    .orderBy('created_at')
    .executeTakeFirst();
  const token = await domain.apiTokens.create(systemContext(workspace.id, 'cli'), {
    name,
    scopes,
    authorizedByMemberId: admin?.id ?? null,
  });
  return { ...token, workspaceSlug: workspace.slug };
}

async function main(argv: string[]): Promise<void> {
  const [slug, name, ...scopeArgs] = argv;
  if (!slug || !name || scopeArgs.length === 0) {
    console.error('usage: pnpm --filter @agentic-crm/api token:create <workspace-slug> <name> <scope…>');
    console.error('  e.g. token:create mymeet "Zapier" record_permission:read-write object_configuration:read');
    process.exitCode = 1;
    return;
  }
  const config = loadConfig({ logLevel: 'warn' });
  const database = createDb({ connectionString: config.databaseUrl, max: 2, applicationName: 'agentic-crm-token-cli' });
  try {
    const token = await createWorkspaceToken(database, createDomain({ database }), slug, name, parseScopes(scopeArgs));
    console.log(`Created access token "${token.name}" (${token.id}) for workspace ${token.workspaceSlug}`);
    console.log(`Scopes: ${token.scopes.join(' ')}`);
    console.log(`Token: ${token.token}`);
    console.log('Use it as "Authorization: Bearer <token>". It is stored hashed and cannot be shown again.');
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await database.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
