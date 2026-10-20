// Runs inside the container, before any provider CLI or prompt is read.
// This file is mounted read-only by the trusted runner; the image supplies Node and Codex.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, readlinkSync, statfsSync, writeFileSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';

const config = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'));
const fail = (code, detail) => {
  process.stdout.write(
    `${JSON.stringify({
      type: 'sandbox.failed',
      code,
      nonce: config.nonce,
      ...(config.diagnostics && detail ? { detail } : {}),
    })}\n`,
  );
  process.exit(70);
};

function conform() {
  const status = readFileSync('/proc/self/status', 'utf8');
  if (
    !['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].every((name) =>
      new RegExp(`^${name}:\\s+0+$`, 'm').test(status),
    ) ||
    !/^NoNewPrivs:\s+1$/m.test(status) ||
    !/^Seccomp:\s+2$/m.test(status)
  ) {
    throw new Error('Process restrictions are missing');
  }
  if (process.getuid() === 0 || process.getuid() !== config.uid) throw new Error('Unexpected container identity');
  const uidMap = readFileSync('/proc/self/uid_map', 'utf8').trim();
  if (/^0\s+0\s+4294967295$/.test(uidMap)) throw new Error('No user namespace');
  for (const [name, hostNamespace] of Object.entries(config.namespaces)) {
    if (readlinkSync(`/proc/self/ns/${name}`) === hostNamespace) throw new Error('Host namespace is shared');
  }
  if (Object.keys(networkInterfaces()).some((name) => name !== 'lo')) throw new Error('Network is connected');
  // The actual kernel limits must exist; accepting argv or `podman info` is insufficient.
  const cgroup = '/sys/fs/cgroup';
  if (readFileSync(`${cgroup}/memory.max`, 'utf8').trim() !== String(config.memoryBytes))
    throw new Error('Memory limit');
  if (readFileSync(`${cgroup}/memory.swap.max`, 'utf8').trim() !== '0') throw new Error('Swap is enabled');
  if (readFileSync(`${cgroup}/pids.max`, 'utf8').trim() !== String(config.pids)) throw new Error('PID limit');
  const [quota, period] = readFileSync(`${cgroup}/cpu.max`, 'utf8').trim().split(/\s+/).map(Number);
  if (!Number.isFinite(quota) || !Number.isFinite(period) || period <= 0 || quota <= 0 || quota > period)
    throw new Error('CPU limit');
  const mounts = readFileSync('/proc/self/mountinfo', 'utf8').split('\n').filter(Boolean);
  const allowedMounts = new Set([
    '/',
    '/workspace',
    '/state',
    '/tmp',
    '/proc',
    '/sys',
    '/sys/fs/cgroup',
    '/dev',
    '/dev/pts',
    '/dev/shm',
    '/dev/mqueue',
    '/etc/hosts',
    '/etc/hostname',
    '/etc/resolv.conf',
    '/run/.containerenv',
    '/bootstrap.mjs',
    '/relay/egress.sock',
    '/relay/mcp.sock',
    '/runner-auth.json',
  ]);
  for (const mount of mounts) {
    const path = mount.split(' ')[4];
    // OCI runtimes add protected proc/sys masks. Other image/default-config mounts fail closed.
    if (!allowedMounts.has(path) && !path.startsWith('/proc/') && !path.startsWith('/sys/')) {
      throw new Error('Unexpected runtime mount');
    }
  }
  const root = mounts.find((line) => line.split(' ')[4] === '/');
  if (!root || !root.split(' ')[5].split(',').includes('ro')) throw new Error('Writable root');
  for (const path of ['/workspace', '/state', '/tmp']) {
    const mount = mounts.find((line) => line.split(' ')[4] === path);
    if (!mount || !mount.includes(' - tmpfs ') || !mount.split(' ')[5].split(',').includes('noexec')) {
      throw new Error('Work directories are not bounded tmpfs');
    }
    const filesystem = statfsSync(path);
    if (filesystem.blocks * filesystem.bsize > 67_108_864) throw new Error('Unbounded tmpfs');
    writeFileSync(`${path}/.conformance`, 'ok', { flag: 'wx', mode: 0o600 });
  }
  try {
    readFileSync(config.hostProbePath);
    throw new Error('Host filesystem is visible');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    writeFileSync('/.sandbox-write-must-fail', 'unsafe', { flag: 'wx' });
    throw new Error('Root write succeeded');
  } catch (error) {
    if (!['EROFS', 'EACCES'].includes(error.code)) throw error;
  }
  // A fresh PID namespace cannot expose host processes; inspect supplies the other namespace checks.
  const visibleProcesses = readdirSync('/proc').filter((name) => /^\d+$/.test(name));
  if (visibleProcesses.length > 4 || readlinkSync('/proc/1/ns/pid') !== readlinkSync('/proc/self/ns/pid')) {
    throw new Error('Unexpected process namespace');
  }
  if (process.env.CRM_SANDBOX_SENTINEL !== undefined) throw new Error('Ambient environment');
  mkdirSync('/state/home', { mode: 0o700 });
  mkdirSync('/state/codex', { recursive: true, mode: 0o700 });
}

