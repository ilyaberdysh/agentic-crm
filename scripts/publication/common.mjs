import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, maxBuffer: 64 * 1024 * 1024, ...options });
}
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
export function outsideRepository(path) {
  let parent = resolve(path);
  const missing = [];
  while (!existsSync(parent)) {
    missing.unshift(basename(parent));
    parent = dirname(parent);
  }
  const target = resolve(realpathSync(parent), ...missing);
  const rel = relative(root, target);
  assert(rel.startsWith('..' + '/') || rel === '..', 'Evidence and exports must be outside the source repository.');
  return target;
}
export function checkPaths(paths) {
  const denied = paths.filter((path) => {
    const parts = path.split('/');
    return path.startsWith('/') || parts.some((part) => part === '..' || part === '' ||
      ['.git', '.claude', 'research', 'node_modules', '.dev-credentials', '.auth', '.capture'].includes(part) ||
      (part.startsWith('.env') && part !== '.env.example')) ||
      /\.(har|pem|key|p12|pfx|dump|bak|zip|tgz|gz|xz|7z|tar)$/i.test(path) ||
      /[\t\n\r]/.test(path) || /(^|\/)(auth\.json|credentials\.json|id_rsa|id_ed25519|\.DS_Store)$/i.test(path);
  });
  assert(denied.length === 0, `Private or unsupported publication paths: ${denied.join(', ')}`);
}
export function filesIn(directory, { allowRootGit = false } = {}) {
  const files = [];
  function visit(current, prefix) {
    for (const name of readdirSync(current).sort()) {
      if (!prefix && name === '.git' && allowRootGit) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      const absolute = resolve(current, name);
      const stat = lstatSync(absolute);
      assert(!stat.isSymbolicLink(), `Symlinks are not accepted in publication snapshots: ${path}`);
      if (stat.isDirectory()) visit(absolute, path);
      else {
        assert(stat.isFile(), `Unsupported file type: ${path}`);
        files.push({ path, mode: stat.mode & 0o111 ? '100755' : '100644', sha256: sha256(readFileSync(absolute)) });
      }
    }
  }
  visit(directory, '');
  checkPaths(files.map((file) => file.path));
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
export function main(callback) {
  Promise.resolve().then(callback).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
