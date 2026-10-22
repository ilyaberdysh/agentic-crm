import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assert, json, main, root, run, sha256 } from './common.mjs';

export function licenseFiles(directory, nested = false) {
  const names = readdirSync(directory).filter((name) => nested || /^(licen[cs]es?|copying|notices?|copyright)([._-].*)?$/i.test(name));
  const files = [];
  for (const name of names.sort()) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), `License evidence must not follow symlinks: ${path}`);
    if (stat.isFile()) files.push({ name, bytes: readFileSync(path) });
    else if (stat.isDirectory()) {
      for (const file of licenseFiles(path, true)) files.push({ ...file, name: `${name}/${file.name}` });
    }
  }
  return files;
}

// Missing npm metadata is resolved only for these exact installed bytes, not by a name-wide assumption.
export function resolvedLicense(name, version, declared, evidence) {
  if (name === 'require-like' && version === '0.1.2' && declared === 'Unknown' &&
    evidence.some((file) => file.name === 'License' && file.sha256 === 'c5ece09265dbd6335030832335dec72919b9ecfd4db126cb9bb9b8d023970304')) {
    return { value: 'MIT', basis: 'Reviewed MIT text in the package License file; npm metadata is absent.' };
  }
  return { value: declared, basis: 'Installed package metadata; not a legal compatibility determination.' };
}

export function inventory({ production = false } = {}) {
  assert(run('pnpm', ['--version']).toString().trim() === '11.11.0', 'Use the repository-pinned pnpm 11.11.0.');
  const grouped = JSON.parse(run('pnpm', ['licenses', 'list', '--json', ...(production ? ['--prod'] : [])]).toString());
  const packages = new Map();
  const notices = new Map();
  for (const group of Object.values(grouped)) {
    for (const dependency of group) {
      for (const path of dependency.paths) {
        const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
        const evidence = licenseFiles(path).map(({ name, bytes }) => {
          const digest = sha256(bytes);
          notices.set(digest, bytes.toString('utf8'));
          return { name, sha256: digest };
        });
        const license = resolvedLicense(manifest.name, manifest.version, dependency.license, evidence);
        const record = { name: manifest.name, version: manifest.version, declaredLicense: dependency.license,
          license: license.value, licenseBasis: license.basis, ...(dependency.homepage ? { homepage: dependency.homepage } : {}),
          notices: evidence };
        const key = `${manifest.name}@${manifest.version}`;
        const previous = packages.get(key);
        assert(!previous || json(previous) === json(record), `Inconsistent installed license evidence for ${key}.`);
        packages.set(key, record);
      }
    }
  }
  const records = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'));
  assert(records.length > 0, 'No installed dependencies found; run pnpm install --frozen-lockfile first.');
  const unresolved = records.filter((record) => !record.license || /unknown|unlicensed|see license/i.test(record.license));
  const missingNoticeFiles = records.filter((record) => record.notices.length === 0).map(({ name, version }) => `${name}@${version}`);
  const report = { schemaVersion: 1, pnpmVersion: '11.11.0', lockfileSha256: sha256(readFileSync(join(root, 'pnpm-lock.yaml'))),
    scope: production ? 'installed production and optional dependencies' : 'all installed workspace dependencies including development tools',
    platform: process.platform, architecture: process.arch,
    limitations: 'Installed-platform inventory; not all lockfile platforms, OS packages, runtime CLIs, or a legal approval. Review the actual distribution SBOM and retain notices.',
    packageCount: records.length, unresolved: unresolved.map(({ name, version }) => `${name}@${version}`), missingNoticeFiles,
    packages: records };
  const noticeText = ['Agentic CRM third-party dependency notices',
    'Generated from installed packages. Individual upstream terms apply. See inventory.json for package-to-notice hashes.',
    ...records.map((record) => `${record.name}@${record.version}: ${record.license}\n${record.notices.map((file) => `${file.name}: SHA-256 ${file.sha256}`).join('\n')}`),
    ...[...notices].sort(([a], [b]) => a.localeCompare(b)).map(([hash, text]) => `===== SHA-256 ${hash} =====\n${text}`)].join('\n\n') + '\n';
  return { report, noticeText };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main(() => {
  const [directoryArg, ...options] = process.argv.slice(2);
  assert(directoryArg && options.every((option) => option === '--production'),
    'Usage: node scripts/publication/licenses.mjs OUTPUT_DIRECTORY [--production]');
  const directory = resolve(directoryArg);
  assert(!existsSync(directory), 'Use a new output directory so stale inventory files cannot be retained.');
  const { report, noticeText } = inventory({ production: options.includes('--production') });
  mkdirSync(directory, { recursive: true, mode: 0o755 });
  writeFileSync(join(directory, 'inventory.json'), json(report));
  writeFileSync(join(directory, 'THIRD_PARTY_NOTICES.txt'), noticeText);
  console.log(`${report.packageCount} packages; ${report.unresolved.length} unresolved license declarations; ${report.missingNoticeFiles.length} packages without standalone notice files.`);
  console.log(`Inventory and original notice texts: ${directory}`);
  assert(report.unresolved.length === 0, `Unresolved licenses require evidence review: ${report.unresolved.join(', ')}`);
});
