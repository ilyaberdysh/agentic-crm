import { chmod, chown, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexContainerSandbox } from '../src/ai/execution/codex-container.js';
import { createVendorRelay, isEgressHostname, resolveEgressAddress } from '../src/ai/execution/vendor-relay.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readlink: (path: string) =>
      path.startsWith('/proc/self/ns/') ? Promise.resolve(`host:${path}`) : actual.readlink(path),
  };
});
const fixture = await readFile(new URL('./fixtures/podman.mjs', import.meta.url), 'utf8');
const image = `example.com/crm/codex@sha256:${'a'.repeat(64)}`;
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalUid = process.getuid?.() ?? 1_000;
let root: string;
let profile: string;
let rootlessUid: number;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'crm-container-test-')));
  profile = join(root, 'auth-profile');
  await mkdir(profile, { mode: 0o700 });
  await writeFile(join(profile, 'auth.json'), 'not-a-real-credential', { mode: 0o600 });
  rootlessUid = originalUid || 1_000;
  if (!originalUid) {
    await chown(profile, rootlessUid, 0);
    await chown(join(profile, 'auth.json'), rootlessUid, 0);
  }
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.spyOn(process, 'getuid').mockReturnValue(rootlessUid);
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  await rm(root, { recursive: true, force: true });
});
async function sandbox(mode = 'success', totalMs = 10_000) {
  const runtimeExecutable = join(root, `${mode}.mjs`);
  await writeFile(runtimeExecutable, `#!${process.execPath}\n${fixture}`, { mode: 0o700 });
  return new CodexContainerSandbox({
    runtimeExecutable,
    image,
    authenticationProfile: profile,
    egressHosts: ['api.openai.com'],
    limits: { totalMs, firstEventMs: 3_000, idleMs: 3_000, killGraceMs: 20 },
  });
}
const request = {
  dataClass: 'synthetic',
  prompt: 'SYNTHETIC $(literal) `literal`',
  nativeTools: 'disabled',
  crmAccess: 'disabled',
} as const;