try {
  conform();
} catch (error) {
  fail('sandbox_conformance_failed', error instanceof Error ? error.message : 'unknown probe failure');
}
const ready = () => process.stdout.write(`${JSON.stringify({ type: 'sandbox.ready', nonce: config.nonce })}\n`);
if (config.probeOnly) {
  ready();
  process.exit(0);
}

if (config.authenticated) {
  writeFileSync('/state/codex/auth.json', readFileSync('/runner-auth.json'), { flag: 'wx', mode: 0o600 });
}

function bridge(socketPath) {
  return new Promise((resolve, reject) => {
    const server = createServer((incoming) => {
      const upstream = createConnection(socketPath);
      const destroy = () => {
        incoming.destroy();
        upstream.destroy();
      };
      incoming.on('error', destroy);
      upstream.on('error', destroy);
      incoming.on('close', () => upstream.destroy());
      upstream.on('close', () => incoming.destroy());
      incoming.pipe(upstream).pipe(incoming);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

const proxyPort = await bridge('/relay/egress.sock');
// No inherited image environment, startup hooks, proxy bypass, or profile configuration.
const env = {
  PATH: '/usr/local/bin:/usr/bin:/bin',
  HOME: '/state/home',
  CODEX_HOME: '/state/codex',
  TMPDIR: '/tmp',
  XDG_CONFIG_HOME: '/state/home',
  XDG_CACHE_HOME: '/state/home',
  XDG_DATA_HOME: '/state/home',
  LANG: 'C.UTF-8',
  NO_COLOR: '1',
  HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
  HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
  NO_PROXY: '127.0.0.1,localhost',
};
const check = (args) =>
  spawnSync('/usr/local/bin/codex', args, {
    cwd: '/workspace',
    env,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 16_384,
  });
const version = check(['--version']);
if (version.status !== 0 || version.stdout.trim() !== `codex-cli ${config.version}`) fail('incompatible_cli');
const help = check(['exec', '--help']);
if (
  help.status !== 0 ||
  !['--json', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--strict-config'].every((flag) =>
    help.stdout.includes(flag),
  )
) {
  fail('incompatible_cli');
}
const auth = check(['login', 'status', '-c', 'cli_auth_credentials_store="file"']);
if (auth.status !== 0) fail('unauthenticated');
if (!/^Logged in using (ChatGPT|an API key)\b/m.test(`${auth.stdout}\n${auth.stderr}`)) fail('incompatible_cli');
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
  'project_doc_max_bytes=0',
  '-c',
  'cli_auth_credentials_store="file"',
  '-c',
  'shell_environment_policy.inherit="none"',
  '-c',
  'mcp_servers={}',
  ...config.disabledFeatures.flatMap((name) => ['--disable', name]),
];
if (config.scopedMcp) {
  const mcpPort = await bridge('/relay/mcp.sock');
  args.push('-c', `mcp_servers.crm.url="http://127.0.0.1:${mcpPort}/mcp"`);
}
args.push('-');
ready();
const cli = spawn('/usr/local/bin/codex', args, { cwd: '/workspace', env, stdio: 'inherit', shell: false });
cli.on('error', () => fail('missing_executable'));
cli.on('exit', (code, signal) => process.exit(signal ? 71 : (code ?? 71)));
