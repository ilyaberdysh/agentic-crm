import { readFile } from 'node:fs/promises';
import { CodexContainerSandbox } from '@agentic-crm/domain/runner/sandbox';
import { enroll, readConfig, readIdentity } from './config.ts';
import { RunnerDaemon } from './daemon.ts';

// Credentials are read from a private file, never argv/environment or diagnostics.
const [command, configPath, tokenPath] = process.argv.slice(2);
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
try {
  if (
    !configPath ||
    !['enroll', 'run', 'check'].includes(command ?? '') ||
    (command === 'enroll' ? !tokenPath : Boolean(tokenPath))
  )
    throw new Error('usage');
  const config = await readConfig(configPath);
  if (command === 'enroll') {
    const token = (await readFile(tokenPath!, 'utf8')).trim();
    await enroll(config, token);
    process.stdout.write('Runner enrolled; identity saved in the configured private state directory.\n');
  } else if (command === 'check') {
    if (!config.sandbox) throw new Error('sandbox_not_configured');
    const sandbox = new CodexContainerSandbox({
      runtimeExecutable: config.sandbox.runtimeExecutable,
      image: config.sandbox.image,
      egressHosts: config.sandbox.egressHosts,
      authenticationProfile: config.sandbox.profile.directory,
    });
    await sandbox.checkConformance(controller.signal);
    process.stdout.write('Live credential-free sandbox conformance passed on this host.\n');
  } else {
    const identity = await readIdentity(config);
    if (!config.sandbox && !config.localEndpoints.length) throw new Error('no_work_enabled');
    await new RunnerDaemon(config, identity, { log: (event) => process.stdout.write(`${event}\n`) }).run(
      controller.signal,
    );
  }
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'runner_configuration_or_startup_failed';
  process.stderr.write(`Runner stopped: ${code}.\n`);
  process.exitCode = 1;
}