describe('runner container sandbox protocol (fake runtime, not conformance evidence)', () => {
  it('uses the fixed restrictive manifest, private profile, stdin prompt and confirmed removal', async () => {
    const result = await (await sandbox()).execute(request);
    const observed = JSON.parse(result.text);
    expect(result).toMatchObject({
      isolation: 'rootless-container',
      executionHost: 'paired-runner',
      cost: 'unknown',
      inputTokens: null,
    });
    expect(observed.prompt).toBe(request.prompt);
    expect(observed.args).not.toContain(request.prompt);
    expect(observed.args).toEqual(
      expect.arrayContaining([
        '--pull=never',
        '--read-only',
        '--network=none',
        '--pid=private',
        '--cgroupns=private',
        '--userns=keep-id',
        '--cap-drop=all',
        '--security-opt=no-new-privileges',
        '--memory=512m',
        '--memory-swap=512m',
        '--pids-limit=64',
        '--cpus=1',
        '--image-volume=ignore',
        '--unsetenv-all',
        '--log-driver=none',
      ]),
    );
    const authMount = observed.args.find((arg: string) => arg.includes('dst=/state/codex/auth.json'));
    expect(authMount).toBe(`type=bind,src=${profile}/auth.json,dst=/state/codex/auth.json,ro=true`);
    expect(
      Object.keys(observed.env)
        .filter((key) => key !== '__CF_USER_TEXT_ENCODING')
        .sort(),
    ).toEqual(['HOME', 'LANG', 'NO_COLOR', 'PATH', 'XDG_RUNTIME_DIR']);
    expect(await readdir(root)).not.toContain('success.mjs.state');
  });

  it('checks the live report in credential-free conformance mode', async () => {
    await expect((await sandbox()).checkConformance()).resolves.toMatchObject({
      boundary: 'rootless-podman-v1',
      image,
    });
  });

  it.each([
    ['rootful', 'sandbox_unavailable'],
    ['old-runtime', 'sandbox_unavailable'],
    ['host-network', 'sandbox_conformance_failed'],
    ['injected-volume', 'sandbox_conformance_failed'],
    ['writable-bind', 'sandbox_conformance_failed'],
    ['failed-probe', 'sandbox_conformance_failed'],
    ['missing-probe', 'sandbox_conformance_failed'],
    ['wrong-nonce', 'sandbox_conformance_failed'],
    ['failed-cleanup', 'sandbox_cleanup_failed'],
    ['native-tool', 'native_tool_denied'],
  ])('fails closed for %s and withholds completion', async (mode, code) => {
    const completed: string[] = [];
    await expect((await sandbox(mode)).execute(request, (event) => completed.push(event.type))).rejects.toMatchObject({
      code,
    });
    expect(completed).not.toContain('completed');
    if (mode !== 'failed-cleanup') expect(await readdir(root)).not.toContain(`${mode}.mjs.state`);
  });

  it('removes the container after a deadline despite an uncooperative runtime process', async () => {
    await expect((await sandbox('timeout', 800)).execute(request)).rejects.toMatchObject({ code: 'total_timeout' });
    expect(await readdir(root)).not.toContain('timeout.mjs.state');
  });

  it('removes the container after cancellation and never publishes completion', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 600);
    try {
      await expect((await sandbox('timeout')).execute({ ...request, signal: controller.signal })).rejects.toMatchObject(
        { code: 'canceled' },
      );
      expect(await readdir(root)).not.toContain('timeout.mjs.state');
    } finally {
      clearTimeout(timer);
    }
  });

  it('rejects CRM text without a matching runner-owned capability relay', async () => {
    const runner = await sandbox();
    await expect(runner.execute({ ...request, dataClass: 'crm' } as never)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    const scope = {
      runnerId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      taskId: '00000000-0000-4000-8000-000000000003',
      leaseGeneration: 1,
    };
    await expect(
      runner.execute({
        ...request,
        dataClass: 'crm',
        crmAccess: 'scoped-mcp',
        scope,
        relay: { socketPath: '/missing.sock', scope: { ...scope, leaseGeneration: 2 } },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('passes only the lease-scoped MCP socket and permits its events for a CRM request', async () => {
    const directory = join(root, 'mcp');
    await mkdir(directory, { mode: 0o700 });
    if (!originalUid) await chown(directory, rootlessUid, 0);
    const socketPath = join(directory, 'mcp.sock');
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    if (!originalUid) await chown(socketPath, rootlessUid, 0);
    const scope = {
      runnerId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      taskId: '00000000-0000-4000-8000-000000000003',
      leaseGeneration: 1,
    };
    try {
      const result = await (await sandbox()).execute({
        ...request,
        dataClass: 'crm',
        crmAccess: 'scoped-mcp',
        scope,
        relay: { socketPath, scope },
      });
      expect(JSON.parse(result.text).args).toContain(`type=bind,src=${socketPath},dst=/relay/mcp.sock,ro=true`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects shared profiles and runtime overrides, and fails closed on unsupported hosts', async () => {
    await chmod(profile, 0o755);
    await expect((await sandbox()).execute(request)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(
      () =>
        new CodexContainerSandbox({
          runtimeExecutable: '/usr/bin/podman',
          image: 'latest',
          egressHosts: ['api.openai.com'],
        }),
    ).toThrow();
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    await expect((await sandbox()).checkConformance()).rejects.toMatchObject({ code: 'sandbox_unavailable' });
  });
});

describe('vendor egress policy', () => {
  it.each([
    'localhost',
    '*.openai.com',
    'API.openai.com',
    'https://api.openai.com',
    'api.openai.com:443',
    '127.0.0.1',
    'a..com',
  ])('rejects ambiguous destination %s', (name) => {
    expect(isEgressHostname(name)).toBe(false);
  });
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '100.64.1.2',
    '192.168.1.2',
    '198.19.0.1',
    '224.0.0.1',
    '0.0.0.0',
  ])('rejects private/reserved DNS answer %s', async (address) => {
    await expect(resolveEgressAddress('api.openai.com', async () => [{ address, family: 4 }])).rejects.toMatchObject({
      code: 'sandbox_unavailable',
    });
  });
  it('pins a numeric public address and rejects a mixed public/private or IPv6 answer', async () => {
    await expect(resolveEgressAddress('api.openai.com', async () => [{ address: '8.8.8.8', family: 4 }])).resolves.toBe(
      '8.8.8.8',
    );
    await expect(
      resolveEgressAddress('api.openai.com', async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toThrow();
    await expect(resolveEgressAddress('api.openai.com', async () => [{ address: '::1', family: 6 }])).rejects.toThrow();
  });
  it('refuses starting a relay with a wildcard allowlist', async () => {
    await expect(createVendorRelay(join(root, 'invalid.sock'), ['*.openai.com'])).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it.each([
    'CONNECT 127.0.0.1:443 HTTP/1.1',
    'CONNECT api.openai.com:80 HTTP/1.1',
    'CONNECT api.openai.com.evil.test:443 HTTP/1.1',
    'GET http://169.254.169.254/ HTTP/1.1',
  ])('denies the actual Unix relay request %s without reaching a destination', async (line) => {
    const socketPath = join(root, 'egress.sock');
    const relay = await createVendorRelay(socketPath, ['api.openai.com']);
    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = createConnection(socketPath);
        let response = '';
        socket.setTimeout(1_000, () => {
          socket.destroy();
          reject(new Error('Relay did not reject request'));
        });
        socket.on('data', (chunk) => {
          response += chunk.toString();
        });
        socket.on('error', reject);
        socket.on('end', () => resolve(response));
        socket.on('connect', () => socket.write(`${line}\r\nHost: api.openai.com\r\nConnection: close\r\n\r\n`));
      });
      expect(response).toContain('403');
    } finally {
      await relay.close();
    }
  });
});
