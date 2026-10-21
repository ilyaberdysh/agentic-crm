import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { assert, checkPaths, main, root, run } from './common.mjs';

main(() => {
  const [mode = 'tree', targetArg = root] = process.argv.slice(2);
  assert(['tree', 'history', 'directory'].includes(mode), 'Usage: node scripts/publication/scan.mjs tree|history|directory [DIRECTORY]');
  const target = resolve(targetArg);
  const executable = process.env.PUBLICATION_GITLEAKS || 'gitleaks';
  assert(run(executable, ['version']).toString().trim() === '8.30.1', 'Use Gitleaks 8.30.1 (see install-tools.mjs).');
  // Explicit config and ignore path prevent local settings or allow comments from hiding findings.
  const emptyIgnore = mkdtempSync(join(tmpdir(), 'agentic-crm-gitleaks-'));
  const args = ['--config', join(root, 'scripts/publication/gitleaks.toml'), '--gitleaks-ignore-path', emptyIgnore,
    '--no-banner', '--no-color', '--redact=100', '--ignore-gitleaks-allow', '--max-archive-depth', '3'];
  const env = { ...process.env };
  delete env.GITLEAKS_CONFIG;
  delete env.GITLEAKS_CONFIG_TOML;
  if (mode === 'history') {
    assert(run('git', ['-C', target, 'rev-parse', '--is-shallow-repository']).toString().trim() === 'false',
      'History scan requires a complete non-shallow checkout or mirror.');
    const refs = run('git', ['-C', target, 'for-each-ref', '--format=%(refname)']).toString().trim();
    console.log(`Scanning all fetched local refs (no network fetch is performed):\n${refs}`);
    run(executable, ['git', ...args, '--log-opts=--all', target], { env, stdio: 'inherit' });
  } else if (mode === 'tree') {
    const paths = [...new Set(run('git', ['-C', target, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
      .toString().split('\0').filter(Boolean))];
    checkPaths(paths);
    const snapshot = mkdtempSync(join(tmpdir(), 'agentic-crm-tree-'));
    for (const path of paths) {
      const from = join(target, path);
      assert(lstatSync(from).isFile(), `Only regular publication files are accepted: ${path}`);
      mkdirSync(dirname(join(snapshot, path)), { recursive: true });
      writeFileSync(join(snapshot, path), readFileSync(from), { flag: 'wx' });
    }
    console.log(`Scanning ${paths.length} current tracked and non-ignored files. Ignored local state is outside this scan.`);
    run(executable, ['dir', ...args, snapshot], { env, stdio: 'inherit' });
    console.log(`Private local scan input retained at ${snapshot}; remove it after reviewing findings.`);
  } else {
    run(executable, ['dir', ...args, target], { env, stdio: 'inherit' });
  }
});
