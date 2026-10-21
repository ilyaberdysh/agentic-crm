# Public-source publication procedure

The current repository's history is not a publication candidate. It retains removed material through old commits and pull-request refs. Keep it private. A passing secret scan does not resolve those provenance obligations. [PROVENANCE.md](../PROVENANCE.md) records the maintainer's source-use disposition, which this procedure preserves.

These tools prepare local evidence and an exact source snapshot. They do not change repository visibility, create remote repositories, publish images, alter releases, or select a release version. Publication remains a separately authorized maintainer operation. Keep the existing source version and pending changelog entry.

## Reproduce the source checks

Use the repository's supported Node.js version and pnpm 11.11.0. Install locked dependencies first. Scanner binaries are pinned by version and archive SHA-256 in [tools.json](../scripts/publication/tools.json); downloads come from the respective upstream GitHub releases. Updates require reviewing the upstream release and replacing its pinned checksum. The supplied assets cover Linux x64 CI and macOS arm64; other platforms require a separately verified upstream binary.

Run from the repository root, with evidence stored outside the repository:

```sh
audit_root=$(mktemp -d)
node scripts/publication/install-tools.mjs "$audit_root/tools" gitleaks trivy
export PUBLICATION_GITLEAKS="$audit_root/tools/gitleaks"
export PUBLICATION_TRIVY="$audit_root/tools/trivy"
pnpm install --frozen-lockfile
node --test scripts/publication/publication.test.mjs
node scripts/publication/scan.mjs tree
node scripts/publication/scan.mjs history
node scripts/publication/licenses.mjs "$audit_root/source-licenses"
```

`tree` checks tracked working files and non-ignored untracked files, rejects private/unsupported paths and symlinks, then scans a temporary copy. It excludes ignored local state such as development `.env` files, installed dependencies, and browser authentication profiles. Review the ignore rules and the intended file inventory; this is not a scan of every local disk file. `directory` scans an explicit exported directory. Scans use Gitleaks 8.30.1, upstream rules, full redaction, and ignore inline `gitleaks:allow` comments and local ignore files. The only additional allowances are the two exact public provenance fingerprints, restricted to `PROVENANCE.md`.

`history` refuses shallow checkouts and scans all locally fetched refs, including local and remote-tracking branches and tags. It performs no fetch. The CI checkout includes normal fetched history, not every GitHub pull-request ref or unadvertised server object. For a final private-source audit, create a separate complete mirror of the intended source repository and explicitly fetch its advertised pull-request refs into that mirror:

```sh
git clone --mirror https://github.com/ilyaberdysh/agentic-crm.git "$audit_root/private-source.git"
git -C "$audit_root/private-source.git" fetch origin '+refs/pull/*:refs/audit/pull/*'
node scripts/publication/scan.mjs history "$audit_root/private-source.git"
git -C "$audit_root/private-source.git" for-each-ref --format='%(refname) %(objectname)'
```

Use only the maintainer-controlled source repository being audited. Do not fetch a recovery archive or another organization's repository into the export. A read-only audit of remote refs does not require changing remote branches or tags. Keep the mirror, scanner inputs, findings, and receipts private. The source audit workflow uploads no reports, source exports, caches, or SARIF. Temporary local scan inputs are retained for inspection; remove the exact temporary directories after the review according to local retention policy.

## Create and verify an exact clean snapshot

Complete source review, contract parity/drift checks, and the normal CI checks first. Commit the accepted candidate locally. An export uses only the specified commit, so uncommitted work is excluded. Give the export tool new paths; it refuses existing destinations and evidence inside the source tree.

```sh
candidate_commit=$(git rev-parse HEAD)
node scripts/publication/snapshot.mjs export "$audit_root/public-source" "$audit_root/source-receipt.json" "$candidate_commit"
node scripts/publication/snapshot.mjs verify "$audit_root/public-source" "$audit_root/source-receipt.json"
node scripts/publication/scan.mjs directory "$audit_root/public-source"
```

The export reads exact committed Git blobs, preserving executable modes. It excludes uncommitted local files and rejects `.git`, dependency/research directories, non-example environment files, archives, submodules, and symlinks. Path checks do not establish that otherwise named files are free of private content; scan and review the exported bytes as well. The export does not apply `export-ignore` or local clean/smudge filters. Unsupported paths cause a failure rather than silent omission. The separate receipt records the reviewed commit/tree identifiers and a per-file SHA-256 manifest. The receipt is evidence of byte equality, not a signature or legal clearance; keep it in the private maintainer audit record.

