import { spawn } from 'node:child_process';
import { ExecutionError, type ExecutionLimits } from './contract.js';

export interface ProcessBudget {
  deadline: number;
  outputBytes: number;
}

/** No inherited environment, command interpolation, retries, or raw stderr in errors. POSIX only. */
export function runBoundedProcess(options: {
  executable: string;
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  limits: ExecutionLimits;
  budget: ProcessBudget;
  signal?: AbortSignal;
  stdin?: string;
  /** Return true only for a fully parsed valid event. Stderr never resets the event timers. */
  onStdout?: (chunk: Buffer) => boolean;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const { limits, budget, signal } = options;
    if (signal?.aborted) return reject(new ExecutionError('canceled', 'Execution canceled.'));
    if (Date.now() >= budget.deadline)
      return reject(new ExecutionError('total_timeout', 'Execution deadline expired.'));
    const child = spawn(options.executable, options.argv, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let exitCode: number | null = null;
    let failure: ExecutionError | undefined;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let first = false;
    let finished = false;
    let closed = false;
    let escalated = false;
    const killGroup = (sig: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, sig);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          failure ??= new ExecutionError('process_failed', 'Could not clean up execution process group.');
        }
      }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(firstTimer);
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      clearTimeout(drainTimer);
      signal?.removeEventListener('abort', cancel);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      if (failure) reject(failure);
      else resolve({ stdout, stderr, exitCode });
    };
    const cleanup = () => {
      if (cleanupTimer) return;
      killGroup('SIGTERM');
      // Always escalate, including after a successful leader exit: descendants may hold pipes open.
      cleanupTimer = setTimeout(() => {
        escalated = true;
        killGroup('SIGKILL');
        if (closed) finish();
        else drainTimer = setTimeout(finish, 100);
      }, limits.killGraceMs);
    };
    const fail = (error: ExecutionError) => {
      failure ??= error;
      cleanup();
    };
    const cancel = () => fail(new ExecutionError('canceled', 'Execution canceled.'));
    const firstTimer = setTimeout(
      () => fail(new ExecutionError('first_event_timeout', 'CLI produced no valid first event within the limit.')),
      limits.firstEventMs,
    );
    const totalTimer = setTimeout(
      () => fail(new ExecutionError('total_timeout', 'Execution deadline expired.')),
      Math.max(1, budget.deadline - Date.now()),
    );
    const output = (chunk: Buffer, isStdout: boolean) => {
      if (failure || finished) return;
      budget.outputBytes += chunk.length;
      if (budget.outputBytes > limits.maxOutputBytes) {
        fail(new ExecutionError('output_limit', 'CLI output exceeded the combined byte limit.'));
        return;
      }
      let event = false;
      try {
        if (isStdout && options.onStdout) event = options.onStdout(chunk);
        else if (isStdout) {
          stdout += chunk.toString('utf8');
          event = true;
        } else stderr += chunk.toString('utf8');
      } catch (error) {
        fail(
          error instanceof ExecutionError ? error : new ExecutionError('invalid_output', 'CLI event consumer failed.'),
        );
        return;
      }
      if (event) {
        first = true;
        clearTimeout(firstTimer);
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => fail(new ExecutionError('idle_timeout', 'CLI event stream stalled.')),
          limits.idleMs,
        );
      }
    };
    child.stdout.on('data', (chunk: Buffer) => output(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => output(chunk, false));
    child.stdin.on('error', () => {
      // EPIPE accompanies early exits; the exit/error events determine the precise result.
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      fail(
        new ExecutionError(error.code === 'ENOENT' ? 'missing_executable' : 'process_failed', 'CLI could not start.'),
      );
    });
    child.on('exit', (code, sig) => {
      exitCode = code;
      clearTimeout(firstTimer);
      clearTimeout(idleTimer);
      if (sig && !failure) failure = new ExecutionError('disconnected', 'CLI terminated by signal.');
      cleanup();
    });
    child.on('close', () => {
      closed = true;
      // A quiet fast failure should be classified by exit status, not by first-event timeout.
      if (!first) clearTimeout(firstTimer);
      clearTimeout(idleTimer);
      cleanup();
      if (escalated) finish();
    });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdin.end(options.stdin ?? '');
  });
}
