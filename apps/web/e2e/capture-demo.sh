#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$repo_root"

if ! command -v ffmpeg >/dev/null 2>&1; then
  printf 'ffmpeg is required to convert the Playwright recording to a GIF.\n' >&2
  exit 1
fi

env -u E2E_REUSE -u AGENTIC_CRM_LLM_FIXTURES \
  AGENTIC_CRM_LLM=fake \
  DATABASE_URL_BASE=postgres://agentic_crm:agentic_crm@127.0.0.1:5450/agentic_crm \
  E2E_DATABASE=agentic_crm_demo_capture \
  E2E_API_PORT=4210 E2E_COLLAB_PORT=4211 E2E_WEB_PORT=5283 \
  E2E_USER_EMAIL=demo@example.com E2E_USER_NAME='Demo User' \
  pnpm --filter @agentic-crm/web exec playwright test -c e2e/demo-capture.config.ts

video="$(find apps/web/e2e/.capture -type f -name '*.webm' -print -quit)"
if [[ -z "$video" ]]; then
  printf 'Playwright completed without producing a WebM recording.\n' >&2
  exit 1
fi

output="docs/assets/agentic-demo.gif"
palette="$(mktemp "${TMPDIR:-/tmp}/agentic-demo-palette.XXXXXX.png")"
trap 'rm -f "$palette"' EXIT
ffmpeg -y -v error -ss 1.3 -i "$video" -vf 'fps=10,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff' "$palette"
ffmpeg -y -v error -ss 1.3 -i "$video" -i "$palette" \
  -filter_complex 'fps=10,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3' \
  -loop 0 "$output"

printf 'Created %s (%s bytes) from %s\n' "$output" "$(wc -c < "$output" | tr -d ' ')" "$video"
