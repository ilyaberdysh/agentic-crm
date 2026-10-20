// Protocol fixture only. Passing these tests never establishes real kernel isolation.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const mode = basename(process.argv[1], '.mjs');
const path = `${process.argv[1]}.state`;
const args = process.argv.slice(2);
if (args.shift() !== '--remote=false') process.exit(90);
const command = args.shift();
const load = () => JSON.parse(readFileSync(path, 'utf8'));
if (command === 'info') {
  console.log(
    JSON.stringify({
      host: { os: 'linux', cgroupVersion: 'v2', security: { rootless: mode !== 'rootful' } },
      version: { Version: mode === 'old-runtime' ? '5.6.2' : '5.7.0' },
    }),
  );
} else if (command === 'create') {
  writeFileSync(path, JSON.stringify({ args, env: process.env }));
  console.log('fixture-container');
} else if (command === 'inspect') {
  const state = load();
  const mounts = state.args.flatMap((value, index) => {
    if (value !== '--mount') return [];
    const fields = Object.fromEntries(state.args[index + 1].split(',').map((field) => field.split('=')));
    return [{ Type: 'bind', Source: fields.src, Destination: fields.dst, RW: mode === 'writable-bind' }];
  });
  if (mode === 'injected-volume')
    mounts.push({ Type: 'bind', Source: '/home/secret', Destination: '/secret', RW: false });
  console.log(
    JSON.stringify([
      {
        HostConfig: {
          Privileged: false,
          ReadonlyRootfs: true,
          NetworkMode: mode === 'host-network' ? 'host' : 'none',
          PidMode: 'private',
          IpcMode: 'private',
          CgroupnsMode: 'private',
          CapAdd: [],
          Devices: [],
          Binds: [],
        },
        Mounts: mounts,
      },
    ]),
  );
} else if (command === 'start') {
  const state = load();
  const config = JSON.parse(Buffer.from(state.args.at(-1), 'base64url').toString('utf8'));
  if (mode === 'timeout') {
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1_000);
  } else if (mode === 'failed-probe')
    console.log(JSON.stringify({ type: 'sandbox.failed', nonce: config.nonce, code: 'sandbox_conformance_failed' }));
  else if (mode === 'missing-probe') console.log('{}');
  else {
    console.log(JSON.stringify({ type: 'sandbox.ready', nonce: mode === 'wrong-nonce' ? 'bad' : config.nonce }));
    if (!config.probeOnly) {
      let prompt = '';
      for await (const chunk of process.stdin) prompt += chunk;
      const emit = (value) => console.log(JSON.stringify(value));
      emit({ type: 'thread.started', thread_id: 'sandbox-fixture' });
      emit({ type: 'turn.started' });
      if (mode === 'native-tool') emit({ type: 'item.started', item: { type: 'command_execution' } });
      if (config.scopedMcp)
        emit({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'crm', tool: 'crm.task.create' } });
      emit({
        type: 'item.completed',
        item: { type: 'agent_message', text: JSON.stringify({ args: state.args, env: state.env, prompt }) },
      });
      emit({ type: 'turn.completed' });
    }
  }
} else if (command === 'rm') {
  if (mode === 'failed-cleanup') process.exitCode = 2;
  else rmSync(path, { force: true });
} else if (command === 'container' && args[0] === 'exists') process.exitCode = existsSync(path) ? 0 : 1;
else process.exitCode = 91;
