import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, json, main, outsideRepository, run, sha256 } from './common.mjs';

main(() => {
  const [image, directoryArg] = process.argv.slice(2);
  assert(image && directoryArg, 'Usage: node scripts/publication/image-gate.mjs LOCAL_IMAGE_ID OUTPUT_DIRECTORY');
  assert(/^sha256:[a-f0-9]{64}$/.test(image), 'Scan a local immutable image ID from docker build --iidfile, never a mutable tag.');
  const directory = outsideRepository(directoryArg);
  assert(!existsSync(directory), 'Use a fresh evidence directory for each image.');
  const executable = process.env.PUBLICATION_TRIVY || 'trivy';
  assert(run(executable, ['--version']).toString().split('\n')[0] === 'Version: 0.76.1', 'Use pinned Trivy 0.76.1.');
  const inspected = JSON.parse(run('docker', ['image', 'inspect', image]).toString())[0];
  assert(inspected.Id === image, 'Docker image identity changed.');
  mkdirSync(directory, { mode: 0o700 });
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('TRIVY_')));
  const base = ['image', '--config', '', '--ignorefile', '', '--image-src', 'docker', '--timeout', '15m', '--quiet',
    '--severity', 'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL', '--pkg-types', 'os,library', '--disable-telemetry'];
  const outputs = ['sbom.cdx.json', 'vulnerabilities.json', 'licenses.json'];
  // Collect evidence before applying failure thresholds; no secret scanner output is persisted.
  run(executable, [...base, '--scanners', 'license', '--license-full', '--format', 'cyclonedx', '--output', join(directory, outputs[0]), image], { env, stdio: 'inherit' });
  run(executable, [...base, '--scanners', 'vuln', '--format', 'json', '--output', join(directory, outputs[1]), image], { env, stdio: 'inherit' });
  run(executable, [...base, '--scanners', 'license', '--license-full', '--format', 'json', '--output', join(directory, outputs[2]), image], { env, stdio: 'inherit' });
  const sbom = JSON.parse(readFileSync(join(directory, outputs[0]), 'utf8'));
  assert(sbom.bomFormat === 'CycloneDX' && sbom.components?.length > 0, 'SBOM has no detected components.');
  const vulnerabilities = JSON.parse(readFileSync(join(directory, outputs[1]), 'utf8'));
  const licenses = JSON.parse(readFileSync(join(directory, outputs[2]), 'utf8'));
  assert(licenses.Results?.some((result) => result.Licenses?.length > 0), 'License scan produced no license evidence.');
  const blockedVulnerabilities = (vulnerabilities.Results || []).flatMap((result) => result.Vulnerabilities || [])
    .filter((finding) => ['HIGH', 'CRITICAL'].includes(finding.Severity));
  const blockedLicenses = (licenses.Results || []).flatMap((result) => result.Licenses || [])
    .filter((finding) => ['UNKNOWN', 'HIGH', 'CRITICAL'].includes(finding.Severity));
  const receipt = { schemaVersion: 1, imageId: image, platform: `${inspected.Os}/${inspected.Architecture}`,
    trivyVersion: '0.76.1', scannedAt: new Date().toISOString(),
    scannerDatabase: JSON.parse(run(executable, ['--version', '--format', 'json'], { env }).toString()),
    componentCount: sbom.components.length, blockedVulnerabilities: blockedVulnerabilities.length,
    blockedLicenses: blockedLicenses.length, legalApproval: false,
    evidence: outputs.map((path) => ({ path, sha256: sha256(readFileSync(join(directory, path))) })) };
  writeFileSync(join(directory, 'receipt.json'), json(receipt), { flag: 'wx' });
  console.log(`${receipt.componentCount} SBOM components; ${receipt.blockedVulnerabilities} high/critical vulnerabilities; ${receipt.blockedLicenses} unknown/high/critical license findings.`);
  console.log(`Private evidence: ${directory}. An artifact-specific notice and license review is still required.`);
  assert(receipt.blockedVulnerabilities === 0 && receipt.blockedLicenses === 0, 'Container gate failed; review the evidence and resolve findings before distribution.');
});
