import { mkdirSync, existsSync, writeFileSync, readFileSync, realpathSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assert, checkPaths, filesIn, json, main, outsideRepository, root, run, sha256 } from './common.mjs';

main(() => {
  const [command, targetArg, receiptArg, commitArg = 'HEAD', sourceArg = root] = process.argv.slice(2);
  assert(['export', 'verify', 'verify-repository'].includes(command) && targetArg && receiptArg,
    'Usage: node scripts/publication/snapshot.mjs export|verify|verify-repository DIRECTORY RECEIPT.json [COMMIT] [SOURCE_REPOSITORY]');
  const target = outsideRepository(targetArg);
  const receiptPath = outsideRepository(receiptArg);
  assert(!receiptPath.startsWith(`${target}/`) && receiptPath !== target, 'Keep the receipt outside the exported tree.');
  if (command === 'export') {
    assert(!existsSync(target) && !existsSync(receiptPath), 'Export destination and receipt must not already exist.');
    assert(realpathSync(dirname(target)) === dirname(target), 'Use a real destination parent, without symlinks.');
    const source = realpathSync(sourceArg);
    assert(target !== source && !target.startsWith(`${source}/`), 'Export must not be inside its source repository.');
    const git = (args) => run('git', ['-C', source, ...args]);
    const commit = git(['rev-parse', '--verify', `${commitArg}^{commit}`]).toString().trim();
    const tree = git(['rev-parse', `${commit}^{tree}`]).toString().trim();
    const entries = git(['ls-tree', '-rz', '--full-tree', commit]).toString().split('\0').filter(Boolean);
    checkPaths(entries.map((entry) => entry.slice(entry.indexOf('\t') + 1)));
    assert(entries.every((entry) => /^(100644|100755) blob /.test(entry)), 'Submodules and symlinks require separate review.');
    // Use blob bytes directly: export-ignore attributes, local filters, and local files cannot alter the snapshot.
    mkdirSync(target, { mode: 0o700 });
    for (const entry of entries) {
      const [metadata, path] = entry.split('\t');
      const [mode, , oid] = metadata.split(' ');
      mkdirSync(dirname(resolve(target, path)), { recursive: true });
      writeFileSync(resolve(target, path), git(['cat-file', 'blob', oid]), { mode: mode === '100755' ? 0o755 : 0o644, flag: 'wx' });
    }
    const files = filesIn(target);
    writeFileSync(receiptPath, json({ schemaVersion: 1, sourceCommit: commit, sourceTree: tree,
      fileCount: files.length, contentSha256: sha256(json(files)), files }), { flag: 'wx', mode: 0o600 });
    console.log(`Exported ${files.length} committed files without Git metadata. Receipt: ${receiptPath}`);
    return;
  }
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assert(receipt.schemaVersion === 1 && Array.isArray(receipt.files) && receipt.files.length > 0, 'Invalid snapshot receipt.');
  assert(receipt.fileCount === receipt.files.length && sha256(json(receipt.files)) === receipt.contentSha256, 'Receipt integrity mismatch.');
  const files = filesIn(target, { allowRootGit: command === 'verify-repository' });
  assert(json(files) === json(receipt.files), 'Snapshot differs from the reviewed file manifest (paths, bytes, or executable modes).');
  if (command === 'verify-repository') {
    const git = (args) => run('git', ['-C', target, ...args]).toString().trim();
    assert(lstatSync(resolve(target, '.git')).isDirectory() && !lstatSync(resolve(target, '.git')).isSymbolicLink(),
      'Expected fresh local Git metadata, not a worktree or linked Git directory.');
    assert(!existsSync(resolve(target, '.git/objects/info/alternates')), 'Alternate object databases are not allowed.');
    assert(git(['rev-parse', '--show-toplevel']) === realpathSync(target), 'Expected an independent repository at the snapshot root.');
    assert(git(['rev-parse', '--is-shallow-repository']) === 'false', 'Shallow history cannot prove a single-root snapshot.');
    assert(git(['rev-list', '--all', '--count']) === '1', 'The fresh repository must contain exactly one reachable commit.');
    const storedObjects = git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname)']).split('\n').sort();
    const reachableObjects = git(['rev-list', '--objects', 'HEAD']).split('\n').map((line) => line.split(' ')[0]).sort();
    assert(json(storedObjects) === json(reachableObjects), 'Unreachable or unrelated Git objects remain; create a new export repository.');
    assert(git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').length === 1, 'Snapshot commit must have no parents.');
    assert(git(['for-each-ref', '--format=%(refname)']) === 'refs/heads/main', 'Only the fresh main branch may be present.');
    assert(git(['remote']) === '', 'Verify the fresh repository before adding any remote.');
    assert(git(['status', '--porcelain', '--untracked-files=all']) === '', 'Fresh repository must have no local changes.');
    assert(git(['ls-files', '-z']).split('\0').filter(Boolean).length === files.length, 'Every exported file must be committed.');
    assert(git(['rev-parse', 'HEAD^{tree}']) === receipt.sourceTree, 'Fresh commit tree differs from the reviewed source tree.');
  }
  console.log(`Verified ${files.length} files against receipt ${receipt.contentSha256}; source commit ${receipt.sourceCommit}.`);
});
