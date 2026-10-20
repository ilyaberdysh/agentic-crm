import { constants } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import {
  type ExecutionAdapter,
  ExecutionError,
  type ExecutionEvent,
  type ExecutionLimits,
  type ExecutionResult,
  type SyntheticExecutionRequest,
} from './contract.js';
import { type ProcessBudget, runBoundedProcess } from './process.js';

const requestSchema = z.strictObject({
  dataClass: z.literal('synthetic'),
  prompt: z.string().min(1).max(16_384),
  workingDirectory: z.string().min(1),
  nativeTools: z.literal('disabled'),
  crmAccess: z.literal('disabled'),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
});
const limitsSchema = z.strictObject({
  firstEventMs: z.number().int().min(1).max(120_000),
  idleMs: z.number().int().min(1).max(120_000),
  totalMs: z.number().int().min(1).max(300_000),
  maxOutputBytes: z.number().int().min(1).max(1_048_576),
  killGraceMs: z.number().int().min(1).max(1_000),
});
const configSchema = z.strictObject({
  executable: z.string().min(1),
  /** Dedicated CLI-owned profile: initially empty or containing only auth.json; never ~/.codex. */
  authenticationHome: z.string().min(1).optional(),
  limits: limitsSchema.partial().optional(),
});
const defaults: ExecutionLimits = {
  firstEventMs: 15_000,
  idleMs: 30_000,
  totalMs: 90_000,
  maxOutputBytes: 262_144,
  killGraceMs: 100,
};

/** Fixed manifest, not user-configurable argv. Future CLI versions require conformance review. */
const supportedVersion = '0.163.0';
const disabledFeatures = [
  'shell_tool',
  'shell_snapshot',
  'view_image',
  'apps',
  'plugins',
  'remote_plugin',
  'hooks',
  'multi_agent',
  'multi_agent_v2',
  'browser_use',
  'computer_use',
  'in_app_browser',
  'image_generation',
  'code_mode',
  'code_mode_host',
  'memories',
  'goals',
  'skill_search',
  'skill_mcp_dependency_install',
  'tool_suggest',
];

const tokenCount = z.number().int().nonnegative().nullable().optional();
const itemSchema = z.object({
  type: z.enum(['agent_message', 'reasoning']),
  text: z.string().optional(),
});
const eventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('thread.started'), thread_id: z.string().min(1).max(200) }),
  z.object({ type: z.literal('turn.started') }),
  z.object({ type: z.enum(['item.started', 'item.updated', 'item.completed']), item: itemSchema }),
  z.object({
    type: z.literal('turn.completed'),
    usage: z.object({ input_tokens: tokenCount, output_tokens: tokenCount }).optional(),
  }),
  z.object({ type: z.enum(['error', 'turn.failed']), message: z.string().optional(), error: z.unknown().optional() }),
]);

function providerError(text: string): ExecutionError {
  if (/unauthorized|unauthenticated|not logged in|login required|401|authentication/i.test(text)) {
    return new ExecutionError(
      'unauthenticated',
      'Codex CLI authentication is unavailable or expired. Sign in locally.',
    );
  }
  if (/unexpected argument|unknown (?:variant|field|feature)|unrecognized|invalid.*config/i.test(text)) {
    return new ExecutionError('incompatible_cli', 'Codex CLI rejected the fixed experiment manifest.');
  }
  return new ExecutionError('process_failed', 'Codex CLI execution failed. Raw provider diagnostics are withheld.');
}

/** Strict JSONL framing and state machine; raw event payloads never become domain state. */
class CodexEvents {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private pending = '';
  private started = false;
  private terminal = false;
  sessionId = '';
  text = '';
  inputTokens: number | null = null;
  outputTokens: number | null = null;

  constructor(private readonly emit: (event: ExecutionEvent) => void) {}

  push(chunk: Buffer): boolean {
    this.pending += this.decoder.decode(chunk, { stream: true });
    let count = 0;
    let newline = this.pending.indexOf('\n');
    while (newline >= 0) {
      const line = this.pending.slice(0, newline).trim();
      this.pending = this.pending.slice(newline + 1);
      if (line) {
        this.line(line);
        count++;
      }
      newline = this.pending.indexOf('\n');
    }
    return count > 0;
  }

