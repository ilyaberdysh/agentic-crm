import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdtemp, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CodexEvents, disabledCodexFeatures, supportedCodexVersion } from './codex-cli.js';
import { ExecutionError, type ExecutionEvent, type ExecutionLimits } from './contract.js';
import { type ProcessBudget, runBoundedProcess } from './process.js';
import { createVendorRelay, isEgressHostname } from './vendor-relay.js';

const scopeSchema = z.strictObject({
  runnerId: z.uuid(),
  workspaceId: z.uuid(),
  taskId: z.uuid(),
  leaseGeneration: z.union([z.string().regex(/^[1-9]\d*$/), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),
});
export type CodexRunnerScope = z.infer<typeof scopeSchema>;
const baseRequest = {
  prompt: z.string().min(1).max(16_384),
  nativeTools: z.literal('disabled'),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
};
const requestSchema = z.discriminatedUnion('dataClass', [
  z.strictObject({ ...baseRequest, dataClass: z.literal('synthetic'), crmAccess: z.literal('disabled') }),
  z.strictObject({
    ...baseRequest,
    dataClass: z.literal('crm'),
    crmAccess: z.literal('scoped-mcp'),
    scope: scopeSchema,
    relay: z.strictObject({ socketPath: z.string().min(1), scope: scopeSchema }),
  }),
]);
/** Constructed by authenticated runner code, never deserialized directly from a model or public API. */
export type CodexContainerRequest = z.infer<typeof requestSchema>;

const limitsSchema = z.strictObject({
  firstEventMs: z.number().int().min(1).max(120_000),
  idleMs: z.number().int().min(1).max(120_000),
  totalMs: z.number().int().min(1).max(300_000),
  maxOutputBytes: z.number().int().min(1).max(1_048_576),
  killGraceMs: z.number().int().min(1).max(1_000),
});
const defaults: ExecutionLimits = {
  firstEventMs: 30_000,
  idleMs: 30_000,
  totalMs: 120_000,
  maxOutputBytes: 262_144,
  killGraceMs: 100,
};
const configSchema = z.strictObject({
  runtimeExecutable: z.string().min(1),
  image: z.string().regex(/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/),
  egressHosts: z.array(z.string().refine(isEgressHostname)).min(1).max(16),
  authenticationProfile: z.string().min(1).optional(),
  limits: limitsSchema.partial().optional(),
});
export type CodexContainerConfig = z.infer<typeof configSchema>;
export interface CodexSandboxConformance {
  boundary: 'rootless-podman-v1';
  image: string;
  checkedAt: string;
}
export interface CodexContainerResult extends CodexSandboxConformance {
  adapter: 'codex-container-v1';
  executableVersion: string;
  sessionId: string;
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: 'unknown';
  executionHost: 'paired-runner';
  dataDestination: 'cli-vendor';
  isolation: 'rootless-container';
}
const memoryBytes = 536_870_912;
const pids = 64;
const bootstrap = fileURLToPath(new URL('./container/bootstrap.mjs', import.meta.url));
const supportedPodmanVersion = (version: string) => {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 5 || (major === 5 && minor >= 7);
};

/** An enforceable runner-side boundary. It never mounts a checkout, host HOME, or runtime socket. */
export class CodexContainerSandbox {
  readonly kind = 'runner-container';
  private readonly config: CodexContainerConfig;
  private readonly limits: ExecutionLimits;

  constructor(config: CodexContainerConfig) {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) throw new ExecutionError('invalid_request', 'Invalid container sandbox configuration.');
    this.config = parsed.data;
    this.limits = limitsSchema.parse({ ...defaults, ...parsed.data.limits });
  }

  /** Credential-free live check. Execution repeats these probes in its own container before Codex starts. */
  async checkConformance(signal?: AbortSignal): Promise<CodexSandboxConformance> {
    await this.run(undefined, signal);
    return this.conformance();
  }

  async execute(
    request: CodexContainerRequest,
    emit: (event: ExecutionEvent) => void = () => {},
  ): Promise<CodexContainerResult> {
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success) throw new ExecutionError('invalid_request', 'Invalid runner execution request.');
    const events = new CodexEvents(emit, parsed.data.dataClass === 'crm');
    await this.run(parsed.data, parsed.data.signal, (chunk) => events.push(chunk));
    events.finish();
    // Completion cannot precede container removal and relay revocation.
    emit({ type: 'completed', inputTokens: events.inputTokens, outputTokens: events.outputTokens });
    return {
      ...this.conformance(),
      adapter: 'codex-container-v1',
      executableVersion: supportedCodexVersion,
      sessionId: events.sessionId,
      text: events.text,
      inputTokens: events.inputTokens,
      outputTokens: events.outputTokens,
      cost: 'unknown',
      executionHost: 'paired-runner',
      dataDestination: 'cli-vendor',
      isolation: 'rootless-container',
    };
  }

  private conformance(): CodexSandboxConformance {
    return { boundary: 'rootless-podman-v1', image: this.config.image, checkedAt: new Date().toISOString() };
  }

  private async run(request?: CodexContainerRequest, signal?: AbortSignal, onStdout?: (chunk: Buffer) => boolean) {
    if (process.platform !== 'linux' || !process.getuid || !process.getgid || process.getuid() === 0) {
      throw new ExecutionError(
        'sandbox_unavailable',
        'A non-root Linux runner with local rootless Podman is required.',
      );
    }
    if (signal?.aborted) throw new ExecutionError('canceled', 'Execution canceled.');
    const executable = await this.runtimeExecutable();
    const budget: ProcessBudget = { deadline: Date.now() + this.limits.totalMs, outputBytes: 0 };
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin:/bin',
      HOME: homedir(),
      XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
      LANG: 'C.UTF-8',
      NO_COLOR: '1',
    };
    const command = (argv: string[], extra: { stdin?: string; onStdout?: (chunk: Buffer) => boolean } = {}) =>
      runBoundedProcess({
        executable,
        argv: ['--remote=false', ...argv],
        cwd: '/',
        env,
        limits: this.limits,
        budget,
        signal,
        ...extra,
      });
    const info = await command(['info', '--format=json']);
    let runtime: unknown;
    try {
      runtime = JSON.parse(info.stdout);
    } catch {
      /* Classified below; raw diagnostics stay local. */
    }
    const infoSchema = z.object({
      host: z.object({
        os: z.literal('linux'),
        cgroupVersion: z.literal('v2'),
        security: z.object({ rootless: z.literal(true) }),
      }),
      version: z.object({ Version: z.string().refine(supportedPodmanVersion) }),
    });
    if (info.exitCode !== 0 || !infoSchema.safeParse(runtime).success) {
      throw new ExecutionError(
        'sandbox_unavailable',
        'Podman 5.7 or newer, rootless execution, and cgroup v2 are required.',
      );
    }
    let authFile: string | undefined;
    if (request) {
      if (!this.config.authenticationProfile)
        throw new ExecutionError('unauthenticated', 'Select a dedicated CLI authentication profile.');
      authFile = await this.authenticationFile(this.config.authenticationProfile);
    }
    let mcpSocket: string | undefined;
    if (request?.dataClass === 'crm') {
      if (JSON.stringify(request.scope) !== JSON.stringify(request.relay.scope)) {
        throw new ExecutionError('invalid_request', 'CRM relay scope does not match the active runner lease.');
      }
      mcpSocket = await this.scopedSocket(request.relay.socketPath);
    }
    const namespaces = Object.fromEntries(
      await Promise.all(
        ['user', 'mnt', 'net', 'pid', 'ipc', 'uts', 'cgroup'].map(async (name) => [
          name,
          await readlink(`/proc/self/ns/${name}`),
        ]),
      ),
    );
    const state = await realpath(await mkdtemp(join(tmpdir(), 'crm-sandbox-')));
    const hostProbePath = join(state, 'host-probe');
    // mkdtemp uses 0700: the socket and profile are unavailable to other host users.
    const name = `crm-codex-${randomUUID()}`;
    const nonce = randomUUID();
    let creationAttempted = false;
    let relay: Awaited<ReturnType<typeof createVendorRelay>> | undefined;
    try {
      await writeFile(hostProbePath, 'isolation-probe', { mode: 0o600 });
      relay = await createVendorRelay(join(state, 'egress.sock'), this.config.egressHosts);
      const binds = [
        { source: await realpath(bootstrap), destination: '/bootstrap.mjs' },
        { source: join(state, 'egress.sock'), destination: '/relay/egress.sock' },
        ...(authFile ? [{ source: authFile, destination: '/state/codex/auth.json' }] : []),
        ...(mcpSocket ? [{ source: mcpSocket, destination: '/relay/mcp.sock' }] : []),
      ];
      // Reject delimiter injection into Podman's mount grammar, including trusted operator paths.
      if (binds.some(({ source }) => /[,\n\r]/.test(source)))
        throw new ExecutionError('invalid_request', 'Unsupported sandbox mount path.');
      const uid = process.getuid();
      const gid = process.getgid();
      const containerConfig = Buffer.from(
        JSON.stringify({
          nonce,
          uid,
          memoryBytes,
          pids,
          hostProbePath,
          namespaces,
          probeOnly: !request,
          scopedMcp: !!mcpSocket,
          version: supportedCodexVersion,
          disabledFeatures: disabledCodexFeatures,
        }),
      ).toString('base64url');
      const argv = [
        'create',
        '--name',
        name,
        '--pull=never',
        '--read-only',
        '--read-only-tmpfs=false',
        '--network=none',
        '--pid=private',
        '--ipc=private',
        '--uts=private',
        '--cgroupns=private',
        '--userns=keep-id',
        `--user=${uid}:${gid}`,
        '--cap-drop=all',
        '--security-opt=no-new-privileges',
        '--security-opt=label=disable',
        '--memory=512m',
        '--memory-swap=512m',
        '--cpus=1',
        '--pids-limit=64',
        '--ulimit=nofile=256:256',
        '--ulimit=fsize=16777216:16777216',
        '--ulimit=core=0:0',
        '--image-volume=ignore',
        '--no-healthcheck',
        '--restart=no',
        '--http-proxy=false',
        '--unsetenv-all',
        '--no-hosts',
        '--log-driver=none',
        '--stop-timeout=0',
        `--timeout=${Math.ceil(this.limits.totalMs / 1_000)}`,
        '--interactive',
        '--workdir=/workspace',
        '--entrypoint=/usr/local/bin/node',
        '--umask=0077',
        ...['/workspace', '/state', '/tmp'].flatMap((path) => [
          '--tmpfs',
          `${path}:rw,noexec,nosuid,nodev,size=64m,mode=0700,uid=${uid},gid=${gid}`,
        ]),
        ...binds.flatMap(({ source, destination }) => [
          '--mount',
          `type=bind,src=${source},dst=${destination},ro=true`,
        ]),
        this.config.image,
        '/bootstrap.mjs',
        containerConfig,
      ];
      creationAttempted = true;
      const created = await command(argv);
      if (created.exitCode !== 0) {
        // Credential-free operator checks may opt in to local runtime diagnostics.
        // Execution requests never expose Podman stderr because it can contain host paths.
        if (!request && process.env.CRM_CODEX_SANDBOX_CONFORMANCE_DIAGNOSTICS === '1')
          process.stderr.write(created.stderr);
        throw new ExecutionError(
          'sandbox_unavailable',
          'The container could not be created with all required restrictions.',
        );
      }
      const inspected = await command(['inspect', '--type=container', name]);
      if (inspected.exitCode !== 0)
        throw new ExecutionError('sandbox_conformance_failed', 'The created container could not be inspected.');
      verifyContainerInspection(inspected.stdout, binds);
      let ready = false;
      let header = Buffer.alloc(0);
      const result = await command(['start', '--attach', '--interactive', name], {
        stdin: request?.prompt,
        onStdout: (chunk) => {
          if (ready) return onStdout ? onStdout(chunk) : false;
          header = Buffer.concat([header, chunk]);
          const newline = header.indexOf(10);
          if (newline < 0) {
            if (header.length > 1_024)
              throw new ExecutionError('sandbox_conformance_failed', 'Missing sandbox conformance report.');
            return false;
          }
          let report: unknown;
          try {
            report = JSON.parse(header.subarray(0, newline).toString('utf8'));
          } catch {
            /* Fail closed below. */
          }
          const failed = z
            .object({
              type: z.literal('sandbox.failed'),
              nonce: z.literal(nonce),
              code: z.enum(['sandbox_conformance_failed', 'incompatible_cli', 'unauthenticated', 'missing_executable']),
            })
            .safeParse(report);
          if (failed.success)
            throw new ExecutionError(
              failed.data.code,
              'Container preflight failed; provider diagnostics are withheld.',
            );
          if (
            !z.strictObject({ type: z.literal('sandbox.ready'), nonce: z.literal(nonce) }).safeParse(report).success
          ) {
            throw new ExecutionError(
              'sandbox_conformance_failed',
              'The container did not pass its live kernel probes.',
            );
          }
          ready = true;
          const remainder = header.subarray(newline + 1);
          // Bootstrap failures after the ready report are still a failure, never a successful generation.
          if (remainder.length && onStdout) onStdout(remainder);
          return true;
        },
      });
      if (!ready)
        throw new ExecutionError('sandbox_conformance_failed', 'No live sandbox conformance report was received.');
      if (result.exitCode !== 0)
        throw new ExecutionError('process_failed', 'Sandboxed CLI failed; provider diagnostics are withheld.');
    } finally {
      try {
        if (creationAttempted) await this.removeContainer(executable, env, name);
      } finally {
        await relay?.close();
        await rm(state, { recursive: true, force: true });
      }
    }
  }

  private async runtimeExecutable() {
    try {
      if (!isAbsolute(this.config.runtimeExecutable)) throw new Error('Absolute path required');
      const path = await realpath(this.config.runtimeExecutable);
      if (!(await lstat(path)).isFile()) throw new Error('Regular file required');
      await access(path, constants.X_OK);
      return path;
    } catch {
      throw new ExecutionError('sandbox_unavailable', 'An explicit local Podman executable is required.');
    }
  }

  private async authenticationFile(profile: string) {
    try {
      if (!isAbsolute(profile) || (await realpath(profile)) !== profile || profile === join(homedir(), '.codex'))
        throw new Error('Dedicated canonical path required');
      const directory = await lstat(profile);
      const names = await readdir(profile);
      const file = await lstat(join(profile, 'auth.json'));
      if (
        !directory.isDirectory() ||
        directory.uid !== process.getuid?.() ||
        (directory.mode & 0o077) !== 0 ||
        names.length !== 1 ||
        names[0] !== 'auth.json' ||
        !file.isFile() ||
        file.nlink !== 1 ||
        file.uid !== directory.uid ||
        (file.mode & 0o077) !== 0
      ) {
        throw new Error('Dedicated owner-only profile required');
      }
      return join(profile, 'auth.json');
    } catch {
      throw new ExecutionError(
        'invalid_request',
        'Authentication profile must be an owner-only directory containing only a regular owner-only auth.json.',
      );
    }
  }

  private async scopedSocket(path: string) {
    try {
      if (!isAbsolute(path) || (await realpath(path)) !== path) throw new Error('Canonical socket required');
      const socket = await lstat(path);
      const directory = await lstat(dirname(path));
      if (
        !socket.isSocket() ||
        socket.uid !== process.getuid?.() ||
        directory.uid !== socket.uid ||
        (directory.mode & 0o077) !== 0
      ) {
        throw new Error('Private runner socket required');
      }
      return path;
    } catch {
      throw new ExecutionError(
        'invalid_request',
        'CRM access requires a private runner-owned Unix capability relay socket.',
      );
    }
  }

  private async removeContainer(executable: string, env: NodeJS.ProcessEnv, name: string) {
    const limits = { ...defaults, firstEventMs: 2_000, idleMs: 2_000, totalMs: 5_000, maxOutputBytes: 16_384 };
    const budget: ProcessBudget = { deadline: Date.now() + limits.totalMs, outputBytes: 0 };
    try {
      const run = (argv: string[]) =>
        runBoundedProcess({ executable, argv: ['--remote=false', ...argv], cwd: '/', env, limits, budget });
      const removed = await run(['rm', '--force', '--ignore', '--time=0', name]);
      const exists = await run(['container', 'exists', name]);
      if (removed.exitCode !== 0 || exists.exitCode !== 1) throw new Error('Removal unconfirmed');
    } catch {
      throw new ExecutionError(
        'sandbox_cleanup_failed',
        'Container removal could not be confirmed. The runner must stop accepting work.',
      );
    }
  }
}

