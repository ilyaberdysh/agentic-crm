#!/usr/bin/env bash
# Usage: bash docker/verify-image.sh OWNER/REPO FULL_COMMIT_SHA DEFAULT_BRANCH IMAGE@sha256:DIGEST
# Requires cosign 3.x, a recent GitHub CLI, and registry credentials (docker login ghcr.io).
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo 'Usage: bash docker/verify-image.sh OWNER/REPO FULL_COMMIT_SHA DEFAULT_BRANCH IMAGE@sha256:DIGEST' >&2
  exit 2
fi

repository=$1
commit=$2
branch=$3
image=$4
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Invalid repository' >&2; exit 2; }
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full commit SHA is required' >&2; exit 2; }
[[ -n "$branch" && "$branch" != refs/* ]] || { echo 'Expected a default branch name, without refs/heads/' >&2; exit 2; }
repository_lower=$(printf '%s' "$repository" | tr '[:upper:]' '[:lower:]')
image_name=${image%@sha256:*}
[[ "$image_name" == "ghcr.io/$repository_lower-app" || "$image_name" == "ghcr.io/$repository_lower-web" ]] || { echo 'Image must belong to the expected repository namespace' >&2; exit 2; }
[[ "$image" =~ ^ghcr\.io/[a-z0-9._/-]+-(app|web)@sha256:[0-9a-f]{64}$ ]] || { echo 'An app or web image pinned by SHA-256 digest is required' >&2; exit 2; }

identity="https://github.com/$repository/.github/workflows/containers.yml@refs/heads/$branch"
cosign verify \
  --certificate-identity "$identity" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-github-workflow-sha "$commit" \
  --certificate-github-workflow-trigger workflow_dispatch \
  "$image"

for predicate in https://slsa.dev/provenance/v1 https://spdx.dev/Document; do
  gh attestation verify "oci://$image" \
    --repo "$repository" \
    --cert-identity "$identity" \
    --cert-oidc-issuer https://token.actions.githubusercontent.com \
    --source-digest "$commit" \
    --source-ref "refs/heads/$branch" \
    --deny-self-hosted-runners \
    --predicate-type "$predicate" \
    --bundle-from-oci
done
