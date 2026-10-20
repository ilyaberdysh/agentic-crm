// Tests install this fixture with an absolute Node shebang. It never contacts a provider.
import { spawn } from 'node:child_process';
import { basename } from 'node:path';

const mode = basename(process.argv[1], '.mjs');
const args = process.argv.slice(2);
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const started = () => {
  emit({ type: 'thread.started', thread_id: 'synthetic-session' });
  emit({ type: 'turn.started' });
};
const text = (value) => emit({ type: 'item.completed', item: { type: 'agent_message', text: value } });
const done = () => emit({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 3 } });

if (args[0] === '--version') {
  console.log(mode === 'old' ? 'codex-cli 0.1.0' : 'codex-cli 0.163.0');
} else if (args[0] === 'exec' && args[1] === '--help') {
  console.log(
    mode === 'bad-help' ? '--json' : '--json --ephemeral --ignore-user-config --ignore-rules --strict-config',
  );
} else if (args[0] === 'login') {
  if (mode === 'no-auth') {
    console.error('Not logged in: do not disclose fixture-secret');
    process.exitCode = 1;
  } else if (mode === 'bad-auth') console.log('unexpected status');
  else console.error('Logged in using ChatGPT');
} else {
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  if (mode === 'first-timeout') setInterval(() => process.stderr.write('.'), 10);
  else if (mode === 'stdout-flood') process.stdout.write('x'.repeat(65_536));
  else if (mode === 'stderr-flood') process.stderr.write('x'.repeat(65_536));
  else if (mode === 'invalid-json') console.log('{oops');
  else if (mode === 'invalid-utf8') process.stdout.write(Buffer.from([0xff, 10]));
  else if (mode === 'signal') process.kill(process.pid, 'SIGTERM');
  else {
    started();
    if (mode === 'idle-timeout') setInterval(() => process.stderr.write('.'), 10);
    else if (mode === 'total-timeout') {
      setInterval(() => emit({ type: 'item.updated', item: { type: 'reasoning' } }), 10);
    } else if (mode === 'tool')
      emit({ type: 'item.started', item: { type: 'command_execution', command: 'never execute' } });
    else if (mode === 'unknown') emit({ type: 'future.event' });
    else if (mode === 'auth-expired') emit({ type: 'error', message: '401 fixture-secret' });
    else if (mode === 'missing-terminal') text('partial');
    else if (mode === 'descendant' || mode === 'descendant-success') {
      process.on('SIGTERM', () => {});
      const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      // Allow the child to register its SIGTERM handler before advertising its PID.
      setTimeout(() => {
        text(String(child.pid));
        if (mode === 'descendant-success') {
          done();
          process.exit(0);
        }
      }, 50);
      setInterval(() => {}, 1000);
    } else if (mode === 'split') {
      const bytes = Buffer.from(
        `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'синтетика' } })}\n`,
      );
      const cut = bytes.indexOf(Buffer.from('с')) + 1;
      process.stdout.write(bytes.subarray(0, cut));
      setTimeout(() => {
        process.stdout.write(bytes.subarray(cut));
        // Valid last line without newline.
        process.stdout.write(JSON.stringify({ type: 'turn.completed' }));
      }, 5);
    } else {
      text(
        mode === 'inspect'
          ? JSON.stringify({ args, prompt, env: process.env, cwd: process.cwd() })
          : 'Synthetic answer',
      );
      done();
      if (mode === 'duplicate-terminal') done();
      if (mode === 'nonzero') {
        console.error('provider failed fixture-secret');
        process.exitCode = 2;
      }
    }
  }
}