  finish() {
    try {
      this.pending += this.decoder.decode();
      if (this.pending.trim()) this.line(this.pending.trim());
    } catch (error) {
      if (error instanceof ExecutionError) throw error;
      throw new ExecutionError('invalid_output', 'CLI emitted invalid UTF-8 or JSONL.');
    }
    if (!this.terminal) throw new ExecutionError('disconnected', 'CLI exited before a terminal generation event.');
  }

  private line(line: string) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new ExecutionError('invalid_output', 'CLI emitted malformed JSONL.');
    }
    const envelope = z.object({ type: z.string(), item: z.object({ type: z.string() }).optional() }).safeParse(raw);
    if (envelope.success && envelope.data.item && !['agent_message', 'reasoning'].includes(envelope.data.item.type)) {
      throw new ExecutionError('native_tool_denied', 'CLI emitted a forbidden tool or artifact event.');
    }
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success) throw new ExecutionError('invalid_output', 'CLI emitted an unsupported event shape.');
    const event = parsed.data;
    if (this.terminal) throw new ExecutionError('invalid_output', 'CLI emitted an event after the terminal event.');
    if (event.type === 'error' || event.type === 'turn.failed') throw providerError(JSON.stringify(event));
    if (event.type === 'thread.started') {
      if (this.sessionId) throw new ExecutionError('invalid_output', 'CLI repeated the session start.');
      this.sessionId = event.thread_id;
      this.emit({ type: 'started', sessionId: this.sessionId });
    } else if (event.type === 'turn.started') {
      if (!this.sessionId || this.started) throw new ExecutionError('invalid_output', 'CLI turn ordering is invalid.');
      this.started = true;
    } else {
      if (!this.started) throw new ExecutionError('invalid_output', 'CLI emitted content before the turn started.');
      if (event.type === 'turn.completed') {
        this.terminal = true;
        this.inputTokens = event.usage?.input_tokens ?? null;
        this.outputTokens = event.usage?.output_tokens ?? null;
      } else if ('item' in event && event.type === 'item.completed' && event.item.type === 'agent_message') {
        if (event.item.text === undefined) throw new ExecutionError('invalid_output', 'CLI message is missing text.');
        this.text += event.item.text;
        this.emit({ type: 'text', text: event.item.text });
      }
    }
  }
}

export interface CodexCliExperimentConfig {
  executable: string;
  authenticationHome?: string;
  limits?: Partial<ExecutionLimits>;
}

export class CodexCliExperiment implements ExecutionAdapter {
  readonly kind = 'local-experiment';
  private readonly config: CodexCliExperimentConfig;
  private readonly limits: ExecutionLimits;

