import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assert, main, outsideRepository, root, run, sha256 } from './common.mjs';

main(async () => {
  const [destinationArg, ...requested] = process.argv.slice(2);
  assert(destinationArg, 'Usage: node scripts/publication/install-tools.mjs DIRECTORY [gitleaks trivy]');
  const destination = outsideRepository(destinationArg);
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/publication/tools.json'), 'utf8'));
  const names = requested.length ? requested : Object.keys(manifest);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const name of names) {
    const tool = manifest[name];
    const asset = tool?.[`${process.platform}-${process.arch}`];
    assert(asset, `No pinned ${name} asset for ${process.platform}-${process.arch}.`);
    const binary = resolve(destination, name);
    assert(!existsSync(binary), `Refusing to overwrite ${binary}.`);
    const response = await fetch(asset.url);
    assert(response.ok, `Download failed (${response.status}): ${asset.url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert(sha256(bytes) === asset.sha256, `Checksum mismatch for ${name}; refusing to execute downloaded code.`);
    const staging = mkdtempSync(join(tmpdir(), 'agentic-crm-tool-'));
    const archive = join(staging, 'tool.tar.gz');
    writeFileSync(archive, bytes, { flag: 'wx' });
    run('tar', ['-xzf', archive, '-C', staging, name]);
    copyFileSync(join(staging, name), binary, 1);
    chmodSync(binary, 0o700);
    console.log(`Installed ${name} ${tool.version} with verified archive SHA-256: ${binary}`);
  }
});