/** Inspect before start: reject image/default-config volume injection and namespace overrides. */
export function verifyContainerInspection(raw: string, binds: { source: string; destination: string }[]) {
  const inspectionSchema = z
    .array(
      z.object({
        HostConfig: z.object({
          Privileged: z.literal(false),
          ReadonlyRootfs: z.literal(true),
          NetworkMode: z.literal('none'),
          PidMode: z.literal('private'),
          IpcMode: z.literal('private'),
          CgroupnsMode: z.literal('private'),
          CapAdd: z.array(z.string()).nullable().optional(),
          Devices: z.array(z.unknown()).nullable().optional(),
          Binds: z.array(z.string()).nullable().optional(),
        }),
        Mounts: z.array(
          z.object({ Type: z.string(), Source: z.string().optional(), Destination: z.string(), RW: z.boolean() }),
        ),
      }),
    )
    .length(1);
  try {
    const [container] = inspectionSchema.parse(JSON.parse(raw));
    if (!container || container.HostConfig.CapAdd?.length || container.HostConfig.Devices?.length) {
      throw new Error('Unexpected inherited authority');
    }
    for (const mount of container.Mounts) {
      if (mount.Type === 'tmpfs' && ['/workspace', '/state', '/tmp'].includes(mount.Destination)) continue;
      if (
        mount.Type !== 'bind' ||
        mount.RW ||
        !binds.some((bind) => bind.source === mount.Source && bind.destination === mount.Destination)
      ) {
        throw new Error('Unexpected mount');
      }
    }
    if (
      binds.some(
        (bind) =>
          !container.Mounts.some(
            (mount) => mount.Source === bind.source && mount.Destination === bind.destination && !mount.RW,
          ),
      )
    ) {
      throw new Error('Missing protected mount');
    }
  } catch {
    throw new ExecutionError(
      'sandbox_conformance_failed',
      'Container inspection did not match the fixed sandbox manifest.',
    );
  }
}
