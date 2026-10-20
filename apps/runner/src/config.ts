import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { apiOrigin, localEndpoint, RunnerApi, RunnerError } from './transport.ts';

export const configSchema = z.strictObject({
  apiOrigin: z.string().transform(apiOrigin),
  stateDirectory: z.string().refine(isAbsolute),
  name: z.string().trim().min(1).max(100),
  pollMs: z.number().int().min(100).max(60_000).default(2_000),
  localEndpoints: z.array(z.string().transform(localEndpoint)).max(16).default([]),
  sandbox: z
    .strictObject({
      runtimeExecutable: z.string().refine(isAbsolute),
      image: z.string().regex(/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/),
      egressHosts: z.array(z.string()).min(1).max(16),
      profile: z.strictObject({
        id: z.uuid(),
        label: z.string().trim().min(1).max(100),
        directory: z.string().refine(isAbsolute),
      }),
    })
    .optional(),
});
export type RunnerConfig = z.output<typeof configSchema>;
const identitySchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  apiOrigin: z.string(),
  bearerToken: z.string().max(200),
});
export type RunnerIdentity = z.infer<typeof identitySchema>;

export async function readConfig(path: string): Promise<RunnerConfig> {
  try {
    return configSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    throw new RunnerError('invalid_configuration');
  }
}

async function privateDirectory(path: string) {
  await mkdir(path, { mode: 0o700, recursive: true });
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid()) ||
    (await realpath(path)) !== path
  )
    throw new RunnerError('unsafe_state_directory');
}

export async function readIdentity(config: RunnerConfig): Promise<RunnerIdentity> {
  await privateDirectory(config.stateDirectory);
  const handle = await open(join(config.stateDirectory, 'identity.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > 2_048 ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())
    )
      throw new RunnerError('unsafe_identity_file');
    const identity = identitySchema.parse(JSON.parse(await handle.readFile('utf8')));
    if (identity.apiOrigin !== config.apiOrigin || !validBearer(identity))
      throw new RunnerError('identity_binding_mismatch');
    return identity;
  } finally {
    await handle.close();
  }
}

function validBearer(identity: RunnerIdentity) {
  return new RegExp(`^acrm_run\\.${identity.workspaceId}\\.${identity.id}\\.[A-Za-z0-9_-]{43}$`).test(
    identity.bearerToken,
  );
}

/** Reserve the owner-only file before consuming the single-use token; never overwrite an existing pairing. */
export async function enroll(
  config: RunnerConfig,
  token: string,
  requestFetch?: typeof fetch,
): Promise<RunnerIdentity> {
  await privateDirectory(config.stateDirectory);
  const handle = await open(join(config.stateDirectory, 'identity.json'), 'wx', 0o600);
  try {
    const id = randomUUID();
    const api = new RunnerApi(config.apiOrigin, undefined, requestFetch);
    const reply = identitySchema.omit({ apiOrigin: true }).parse(
      await api.post('/api/agentic/runners/enroll', {
        id,
        token,
        name: config.name,
        authProfiles: config.sandbox
          ? [{ id: config.sandbox.profile.id, provider: 'codex', label: config.sandbox.profile.label }]
          : [],
      }),
    );
    const identity = { ...reply, apiOrigin: config.apiOrigin };
    if (identity.id !== id || !validBearer(identity)) throw new RunnerError('invalid_enrollment_response');
    await handle.writeFile(`${JSON.stringify(identity)}\n`);
    await handle.sync();
    return identity;
  } finally {
    await handle.close();
  }
}
