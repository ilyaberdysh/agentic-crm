# Container image publication and verification

The `Container images` workflow builds the existing `app` and `web` Dockerfile targets for `linux/amd64`. Pull requests and manual runs with `publish=false` only validate builds. They receive read-only repository permissions and no registry login or signing authority.

Publication is a separate, explicit operation. This workflow does not create a release, tag the source repository, select a product version, change package visibility, deploy services, or activate a production manifest.

## Current publication status

Image publication is intentionally disabled. On 2026-10-21, Trivy 0.76.1 reported 79 HIGH/CRITICAL findings and 503 blocked license classifications in the local Linux/arm64 app image, plus five HIGH findings and 35 blocked license classifications in the web image. The web findings include the pinned official Caddy 2.11.7 Alpine base's bundled Go standard library and `golang.org/x/net`; the app findings span its Debian/Node base and installed development/runtime dependencies. These counts are point-in-time scanner evidence, not a legal conclusion, and will change with the vulnerability database and build inputs. The workflow will refuse to upload either image with those results. Track the base/dependency updates and artifact-specific notice review in [`B019`](agentic-core/backlog.yaml); do not enable `CONTAINER_PUBLISH_ENABLED` or weaken the thresholds to bypass this gate.

## Enable publication after distribution approval

Before the first publication, complete the source/privacy and third-party distribution audit described in [PROVENANCE.md](../PROVENANCE.md) and [NOTICE](../NOTICE). The app image currently includes workspace source and development dependencies because its TypeScript services run with `tsx`. Review the actual image SBOM and bundled license obligations before distributing it. An SBOM is an inventory, not a license clearance or vulnerability assessment. The Docker build generates the full installed dependency inventory and original third-party notice texts with `scripts/publication/licenses.mjs`; unresolved declarations fail the build. Both images retain these files alongside `LICENSE` and `NOTICE` in `/usr/share/licenses/agentic-crm`. The web image also serves them at `/legal/` (for example `/legal/THIRD_PARTY_NOTICES.txt`). This conservative inventory includes dependencies that are used to build the frontend as well as those bundled in its output; it does not claim that every listed dependency ships in the web runtime.

Configure the GitHub environment `container-publish` with required reviewers and restrict its deployment branches to the default branch. Creating the environment in YAML does not configure these protection rules. Keep the repository's default branch protected by review and CI requirements. Set the repository Actions variable `CONTAINER_PUBLISH_ENABLED=true` only after approval. This variable is deliberately absent/disabled by default; the workflow never sets it.

The repository must already be public. GitHub artifact attestations are available for public repositories on current GitHub plans; private repositories require Enterprise Cloud. Cosign's public Sigstore signing records the workflow identity in public transparency infrastructure. Publication from private source is intentionally refused here. This workflow never changes repository or GHCR package visibility.

The workflow uses the job-scoped `GITHUB_TOKEN` for GHCR and GitHub attestations and GitHub OIDC for keyless signing. No long-lived publishing or signing secret is required. Ensure Actions is allowed to write packages and the repository has access to any existing GHCR package with the selected name. Newly created GHCR packages may be private; an authorized maintainer must separately decide package visibility and consumer authentication.

## Publish an approved commit

Wait for the latest `CI` and `Publication audit` push runs on the exact default-branch commit to succeed. From Actions, run `Container images` on that default branch with `publish=true`, then approve the `container-publish` environment. The authorization job rejects a disabled publisher, private source, another branch, or a missing/failed/in-progress CI or source-audit run. The container workflow relies on the separate source audit rather than duplicating its privacy/history scans.

Each target is published as:

```text
ghcr.io/<owner>/<repository>-app:sha-<full-commit>-run-<run-id>-<attempt>
ghcr.io/<owner>/<repository>-web:sha-<full-commit>-run-<run-id>-<attempt>
```

The run and attempt suffix prevents retries or rebuilds from reusing a commit tag. No `latest`, branch, or version aliases are written. Tags are write-once by workflow convention; GHCR administrators can still move or delete them. Consumers must use the content-addressed `image@sha256:<digest>` references recorded in the successful run summary and evidence artifacts. A rerun may produce different digests and new tags; this is verifiable provenance, not a claim of reproducible builds.

For each image, the workflow builds once with BuildKit `mode=max` provenance and an SPDX SBOM from a digest-pinned Syft scanner, then loads the complete image index into a containerd-backed local Docker image store. Before any registry upload, `scripts/publication/image-gate.mjs` scans its immutable local Docker ID using checksum-pinned Trivy 0.76.1. It emits a CycloneDX SBOM, vulnerability report, license report, and hashed receipt; it rejects high/critical vulnerabilities and unknown/high/critical license findings. There are no workflow bypasses or ignored unfixed findings. A successful automated gate still requires artifact-specific legal and notice review.