  constructor(config: CodexCliExperimentConfig) {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) throw new ExecutionError('invalid_request', 'Invalid CLI experiment configuration.');
    this.config = parsed.data;
    this.limits = limitsSchema.parse({ ...defaults, ...parsed.data.limits });
  }

  async execute(request: SyntheticExecutionRequest, onEvent: (event: ExecutionEvent) => void = () => {}) {
    const input = requestSchema.safeParse(request);
    if (!input.success) throw new ExecutionError('invalid_request', 'Only bounded synthetic generation is supported.');
    if (process.platform === 'win32')
      throw new ExecutionError('incompatible_cli', 'POSIX process groups are required.');
    if (request.signal?.aborted) throw new ExecutionError('canceled', 'Execution canceled.');
    const budget: ProcessBudget = { deadline: Date.now() + this.limits.totalMs, outputBytes: 0 };
    const executable = await this.resolveExecutable();
    const cwd = await this.emptyDirectory(request.workingDirectory);
    let authHome: string | undefined;
    if (this.config.authenticationHome) {
      authHome = await this.authenticationHome(this.config.authenticationHome);
      if (authHome === cwd)
        throw new ExecutionError('invalid_request', 'Authentication and working directories must differ.');
    }
    const state = await mkdtemp(join(cwd, '.cli-experiment-'));
    try {
      for (const directory of ['home', 'codex', 'tmp']) await mkdir(join(state, directory), { mode: 0o700 });
      const env: NodeJS.ProcessEnv = {
        PATH: '/usr/bin:/bin',
        HOME: join(state, 'home'),
        CODEX_HOME: authHome ?? join(state, 'codex'),
        TMPDIR: join(state, 'tmp'),
        XDG_CONFIG_HOME: join(state, 'home'),
        XDG_DATA_HOME: join(state, 'home'),
        XDG_CACHE_HOME: join(state, 'home'),
        LANG: 'C.UTF-8',
        NO_COLOR: '1',
      };
      const run = (argv: string[], extra: { stdin?: string; onStdout?: (chunk: Buffer) => boolean } = {}) =>
        runBoundedProcess({
          executable,
          argv,
          cwd,
          env,
          limits: this.limits,
          budget,
          signal: request.signal,
          ...extra,
        });
      const version = await run(['--version']);
      if (version.exitCode !== 0 || version.stdout.trim() !== `codex-cli ${supportedVersion}`) {
        throw new ExecutionError('incompatible_cli', `CLI experiment requires codex-cli ${supportedVersion}.`);
      }
      const help = await run(['exec', '--help']);
      if (
        help.exitCode !== 0 ||
        !['--json', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config'].every((flag) =>
          help.stdout.includes(flag),
        )
      ) {
        throw new ExecutionError('incompatible_cli', 'Codex CLI lacks required experiment flags.');
      }
      // No login, token read/copy, credential upload, or inherited user config.
      const auth = await run(['login', 'status', '-c', 'cli_auth_credentials_store="file"']);
      if (auth.exitCode !== 0) throw providerError(`${auth.stdout}\n${auth.stderr}`);
      if (!/^Logged in using (ChatGPT|an API key)\b/m.test(`${auth.stdout}\n${auth.stderr}`)) {
        throw new ExecutionError('incompatible_cli', 'Codex CLI returned an unrecognized authentication status.');
      }
      const events = new CodexEvents(onEvent);
      const args = [
        'exec',
        '--json',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--strict-config',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--color',
        'never',
        '-c',
        'approval_policy="never"',
        '-c',
        'web_search="disabled"',
        '-c',
        'mcp_servers={}',
        '-c',
        'project_doc_max_bytes=0',
        '-c',
        'cli_auth_credentials_store="file"',
        '-c',
        'shell_environment_policy.inherit="none"',
        ...disabledFeatures.flatMap((feature) => ['--disable', feature]),
        '-',
      ];
      const result = await run(args, {
        stdin: `Synthetic generation-only experiment. Use no tools; do not access files, shell, network, MCP, or CRM.\n\n${request.prompt}`,
        onStdout: (chunk) => events.push(chunk),
      });
      if (result.exitCode !== 0) throw providerError(result.stderr);
      events.finish();
      // Publish completion only after successful process exit, framing validation, and group cleanup.
      onEvent({ type: 'completed', inputTokens: events.inputTokens, outputTokens: events.outputTokens });
      return {
        adapter: 'codex-cli-experiment-v1',
        executableVersion: supportedVersion,
        sessionId: events.sessionId,
        text: events.text,
        inputTokens: events.inputTokens,
        outputTokens: events.outputTokens,
        cost: 'unknown',
        executionHost: 'local-experiment',
        dataDestination: 'cli-vendor',
        isolation: 'not-production-sandboxed',
      } satisfies ExecutionResult;
    } finally {
      await rm(state, { recursive: true, force: true });
    }
  }

  private async resolveExecutable() {
    if (!isAbsolute(this.config.executable)) {
      throw new ExecutionError('invalid_request', 'Codex executable must be an explicitly configured absolute path.');
    }
    try {
      const path = await realpath(this.config.executable);
      if (!(await lstat(path)).isFile()) throw new Error('Not a regular executable');
      await access(path, constants.X_OK);
      return path;
    } catch {
      throw new ExecutionError('missing_executable', 'Configured Codex executable is missing or not executable.');
    }
  }

  private async emptyDirectory(path: string) {
    try {
      if (!isAbsolute(path) || !(await lstat(path)).isDirectory()) throw new Error('Not an absolute real directory');
      const resolved = await realpath(path);
      if ((await readdir(resolved)).length) throw new Error('Not empty');
      return resolved;
    } catch {
      throw new ExecutionError('invalid_request', 'Working directory must be an existing empty absolute directory.');
    }
  }

  private async authenticationHome(path: string) {
    try {
      if (!isAbsolute(path) || !(await lstat(path)).isDirectory()) throw new Error('Not an absolute real directory');
      const resolved = await realpath(path);
      const names = await readdir(resolved);
      if (names.some((name) => name !== 'auth.json')) throw new Error('Not an isolated authentication profile');
      if (names.length && !(await lstat(join(resolved, 'auth.json'))).isFile())
        throw new Error('Not a regular auth file');
      return resolved;
    } catch {
      throw new ExecutionError(
        'invalid_request',
        'Authentication profile must be dedicated and contain only CLI-owned auth.json.',
      );
    }
  }
}
