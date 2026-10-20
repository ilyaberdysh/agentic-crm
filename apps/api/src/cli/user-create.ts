// Creates a team account with a generated password (D-15: seeded accounts for the team).
//   pnpm --filter @agentic-crm/api user:create <email> <name…> [--reset-password]
// --reset-password sets a new generated password for an existing account (and ends its sessions).
import { z } from 'zod';
import { createAuth } from '../auth/auth';
import { loadConfig } from '../config';
import { createKysely, createPool } from '../db';
import { generatePassword } from './password';

function usage(message?: string): never {
  if (message) console.error(`error: ${message}`);
  console.error('usage: pnpm --filter @agentic-crm/api user:create <email> <name…> [--reset-password]');
  process.exit(1);
}

async function main(argv: string[]): Promise<void> {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const args = argv.filter((a) => !a.startsWith('--'));
  for (const flag of flags) if (flag !== '--reset-password') usage(`unknown flag ${flag}`);
  const [rawEmail, ...nameParts] = args;
  const email = z.email().safeParse(rawEmail?.trim().toLowerCase());
  if (!email.success) usage('a valid email address is required');
  const name = nameParts.join(' ').trim();
  const reset = flags.has('--reset-password');
  if (!name && !reset) usage('a name is required');

  const config = loadConfig({ logLevel: 'warn' });
  const pool = createPool(config.databaseUrl, 2);
  try {
    const auth = createAuth({ db: createKysely(pool), config });
    const ctx = await auth.$context;
    const password = generatePassword();
    const hash = await ctx.password.hash(password);
    const existing = await ctx.internalAdapter.findUserByEmail(email.data, { includeAccounts: true });

    if (existing) {
      if (!reset) usage(`a user with email ${email.data} already exists (use --reset-password to set a new password)`);
      const hasCredential = existing.accounts.some((a) => a.providerId === 'credential');
      if (hasCredential) await ctx.internalAdapter.updatePassword(existing.user.id, hash);
      else {
        await ctx.internalAdapter.linkAccount({
          userId: existing.user.id,
          providerId: 'credential',
          accountId: existing.user.id,
          password: hash,
        });
      }
      await ctx.internalAdapter.deleteUserSessions(existing.user.id);
      console.log(`Reset password for ${existing.user.email} (${existing.user.id})`);
    } else {
      if (reset) usage(`no user with email ${email.data}`);
      const user = await ctx.internalAdapter.createUser(
        { email: email.data, name, emailVerified: true },
        { method: 'admin' },
      );
      await ctx.internalAdapter.linkAccount({
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: hash,
      });
      console.log(`Created user ${user.email} (${user.id})`);
    }
    console.log(`Password: ${password}`);
    console.log('Share it privately; it is not stored in plain text and cannot be shown again.');
  } finally {
    await pool.end();
  }
}

await main(process.argv.slice(2));
