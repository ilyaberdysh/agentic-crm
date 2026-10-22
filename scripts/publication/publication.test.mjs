import test from 'node:test';
import strict from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPaths, root, sha256 } from './common.mjs';
import { resolvedLicense } from './licenses.mjs';

const script = join(root, 'scripts/publication/snapshot.mjs');
const invoke = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const git = (directory, ...args) => execFileSync('git', ['-C', directory, '-c', 'core.hooksPath=/dev/null',
  '-c', 'commit.gpgsign=false', '-c', 'user.name=Publication test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'publication-test-')));
  const source = join(base, 'source');
  mkdirSync(source);
  git(source, 'init', '-b', 'main');
  writeFileSync(join(source, 'readme.txt'), 'committed bytes\n');
  writeFileSync(join(source, '.gitattributes'), 'readme.txt export-ignore\n');
  writeFileSync(join(source, 'run.sh'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(source, 'run.sh'), 0o755);
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'fixture');
  return { base, source, destination: join(base, 'snapshot'), receipt: join(base, 'receipt.json') };
}
function exportedFixture() {
  const f = fixture();
  strict.equal(invoke('export', f.destination, f.receipt, 'HEAD', f.source).status, 0);
  return f;
}

test('private paths, credential state, archives and traversal are blocked', () => {
  for (const path of ['.env', 'apps/api/.env.local', 'research/input.json', 'apps/web/e2e/.auth/credentials.json',
    'apps/web/e2e/.capture/raw.webm',
    'private.pem', 'backup.sql.gz', '../escape', '.git/config', 'unsafe\nname']) {
    strict.throws(() => checkPaths([path]), undefined, path);
  }
  strict.doesNotThrow(() => checkPaths(['.env.example', 'packages/db/src/migrations/001.sql', 'PROVENANCE.md']));
});

test('export uses exact committed blobs, retains modes, ignores local files, and never overwrites', () => {
  const f = fixture();
  writeFileSync(join(f.source, 'readme.txt'), 'uncommitted bytes\n');
  writeFileSync(join(f.source, 'local.txt'), 'untracked\n');
  strict.equal(invoke('export', f.destination, f.receipt, 'HEAD', f.source).status, 0);
  strict.equal(readFileSync(join(f.destination, 'readme.txt'), 'utf8'), 'committed bytes\n');
  strict.equal(existsSync(join(f.destination, 'local.txt')), false);
  strict.equal(existsSync(join(f.destination, '.git')), false);
  const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'));
  strict.equal(receipt.files.find((file) => file.path === 'run.sh').mode, '100755');
  strict.equal(invoke('export', f.destination, f.receipt, 'HEAD', f.source).status, 1);
});

test('snapshot verification rejects additional files and modified receipt contents', () => {
  const f = exportedFixture();
  strict.equal(invoke('verify', f.destination, f.receipt).status, 0);
  writeFileSync(join(f.destination, 'extra.txt'), 'not reviewed');
  strict.equal(invoke('verify', f.destination, f.receipt).status, 1);
  const receipt = JSON.parse(readFileSync(f.receipt, 'utf8'));
  receipt.files[0].sha256 = sha256('different');
  writeFileSync(f.receipt, JSON.stringify(receipt));
  strict.match(invoke('verify', f.destination, f.receipt).stderr, /Receipt integrity mismatch/);
});

test('export rejects symlinks before creating a destination', () => {
  const f = fixture();
  symlinkSync('/etc/passwd', join(f.source, 'link'));
  git(f.source, 'add', 'link');
  git(f.source, 'commit', '-m', 'symlink');
  strict.equal(invoke('export', f.destination, f.receipt, 'HEAD', f.source).status, 1);
  strict.equal(existsSync(f.destination), false);
});

test('fresh repository verification requires a single root commit and no extra refs', () => {
  const f = exportedFixture();
  git(f.destination, 'init', '-b', 'main');
  git(f.destination, 'add', '.');
  git(f.destination, 'commit', '-m', 'Reviewed snapshot');
  strict.equal(invoke('verify-repository', f.destination, f.receipt).status, 0);
  git(f.destination, 'branch', 'old');
  strict.match(invoke('verify-repository', f.destination, f.receipt).stderr, /Only the fresh main branch/);
  git(f.destination, 'branch', '-d', 'old');
  git(f.destination, 'commit', '--allow-empty', '-m', 'extra history');
  strict.match(invoke('verify-repository', f.destination, f.receipt).stderr, /exactly one reachable commit/);
  git(f.destination, 'update-ref', 'refs/heads/main', 'HEAD~1');
  strict.match(invoke('verify-repository', f.destination, f.receipt).stderr, /Unreachable or unrelated Git objects/);
});

test('missing package metadata is resolved only for the reviewed license bytes', () => {
  const evidence = [{ name: 'License', sha256: 'c5ece09265dbd6335030832335dec72919b9ecfd4db126cb9bb9b8d023970304' }];
  strict.equal(resolvedLicense('require-like', '0.1.2', 'Unknown', evidence).value, 'MIT');
  strict.equal(resolvedLicense('require-like', '0.1.3', 'Unknown', evidence).value, 'Unknown');
  strict.equal(resolvedLicense('require-like', '0.1.2', 'Unknown', []).value, 'Unknown');
});

test('secret scan fails and redacts a synthetic token despite a local ignore comment', () => {
  const directory = mkdtempSync(join(tmpdir(), 'publication-secret-test-'));
  const token = ['ghp', randomBytes(18).toString('hex')].join('_');
  writeFileSync(join(directory, 'example.txt'), `token = "${token}" # gitleaks:allow\n`);
  const scanned = spawnSync(process.execPath, [join(root, 'scripts/publication/scan.mjs'), 'directory', directory], {
    encoding: 'utf8', env: process.env,
  });
  strict.equal(scanned.status, 1);
  strict.match(scanned.stderr, /leaks found/);
  strict.equal(`${scanned.stdout}${scanned.stderr}`.includes(token), false);
});