After the gate passes, the workflow pushes that same stored image without rebuilding and checks that its remote index digest matches the BuildKit output. It signs the digest using cosign and publishes GitHub build-provenance and SBOM attestations to both GitHub and GHCR. It then verifies the cosign identity, OIDC issuer, commit and event, and both GitHub attestation predicate types against the expected workflow, source branch, and commit. GitHub verification also rejects self-hosted-runner attestations. Actions, base images, and the SBOM scanner are pinned by digest or full commit; Docker and Trivy are version-pinned (Trivy's download checksum is checked). Buildx, BuildKit, the hosted runner, vulnerability databases, and external package infrastructure remain part of the trusted build environment.

Only a successful run means both targets passed their security gates and completed signing and verification. A failure before the gate passes uploads no image; a later failure may leave an uploaded image or a partially completed pair in GHCR. Do not deploy failed runs. Rerun the workflow and choose both references from the same successful attempt. Evidence artifacts (`image.json`, `sbom.spdx.json`, signed provenance/SBOM bundles, and the Trivy gate's SBOM/reports/receipt) are retained for 90 days; registry-attached evidence and GitHub attestations are subject to their own retention and package deletion policies. Archive evidence outside Actions when longer retention is required. The receipt's local image ID is associated with the registry digest in `image.json`.

## Verify before deployment

Install cosign 3.x and a current GitHub CLI. Authenticate to GitHub and GHCR where required (`gh auth login`, `docker login ghcr.io`); use credentials with read-only package access. Obtain the expected source commit and the image digest from an independently reviewed successful run. Run verification from a trusted checkout:

```bash
bash docker/verify-image.sh OWNER/REPOSITORY FULL_COMMIT_SHA main \
  ghcr.io/owner/repository-app@sha256:APP_DIGEST
bash docker/verify-image.sh OWNER/REPOSITORY FULL_COMMIT_SHA main \
  ghcr.io/owner/repository-web@sha256:WEB_DIGEST
```

Replace `main` if the repository's default branch has another name. The script requires a full source SHA and digest-pinned GHCR references, fetches the attestation bundles from GHCR, and fails on missing or mismatched evidence. Signing authenticates who built an image and from which commit; it does not prove the application is secure or that a compromised authorized workflow behaved honestly. Consumers must still trust and review the source, workflow, and its maintainers.

The final-image SBOM covers files discoverable in the runtime filesystem. In the web target, minified JavaScript assets do not necessarily preserve all build-time npm identities. Use the source lockfile audit alongside the image SBOM when assessing the frontend dependency set.

## Configure Coolify

Set the complete verified references as `APP_IMAGE` and `WEB_IMAGE` in the Coolify service environment before using [compose.coolify.yml](../docker/compose.coolify.yml). Both are required; there is no mutable-tag default. The compose file does not perform signature verification itself: run the verification above before changing deployment configuration. Keep the two references together for rollback to a previously verified build, subject to database migration compatibility.

Also set a persistent `AGENTIC_CRM_ENCRYPTION_KEY` generated with `openssl rand -hex 32` in the runtime secret store. Preserve it with database backups: changing it makes existing encrypted credentials unreadable. Google OAuth is optional; configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` together, optionally `GOOGLE_REDIRECT_URI` and `GOOGLE_MAIL_SYNC_DAYS`. By default the callback is `<web-origin>/api/integrations/google/callback`.

The stack still runs database migrations when the API starts. Back up the database and review migrations before changing deployed digests. This publication workflow does not authorize or execute that deployment.

## Maintenance references

- [Docker attestations](https://docs.docker.com/build/ci/github-actions/attestations/) and [SBOM inspection](https://docs.docker.com/build/metadata/attestations/sbom/)
- [Containerd image store on GitHub Actions](https://docs.docker.com/build/ci/github-actions/multi-platform/#build-and-load-multi-platform-images) and [preserving indices when pushing](https://docs.docker.com/reference/cli/docker/image/push/)
- [GitHub attestation action](https://github.com/actions/attest) and [verification policy flags](https://cli.github.com/manual/gh_attestation_verify)
- [Cosign keyless verification](https://docs.sigstore.dev/cosign/verifying/verify/)

Dependabot tracks pinned Actions via the existing `github-actions` update configuration. Review and update Dockerfile base-image and SBOM-scanner digests deliberately; updates change the build inputs and require another verified publication.