After visually reviewing screenshots, artwork, example records, and every export path, create an independent local repository in that exported directory. Do not copy the old `.git` directory, fork the private repository, mirror its refs, or import its issues, discussions, Actions history, artifacts, or caches.

```sh
git -C "$audit_root/public-source" init --initial-branch=main
git -C "$audit_root/public-source" -c core.autocrlf=false add --all
git -C "$audit_root/public-source" -c commit.gpgsign=false commit -m 'Initial public source snapshot'
node scripts/publication/snapshot.mjs verify-repository "$audit_root/public-source" "$audit_root/source-receipt.json"
node scripts/publication/scan.mjs history "$audit_root/public-source"
```

`verify-repository` requires the original reviewed file manifest and tree, one parentless commit, only `refs/heads/main`, no remote, no shallow history, no linked/alternate object store, no untracked changes, and no unreachable or unrelated Git objects. Run it before adding a remote. If it fails, create a new export in a new empty location; do not try to repair publication history by force-pushing the private repository.

The maintainer must then authorize a specific new repository destination and publication action. This document does not provide that authorization. Before first visibility or push, verify private vulnerability reporting/contact routing, repository metadata, support/deployment policy URLs, issue/PR templates, and intended license/notice files. Inspect screenshots and animation frames for real identities, correspondence, tokens, workspace names, and third-party assets. Do not claim an automated scan proves authorship, privacy, or legal clearance.

After the separately authorized upload, mirror only the proposed public repository, enumerate its advertised branches/tags/pull-request refs, and repeat the history/current-tree checks against that exact snapshot. Verify the reachable root and expected source-tree hash. Record the final public refs and normal CI result in the private audit receipt. The private source repository remains private; its history is not repaired by exporting a clean tree elsewhere.

## Dependency, container, and hosted-distribution gate

[The installed dependency inventory](dependency-licenses.md) records the current source audit's scope and limits. `licenses.mjs` uses pnpm's installed dependency graph and reads each exact installed package version and available LICENSE/LICENCE/COPYING/NOTICE/COPYRIGHT files. It outputs `inventory.json` and `THIRD_PARTY_NOTICES.txt` with hashes linking packages to original notice texts, without absolute workstation paths. Unknown declarations fail the command; absent standalone notice files are explicitly listed for review. The only missing-metadata resolution is `require-like@0.1.2` with the reviewed exact MIT license-file checksum. It is invalid for another version or modified license text.

Run this on the actual build platform after a frozen install. A macOS inventory omits Linux-specific optional packages and is not a container audit. The app image includes development dependencies and TypeScript source; its inventory must cover those packages as shipped. The web image bundles minified JS and font/icon assets whose package identities can be lost in a final-filesystem SBOM, so preserve the build dependency inventory and notices alongside the frontend. Base-image OS packages, Node/Caddy, externally installed agent CLIs, fonts, and other bundled assets require their own evidence. See [container build and verification](container-images.md).

For each actual locally built image, run the immutable-image gate before distribution:

```sh
docker build --platform linux/amd64 -f docker/Dockerfile --target app --iidfile "$audit_root/app-image.id" .
node scripts/publication/image-gate.mjs "$(tr -d '\n' < "$audit_root/app-image.id")" "$audit_root/app-image-audit"
docker build --platform linux/amd64 -f docker/Dockerfile --target web --iidfile "$audit_root/web-image.id" .
node scripts/publication/image-gate.mjs "$(tr -d '\n' < "$audit_root/web-image.id")" "$audit_root/web-image-audit"
```

The gate uses checksum-pinned Trivy 0.76.1, ignores ambient scanner configuration/ignore files, inventories OS and language packages including development dependencies, and scans full license text. It records a CycloneDX SBOM, vulnerability and license JSON, image ID/platform, scanner/database version data, time, and report hashes. High/critical vulnerabilities and unknown/high/critical license classifications block the command, including findings without a fix. Those license classifications are upstream scanner policy, not a legal conclusion. The scanner database changes over time; retain the evidence and database metadata and repeat the scan before publication.

Even a passing gate has `legalApproval: false`. A maintainer must review the actual artifact's obligations, missing notices, attribution, font/icon terms, reciprocal licenses, and any source-offer requirements before enabling publication. Base-image GPL/LGPL or unknown classifications can therefore block the default gate; resolve and document those exact findings rather than globally ignoring license classes. No distribution audit or publication approval is claimed by the source inventory or these scripts. Keep container publishing disabled until those artifact-specific checks and review are complete.
