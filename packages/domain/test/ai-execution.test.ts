import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodexCliExperiment } from '../src/ai/execution/codex-cli.js';
import type { ExecutionEvent, ExecutionLimits, SyntheticExecutionRequest } from '../src/ai/execution/contract.js';

let root: string;
let cwd: string;
const fixture = await readFile(new URL('./fixtures/codex-cli.mjs', import.meta.url), 'utf8');
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'crm-cli-test-')));
  cwd = join(root, 'isolated');
  await mkdir(cwd);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function adapter(mode = 'success', limits: Partial<ExecutionLimits> = {}) {
  const executable = join(root, `${mode}.mjs`);
  await writeFile(executable, `#!${process.execPath}\n${fixture}`, { mode: 0o700 });
  return new CodexCliExperiment({
    executable,
    limits: { firstEventMs: 3_000, idleMs: 3_000, totalMs: 10_000, killGraceMs: 20, ...limits },
  });
}
function request(extra: Partial<SyntheticExecutionRequest> = {}): SyntheticExecutionRequest {
  return {
    dataClass: 'synthetic',
    prompt: 'A fictional company has two fictional employees.',
    workingDirectory: cwd,
    nativeTools: 'disabled',
    crmAccess: 'disabled',
    ...extra,
  };
}

describe('bounded synthetic Codex CLI experiment', () => {
  it('normalizes a successful JSONL stream and unknown subscription cost', async () => {
    const events: ExecutionEvent[] = [];
    const result = await (await adapter()).execute(request(), (event) => events.push(event));
    expect(result).toMatchObject({
      text: 'Synthetic answer',
      sessionId: 'synthetic-session',
      executableVersion: '0.163.0',
      inputTokens: 7,
      outputTokens: 3,
      cost: 'unknown',
      isolation: 'not-production-sandboxed',
      executionHost: 'local-experiment',
      dataDestination: 'cli-vendor',
    });
    expect(events.map((event) => event.type)).toEqual(['started', 'text', 'completed']);
    expect(await readdir(cwd)).toEqual([]);
  });

  it('passes prompt only on stdin and strips ambient secrets, configuration, and host paths', async () => {
    const original = process.env.CRM_CLI_TEST_SECRET;
    process.env.CRM_CLI_TEST_SECRET = 'fixture-secret';
    try {
      const prompt = 'Synthetic: $(touch forbidden) `whoami` --dangerously-bypass-approvals-and-sandbox';
      const result = await (await adapter('inspect')).execute(request({ prompt }));
      const observed = JSON.parse(result.text);
      expect(observed.prompt).toContain(prompt);
      expect(observed.args).not.toContain(prompt);
      expect(observed.args.at(-1)).toBe('-');
      expect(observed.args).toEqual(
        expect.arrayContaining([
          '--ignore-user-config',
          '--ignore-rules',
          '--strict-config',
          'read-only',
          'mcp_servers={}',
          'web_search="disabled"',
          'shell_tool',
          'plugins',
          'hooks',
          'multi_agent',
          'browser_use',
          'computer_use',
        ]),
      );
      // macOS may insert this CoreFoundation value after exec; it is not inherited by the harness.
      expect(
        Object.keys(observed.env)
          .filter((name) => name !== '__CF_USER_TEXT_ENCODING')
          .sort(),
      ).toEqual(
        [
          'CODEX_HOME',
          'HOME',
          'LANG',
          'NO_COLOR',
          'PATH',
          'TMPDIR',
          'XDG_CACHE_HOME',
          'XDG_CONFIG_HOME',
          'XDG_DATA_HOME',
        ].sort(),
      );
      expect(observed.env.PATH).toBe('/usr/bin:/bin');
      expect(observed.env.HOME.startsWith(cwd)).toBe(true);
      expect(observed.env.CODEX_HOME.startsWith(cwd)).toBe(true);
      expect(observed.cwd).toBe(cwd);
    } finally {
      if (original === undefined) delete process.env.CRM_CLI_TEST_SECRET;
      else process.env.CRM_CLI_TEST_SECRET = original;
    }
  });

  it('handles multibyte UTF-8 split across chunks and a final JSON line without newline', async () => {
    const result = await (await adapter('split')).execute(request());
    expect(result.text).toBe('синтетика');
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });

  it.each([
    ['old', 'incompatible_cli'],
    ['bad-help', 'incompatible_cli'],
    ['bad-auth', 'incompatible_cli'],
    ['no-auth', 'unauthenticated'],
    ['auth-expired', 'unauthenticated'],
    ['invalid-json', 'invalid_output'],
    ['invalid-utf8', 'invalid_output'],
    ['tool', 'native_tool_denied'],
    ['unknown', 'invalid_output'],
    ['missing-terminal', 'disconnected'],
    ['duplicate-terminal', 'invalid_output'],
    ['nonzero', 'process_failed'],
    ['signal', 'disconnected'],
  ])('classifies %s without echoing provider diagnostics', async (mode, code) => {
    const events: ExecutionEvent[] = [];
    try {
      await (await adapter(mode)).execute(request(), (event) => events.push(event));
      expect.fail('Expected failure');
    } catch (error) {
      expect(error).toMatchObject({ code });
      expect(String(error)).not.toContain('fixture-secret');
    }
    expect(events.some((event) => event.type === 'completed')).toBe(false);
    expect(await readdir(cwd)).toEqual([]);
  });

  it.each(['stdout-flood', 'stderr-flood'])('bounds combined bytes for %s', async (mode) => {
    await expect((await adapter(mode, { maxOutputBytes: 4_096 })).execute(request())).rejects.toMatchObject({
      code: 'output_limit',
    });
  });

  it('times out first valid event despite continuous stderr', async () => {
    await expect((await adapter('first-timeout', { firstEventMs: 150 })).execute(request())).rejects.toMatchObject({
      code: 'first_event_timeout',
    });
  });
  it('times out idle stream despite continuous stderr', async () => {
    await expect((await adapter('idle-timeout', { idleMs: 100 })).execute(request())).rejects.toMatchObject({
      code: 'idle_timeout',
    });
  });
  it('enforces one deadline across preflight and continuous valid events', async () => {
    const started = Date.now();
    await expect((await adapter('total-timeout', { totalMs: 500 })).execute(request())).rejects.toMatchObject({
      code: 'total_timeout',
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('cancels before spawning', async () => {
    const signal = AbortSignal.abort();
    await expect((await adapter()).execute(request({ signal }))).rejects.toMatchObject({ code: 'canceled' });
    expect(await readdir(cwd)).toEqual([]);
  });

  it('kills the process group on cancellation, including a descendant ignoring SIGTERM', async () => {
    const controller = new AbortController();
    let pid = 0;
    await expect(
      (await adapter('descendant')).execute(request({ signal: controller.signal }), (event) => {
        if (event.type === 'text') {
          pid = Number(event.text);
          controller.abort();
        }
      }),
    ).rejects.toMatchObject({ code: 'canceled' });
    expect(pid).toBeGreaterThan(0);
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
  });

  it('cleans descendants after successful leader exit with inherited pipes', async () => {
    const result = await (await adapter('descendant-success')).execute(request());
    await expect
      .poll(() => {
        try {
          process.kill(Number(result.text), 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
  });

  it('rejects missing or nonabsolute executables and arbitrary configuration', async () => {
    await expect(
      new CodexCliExperiment({ executable: '/definitely/missing/codex' }).execute(request()),
    ).rejects.toMatchObject({ code: 'missing_executable' });
    await expect(new CodexCliExperiment({ executable: 'codex' }).execute(request())).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(() => new CodexCliExperiment({ executable: '/bin/echo', argv: ['unsafe'] } as never)).toThrow();
  });

  it('rejects nonempty or symlink working directories, real data, and tool grants', async () => {
    const runner = await adapter();
    await expect(runner.execute(request({ dataClass: 'crm' as never }))).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(runner.execute(request({ nativeTools: 'enabled' as never }))).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(runner.execute({ ...request(), mcpServers: [] } as never)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await writeFile(join(cwd, 'CRM.txt'), 'not permitted');
    await expect(runner.execute(request())).rejects.toMatchObject({ code: 'invalid_request' });
    const link = join(root, 'link');
    await symlink(cwd, link);
    await expect(runner.execute(request({ workingDirectory: link }))).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('rejects an authentication directory carrying config, plugins, or symlinked credentials', async () => {
    const executable = join(root, 'success.mjs');
    await adapter();
    const authenticationHome = join(root, 'profile');
    await mkdir(authenticationHome);
    await writeFile(join(authenticationHome, 'config.toml'), '');
    const runner = new CodexCliExperiment({ executable, authenticationHome });
    await expect(runner.execute(request())).rejects.toMatchObject({ code: 'invalid_request' });
    await rm(join(authenticationHome, 'config.toml'));
    await writeFile(join(root, 'auth.json'), '{}');
    await symlink(join(root, 'auth.json'), join(authenticationHome, 'auth.json'));
    await expect(runner.execute(request())).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
